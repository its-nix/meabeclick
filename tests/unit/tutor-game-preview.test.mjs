import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { register } from 'node:module';

// Exercise the actual route loaders with the same aliases as SvelteKit.
const root = new URL('../../src/lib/', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('$server/')) return nextResolve(new URL('server/' + specifier.slice(8), ${JSON.stringify(root)}).href, context);
    if (specifier.startsWith('$lib/')) return nextResolve(new URL(specifier.slice(5), ${JSON.stringify(root)}).href, context);
    return nextResolve(specifier, context);
  }
`)}`, import.meta.url);
const dataDir = await mkdtemp(join(tmpdir(), 'tutor-preview-'));
process.env.DATA_DIR = dataDir;
process.env.DB_PATH = join(dataDir, 'results.db');
process.env.SESSION_SECRET = 'synthetic-tutor-preview-secret';
await mkdir(join(dataDir, 'games-data'));
await copyFile(new URL('../../seed/games-data/nikol-derivrules-speed.json', import.meta.url), join(dataDir, 'games-data', 'nikol-derivrules-speed.json'));
await writeFile(join(dataDir, 'games-data', 'legacy-quiz.json'), JSON.stringify({ title: 'משחק שיעור', subject: 'מתמטיקה' }));
const E = await import('../../src/lib/server/entities.ts');
const D = await import('../../src/lib/server/db.ts');
const G = await import('../../src/lib/server/lesson-games.ts');
const R = await import('../../src/lib/server/results.ts');
const U = await import('../../src/lib/server/urls.ts');
const { GET } = await import('../../src/routes/api/lessons/+server.ts');
const { load } = await import('../../src/routes/app/play/[template]/+page.server.ts');
const { load: catalog } = await import('../../src/routes/app/games/+page.server.ts');
const { POST: saveResult } = await import('../../src/routes/api/game-result/+server.ts');
const account = E.createAccount({ name: 'משפחת בדיקה', credential: 'family' });
const student = E.createStudent({ code: 'preview-pupil', name: 'תלמיד בדיקה', accountId: account.id, credential: 'student' });
const at = '2028-01-10T10:00:00.000Z';
D.handle().prepare(`INSERT INTO bookings_v2 (student_id, start, end, at, status) VALUES (?, ?, ?, ?, 'confirmed')`).run(student.id, at, at, at);
D.handle().prepare(`INSERT INTO lessons (slug, student, at, lesson_at, status, games) VALUES (?, ?, ?, ?, 'ready', ?)`).run(
  'preview-lesson', student.name, at, at, JSON.stringify([
    { title: 'ישן', url: 'games/quiz.html?d=legacy-quiz&s=preview-pupil&t=old-student-secret' },
    { title: 'חתום', url: U.gameUrl({ template: 'quiz', dataId: 'legacy-quiz', student: student.code }) },
    { title: 'חדש', template: 'quiz', dataId: 'legacy-quiz' },
  ]),
);
function event(path, authenticated = true) {
  return { url: new URL(path, 'https://school.example'), params: { template: 'quiz' }, locals: { authenticated }, setHeaders(headers) { this.headers = headers; } };
}

function assertTutorLink(path) {
  const url = new URL(path, 'https://school.example');
  assert.equal(url.pathname, '/app/play/quiz');
  assert.equal(url.searchParams.get('teacher'), '1');
  assert.equal(url.searchParams.has('s'), false, 'tutor URL must not carry a playable student identity');
  assert.equal(url.searchParams.has('t'), false, 'tutor URL must not grant result-write permission');
  return url;
}

test('all tutor feed game shapes open an authenticated, score-free preview and return to that student workspace', async () => {
  R.writeResult({ studentId: student.id, dataId: 'legacy-quiz', template: 'quiz', score: 4, total: 4 });
  const response = await GET(event(`/api/lessons?studentCode=${student.code}`));
  assert.equal(response.status, 200);
  const lesson = (await response.json()).lessons[0];
  assert.equal(lesson.games.length, 3);
  for (const game of lesson.games) {
    const url = assertTutorLink(game.url);
    const request = event(url.href);
    const preview = await load(request);
    assert.equal(preview.gameData.title, 'משחק שיעור');
    assert.equal(preview.preview, true);
    assert.equal(preview.t, null);
    assert.notEqual(preview.student, student.code);
    assert.notEqual(preview.student, student.name);
    assert.equal(preview.best, null);
    assert.equal(preview.skill, null);
    assert.equal(preview.backUrl, `/app/students/${student.code}`);
    assert.match(request.headers['Cache-Control'], /private, no-store/);
    const rejected = await saveResult({ request: new Request('https://school.example/api/game-result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ student: preview.student, dataId: preview.dataId, t: preview.t, score: 1, total: 1 }) }) });
    assert.equal(rejected.status, 403);
    await assert.rejects(load(event(url.href, false)), err => err.status === 302 && err.location.startsWith('/login?next='));
  }
  assert.equal(R.resultsForStudent(student.id).length, 1, 'preview never adds student progress');
});

test('the tutor feed includes published assignment snapshots without exposing unpublished draft edits', async () => {
  const draft = G.createLessonGame({ lessonSlug: 'preview-lesson', studentId: student.id, template: 'quiz' });
  const published = G.publishLessonGame({ assignmentId: draft.id, expectedRevision: draft.revision });
  G.saveLessonGameDraft({ assignmentId: draft.id, expectedRevision: published.revision, title: 'טיוטה פרטית', body: { ...draft.body, title: 'טיוטה פרטית' } });
  const lesson = (await (await GET(event(`/api/lessons?studentCode=${student.code}`))).json()).lessons[0];
  const game = lesson.games.find(game => new URL(game.url, 'https://school.example').searchParams.get('d') === published.publishedDataId);
  assert.ok(game, 'new lesson assignments must be playable from the tutor feed');
  const preview = await load(event(assertTutorLink(game.url).href));
  assert.equal(preview.preview, true);
  assert.deepEqual(preview.gameData, draft.body, 'the tutor sees the exact published student snapshot');
  assert.equal(preview.t, null);

  const editing = event(`/app/play/quiz?preview=${draft.id}`);
  const draftPreview = await load(editing);
  assert.equal(draftPreview.gameData.title, 'טיוטה פרטית', 'editor preview still reads the saved draft');
  assert.match(editing.headers['Cache-Control'], /private, no-store/);
  await assert.rejects(load(event(`/app/play/quiz?preview=${draft.id}`, false)), err => err.status === 302);
  await assert.rejects(load({ ...event(game.url), params: { template: 'memory' } }), err => err.status === 403);
  G.archiveLessonGame(draft.id);
  const after = (await (await GET(event(`/api/lessons?studentCode=${student.code}`))).json()).lessons[0];
  assert.equal(after.games.some(game => game.url.includes(published.publishedDataId)), false);
});

test('catalog examples are tutor-only previews and preserve the lesson picker context', async () => {
  const pickerPath = `/app/games?lesson=preview-lesson&student=${student.code}`;
  const examples = await catalog(event(pickerPath));
  for (const example of examples.ready.filter(game => game.exampleUrl)) {
    const url = new URL(example.exampleUrl, 'https://school.example');
    assert.equal(url.searchParams.get('teacher'), '1');
    assert.equal(url.searchParams.has('s'), false);
    assert.equal(url.searchParams.has('t'), false);
    const preview = await load({ ...event(url.href), params: { template: example.key } });
    assert.equal(preview.preview, true);
    assert.equal(preview.backUrl, pickerPath);
    assert.equal(preview.best, null);
  }
  const overview = (await (await GET(event('/api/lessons'))).json()).lessons[0];
  assert.equal((await load(event(overview.games[0].url))).backUrl, '/app/dashboard');
});

test('teacher mode ignores injected student credentials and rejects unsafe returns', async () => {
  const path = U.gameUrl({ template: 'quiz', dataId: 'legacy-quiz', student: student.code });
  const preview = await load(event(path + '&teacher=1&returnTo=https%3A%2F%2Fexternal.example'));
  assert.equal(preview.preview, true);
  assert.equal(preview.t, null);
  assert.notEqual(preview.student, student.code);
  assert.equal(preview.backUrl, '/app/dashboard');
  await assert.rejects(load(event(path + '&teacher=1', false)), err => err.status === 302);
});
