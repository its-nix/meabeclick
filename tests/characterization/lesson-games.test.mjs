import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startServer, login, familySession } from './harness.mjs';

const START = '2027-04-15T10:00:00.000Z';
const END = '2027-04-15T10:45:00.000Z';

async function bookFamily(baseUrl) {
  const response = await fetch(`${baseUrl}/api/book`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'תלמיד משחק', subject: 'מתמטיקה', level: 'כיתה י',
      phone: '0501234567', email: 'lesson-game@example.com',
      durationMin: 45, start: START, end: END,
    }),
  });
  assert.equal(response.status, 200);
  return (await response.json()).portal;
}

test('lesson game APIs require tutor auth and published games reach only the assigned student', async () => {
  const { baseUrl, dataDir, stop } = await startServer();
  let db;
  try {
    const portal = await bookFamily(baseUrl);
    const portalPath = join(dataDir, 'portal', `${portal.code}.json`);
    const portalRecord = JSON.parse(await readFile(portalPath, 'utf8'));
    portalRecord.games = [
      { title: 'משחק ישן', url: 'games/quiz.html?d=legacy-game' },
      { title: 'משחק קיים', template: 'quiz', dataId: 'example-integrals-quiz' },
    ];
    await writeFile(portalPath, JSON.stringify(portalRecord));

    db = new DatabaseSync(join(dataDir, 'results.db'));
    db.prepare(`
      INSERT INTO lessons (slug, student, title, topic, at, lesson_at, status)
      VALUES ('linked-game-lesson', 'legacy label', 'שברים', 'שברים', ?, ?, 'ready')
    `).run(START, START);
    const student = db.prepare(`SELECT id FROM students_v2 WHERE code = ?`).get(portal.code);
    db.close();
    db = undefined;

    const create = (cookie, studentId = student.id) => fetch(`${baseUrl}/api/lessons/linked-game-lesson/games`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify({ studentId, template: 'quiz' }),
    });

    const anonymous = await create('');
    assert.equal(anonymous.status, 401);
    assert.deepEqual(await anonymous.json(), { error: 'unauthorized' });

    const tutorCookie = await login(baseUrl);

    const other = await fetch(`${baseUrl}/api/students`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: tutorCookie },
      body: JSON.stringify({ code: 'other-game-student', name: 'תלמיד אחר', subject: 'מתמטיקה', level: 'כיתה י' }),
    }).then(response => response.json());
    assert.equal((await create(tutorCookie, other.student.id)).status, 403,
      'a tutor cannot attach another student to this lesson');

    const createdResponse = await create(tutorCookie);

    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()).assignment;
    assert.equal(created.status, 'draft');

    const publishResponse = await fetch(`${baseUrl}/api/lessons/linked-game-lesson/games`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: tutorCookie },
      body: JSON.stringify({
        action: 'publish', assignmentId: created.id, expectedRevision: created.revision,
        title: 'חידון שברים ערוך', body: { ...created.body, title: 'חידון שברים ערוך' },
      }),
    });

    assert.equal(publishResponse.status, 200);
    const published = (await publishResponse.json()).assignment;
    assert.equal(published.status, 'published');

    const familyCookie = await familySession(portal.link);
    const boardResponse = await fetch(`${baseUrl}/api/portal/${portal.code}`, { headers: { Cookie: familyCookie } });
    assert.equal(boardResponse.status, 200);
    const board = await boardResponse.json();
    const game = board.games.find(item => item.assignmentId === created.id);
    assert.equal(game.title, 'חידון שברים ערוך', 'publish includes the editor values from the same click');
    assert.equal(game.lessonSlug, 'linked-game-lesson');
    assert.equal(game.plays, 0);
    assert.match(game.url, /^\/app\/play\/quiz\?/);
    assert.equal(board.games.find(item => item.title === 'משחק ישן').url, 'games/quiz.html?d=legacy-game');
    assert.match(board.games.find(item => item.title === 'משחק קיים').url, /^\/app\/play\/quiz\?/);

    const url = new URL(game.url, baseUrl);
    const result = await fetch(`${baseUrl}/api/game-result`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student: url.searchParams.get('s'), dataId: url.searchParams.get('d'), t: url.searchParams.get('t'),
        template: 'quiz', score: 3, total: 4,
      }),
    });
    assert.deepEqual(await result.json(), { ok: true, stored: true });

    db = new DatabaseSync(join(dataDir, 'results.db'));
    const refreshed = await fetch(`${baseUrl}/api/portal/${portal.code}`, { headers: { Cookie: familyCookie } }).then(response => response.json());
    const played = refreshed.games.find(item => item.assignmentId === created.id);
    assert.equal(played.plays, 1);
    assert.equal(played.bestScore, 3);
    assert.equal(played.total, 4);
  } finally {
    db?.close();
    await stop();
  }
});
