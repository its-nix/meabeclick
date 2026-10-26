import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = await mkdtemp(join(tmpdir(), 'lesson-games-'));
process.env.DATA_DIR = dataDir;
process.env.DB_PATH = join(dataDir, 'results.db');
process.env.SESSION_SECRET = 'lesson-game-test-secret';

const E = await import('../../src/lib/server/entities.ts');
const { handle } = await import('../../src/lib/server/db.ts');
const R = await import('../../src/lib/server/results.ts');
const G = await import('../../src/lib/server/lesson-games.ts');
const U = await import('../../src/lib/server/urls.ts');

const account = E.createAccount({ name: 'משפחת בדיקה', credential: 'family' });
const studentA = E.createStudent({ code: 'student-a', name: 'תלמיד א', accountId: account.id, credential: 'a' });
const studentB = E.createStudent({ code: 'student-b', name: 'תלמיד ב', accountId: account.id, credential: 'b' });

function liveLesson(slug, studentId, at, title) {
  handle().prepare(`INSERT INTO bookings_v2 (student_id, start, end, at, status) VALUES (?, ?, ?, ?, 'confirmed')`)
    .run(studentId, at, new Date(new Date(at).getTime() + 45 * 60_000).toISOString(), at);
  handle().prepare(`INSERT INTO lessons (slug, student, title, topic, at, lesson_at, status) VALUES (?, ?, ?, ?, ?, ?, 'ready')`)
    .run(slug, `legacy-label-${studentId}`, title, title, at, at);
}

liveLesson('lesson-a', studentA.id, '2026-10-20T10:00:00.000Z', 'שברים');
liveLesson('lesson-b', studentB.id, '2026-10-21T10:00:00.000Z', 'נגזרות');

function planNodeFor(studentId, suffix) {
  const enrollment = handle().prepare(`INSERT INTO enrollments (student_id, subject) VALUES (?, ?)`).run(studentId, `מתמטיקה-${suffix}`);
  const plan = handle().prepare(`
    INSERT INTO plans (student_id, enrollment_id, template_id, template_version, goal, created_at)
    VALUES (?, ?, 'test', 1, 'goal', ?)
  `).run(studentId, Number(enrollment.lastInsertRowid), new Date().toISOString());
  return Number(handle().prepare(`
    INSERT INTO plan_nodes (plan_id, key, kind, title, position, visibility)
    VALUES (?, ?, 'skill', ?, 0, 'active')
  `).run(Number(plan.lastInsertRowid), `skill-${suffix}`, `מיומנות ${suffix}`).lastInsertRowid);
}

test('an assignment belongs to the requested live lesson and student', () => {
  const assignment = G.createLessonGame({ lessonSlug: 'lesson-a', studentId: studentA.id, template: 'quiz' });
  assert.equal(assignment.lessonSlug, 'lesson-a');
  assert.equal(assignment.studentId, studentA.id);
  assert.equal(assignment.template, 'quiz');
  assert.equal(assignment.status, 'draft');
  assert.ok(assignment.body.questions.length > 0, 'draft starts from a deep-copied catalog example');

  assert.throws(
    () => G.createLessonGame({ lessonSlug: 'lesson-a', studentId: studentB.id, template: 'quiz' }),
    /lesson is not available to this student/,
  );
});

test('all twelve ready catalog templates create isolated structured drafts', () => {
  const templates = ['memory', 'matching', 'sequence', 'sort', 'labelling', 'table', 'quiz',
    'error-hunt', 'two-truths', 'speed-drill', 'graph-match', 'number-line'];
  const drafts = templates.map(template => G.createLessonGame({ lessonSlug: 'lesson-a', studentId: studentA.id, template }));
  assert.equal(new Set(drafts.map(draft => draft.id)).size, 12);
  assert.equal(drafts.every(draft => draft.status === 'draft' && Object.keys(draft.body).length > 0), true);
});

test('server validation rejects semantic errors for every supported template', () => {
  const invalid = {
    memory: body => { body.pairs[1] = structuredClone(body.pairs[0]); },
    matching: body => { body.pairs[1] = structuredClone(body.pairs[0]); },
    sequence: body => { body.steps = [body.steps[0], body.steps[0], body.steps[0]]; },
    sort: body => { body.items[0].category = 'קטגוריה שלא קיימת'; },
    labelling: body => { body.targets[0].id = 'missing-svg-target'; },
    table: body => { body.rows[0].cells = []; },
    quiz: body => { body.questions[0].answer = 999; },
    'error-hunt': body => { body.rounds[0].badStep = body.rounds[0].steps.length; },
    'two-truths': body => { body.rounds[0].lieIndex = 3; },
    'speed-drill': body => { body.items[0].a = 'לא אחת מהאפשרויות'; },
    'graph-match': body => { body.rounds[0].answer = body.rounds[0].options.length; },
    'number-line': body => { body.rounds[0].target = body.max + 1; },
  };

  for (const [template, mutate] of Object.entries(invalid)) {
    const draft = G.createLessonGame({ lessonSlug: 'lesson-a', studentId: studentA.id, template });
    const body = structuredClone(draft.body);
    mutate(body);
    assert.throws(
      () => G.saveAndPublishLessonGame({ assignmentId: draft.id, expectedRevision: draft.revision, title: draft.title, body }),
      err => err?.name === 'GameValidationError' && Array.isArray(err.issues) && err.issues.length > 0,
      `${template} must reject malformed semantics`,
    );
    assert.equal(G.getLessonGame(draft.id).status, 'draft', `${template} remains unpublished`);
  }
});

test('quiz answer 999 is rejected for four options before a snapshot is published', () => {
  const draft = G.createLessonGame({ lessonSlug: 'lesson-a', studentId: studentA.id, template: 'quiz' });
  const body = structuredClone(draft.body);
  body.questions[0].options = ['א', 'ב', 'ג', 'ד'];
  body.questions[0].answer = 999;
  assert.throws(
    () => G.saveAndPublishLessonGame({ assignmentId: draft.id, expectedRevision: draft.revision, title: draft.title, body }),
    err => err?.issues?.some(issue => issue.path === 'questions.0.answer' && /אפשרויות/.test(issue.message)),
  );
  assert.equal(G.getLessonGame(draft.id).publishedDataId, null);
});

test('server validation rejects ambiguous or non-playable template content', () => {
  const cases = [
    ['quiz', body => { body.questions[0].options[1] = body.questions[0].options[0]; }, 'questions.0.options'],
    ['two-truths', body => { body.rounds[0].statements[1] = body.rounds[0].statements[0]; }, 'rounds.0.statements'],
    ['speed-drill', body => { body.items[0].options[1] = body.items[0].options[0]; }, 'items.0.options'],
    ['table', body => { body.rows.forEach(row => { row.cells = row.cells.map(cell => typeof cell === 'object' ? 'טקסט קבוע' : cell); }); }, 'rows'],
    ['number-line', body => { body.rounds[0].tolerance = body.max - body.min; }, 'rounds.0.tolerance'],
  ];

  for (const [template, mutate, expectedPath] of cases) {
    const draft = G.createLessonGame({ lessonSlug: 'lesson-a', studentId: studentA.id, template });
    const body = structuredClone(draft.body);
    mutate(body);
    assert.throws(
      () => G.saveAndPublishLessonGame({ assignmentId: draft.id, expectedRevision: draft.revision, title: draft.title, body }),
      err => err?.issues?.some(issue => issue.path === expectedPath),
      `${template} must reject content that cannot provide an unambiguous playable task`,
    );
  }
});

test('publishing snapshots immutable lesson-specific content and revisions do not cross lessons', () => {
  const a = G.createLessonGame({ lessonSlug: 'lesson-a', studentId: studentA.id, template: 'matching' });
  const b = G.createLessonGame({ lessonSlug: 'lesson-b', studentId: studentB.id, template: 'matching' });

  const aBody = structuredClone(a.body);
  aBody.title = 'משחק א';
  aBody.pairs[0].left = 'A-only';
  const savedA = G.saveLessonGameDraft({ assignmentId: a.id, expectedRevision: a.revision, title: 'משחק א', body: aBody });
  const publishedA1 = G.publishLessonGame({ assignmentId: a.id, expectedRevision: savedA.revision });

  const revisedBody = structuredClone(savedA.body);
  revisedBody.pairs[0].left = 'A-revision-two';
  const savedA2 = G.saveLessonGameDraft({ assignmentId: a.id, expectedRevision: publishedA1.revision, title: 'משחק א 2', body: revisedBody });
  const publishedA2 = G.publishLessonGame({ assignmentId: a.id, expectedRevision: savedA2.revision });

  assert.notEqual(publishedA1.publishedDataId, publishedA2.publishedDataId);
  assert.equal(G.readPublishedLessonGame(publishedA1.publishedDataId).body.pairs[0].left, 'A-only');
  assert.equal(G.readPublishedLessonGame(publishedA2.publishedDataId).body.pairs[0].left, 'A-revision-two');
  assert.notEqual(b.body.pairs[0].left, 'A-only');
});

test('only published games for lessons available to a student are visible', () => {
  const draft = G.createLessonGame({ lessonSlug: 'lesson-a', studentId: studentA.id, template: 'sequence' });
  const published = G.createLessonGame({ lessonSlug: 'lesson-b', studentId: studentB.id, template: 'sequence' });
  G.publishLessonGame({ assignmentId: published.id, expectedRevision: published.revision });

  const aGames = G.lessonGamesForStudent(studentA.id);
  const bGames = G.lessonGamesForStudent(studentB.id);
  assert.ok(!aGames.some(game => game.assignmentId === draft.id));
  assert.ok(!aGames.some(game => game.assignmentId === published.id));
  assert.ok(bGames.some(game => game.assignmentId === published.id));
});

test('saved results produce factual play progress without changing lesson game ownership', () => {
  const assignment = G.createLessonGame({ lessonSlug: 'lesson-a', studentId: studentA.id, template: 'two-truths' });
  const published = G.publishLessonGame({ assignmentId: assignment.id, expectedRevision: assignment.revision });
  R.writeResult({ studentId: studentA.id, dataId: published.publishedDataId, template: 'two-truths', score: 3, total: 4 });
  R.writeResult({ studentId: studentA.id, dataId: published.publishedDataId, template: 'two-truths', score: 4, total: 4 });

  const game = G.lessonGamesForStudent(studentA.id).find(item => item.assignmentId === assignment.id);
  assert.equal(game.plays, 2);
  assert.equal(game.bestScore, 4);
  assert.equal(game.total, 4);
  assert.ok(game.lastPlayedAt);
  assert.equal(G.lessonGamesForStudent(studentB.id).some(item => item.assignmentId === assignment.id), false);
});

test('skill links stay inside the assigned student plan and publish with the immutable snapshot', () => {
  const nodeA = planNodeFor(studentA.id, 'a');
  const nodeB = planNodeFor(studentB.id, 'b');
  assert.throws(
    () => G.createLessonGame({ lessonSlug: 'lesson-a', studentId: studentA.id, template: 'quiz', nodeId: nodeB }),
    /skill is not available to this student/,
  );

  const assignment = G.createLessonGame({ lessonSlug: 'lesson-a', studentId: studentA.id, template: 'quiz', nodeId: nodeA });
  const published = G.publishLessonGame({ assignmentId: assignment.id, expectedRevision: assignment.revision });
  const link = handle().prepare(`SELECT student_id, node_id FROM game_skills WHERE data_id = ?`).get(published.publishedDataId);
  assert.equal(link.student_id, studentA.id);
  assert.equal(link.node_id, nodeA);
});

test('archiving hides the assignment but preserves snapshots and results', () => {
  const assignment = G.createLessonGame({ lessonSlug: 'lesson-a', studentId: studentA.id, template: 'memory' });
  const published = G.publishLessonGame({ assignmentId: assignment.id, expectedRevision: assignment.revision });
  R.writeResult({ studentId: studentA.id, dataId: published.publishedDataId, template: 'memory', score: 2, total: 3 });
  G.archiveLessonGame(assignment.id);

  assert.equal(G.lessonGamesForStudent(studentA.id).some(item => item.assignmentId === assignment.id), false);
  assert.equal(G.readPublishedLessonGame(published.publishedDataId).assignmentId, assignment.id);
  assert.equal(R.resultsForStudent(studentA.id).some(row => row.data_id === published.publishedDataId), true);
});

test('stale revisions cannot overwrite a newer draft', () => {
  const assignment = G.createLessonGame({ lessonSlug: 'lesson-a', studentId: studentA.id, template: 'number-line' });
  G.saveLessonGameDraft({ assignmentId: assignment.id, expectedRevision: assignment.revision, title: assignment.title, body: assignment.body });
  assert.throws(
    () => G.saveLessonGameDraft({ assignmentId: assignment.id, expectedRevision: assignment.revision, title: assignment.title, body: assignment.body }),
    /revision conflict/,
  );
});

test('a teacher preview cannot authenticate a result write', () => {
  assert.equal(U.verifyGameSignature({ dataId: 'preview-lga-example', student: 'תלמיד/ה לדוגמה', t: null }), false);
});
