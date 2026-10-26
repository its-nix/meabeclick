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

    const missingResponse = await fetch(`${baseUrl}/api/lessons/linked-game-lesson/games`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: tutorCookie },
      body: JSON.stringify({ action: 'save', assignmentId: 'missing-assignment' }),
    });
    assert.equal(missingResponse.status, 404);
    assert.deepEqual(await missingResponse.json(), { error: 'המשחק לא נמצא.' });

    const malformedBody = structuredClone(created.body);
    malformedBody.questions[0].options = ['א', 'ב', 'ג', 'ד'];
    malformedBody.questions[0].answer = 999;
    const malformedResponse = await fetch(`${baseUrl}/api/lessons/linked-game-lesson/games`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: tutorCookie },
      body: JSON.stringify({
        action: 'publish', assignmentId: created.id, expectedRevision: created.revision,
        title: created.title, body: malformedBody,
      }),
    });
    assert.equal(malformedResponse.status, 400);
    const malformed = await malformedResponse.json();
    assert.equal(malformed.error, 'פרטי המשחק אינם תקינים.');
    assert.deepEqual(malformed.issues[0].path, 'questions.0.answer');
    assert.doesNotMatch(JSON.stringify(malformed), /must|invalid game content|index into/i);

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

    const savedResponse = await fetch(`${baseUrl}/api/lessons/linked-game-lesson/games`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: tutorCookie },
      body: JSON.stringify({
        action: 'save', assignmentId: published.id, expectedRevision: published.revision,
        title: published.title, body: published.body,
      }),
    });
    assert.equal(savedResponse.status, 200);
    const saved = (await savedResponse.json()).assignment;
    const staleResponse = await fetch(`${baseUrl}/api/lessons/linked-game-lesson/games`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: tutorCookie },
      body: JSON.stringify({
        action: 'save', assignmentId: published.id, expectedRevision: published.revision,
        title: published.title, body: published.body,
      }),
    });
    assert.equal(staleResponse.status, 409);
    assert.deepEqual(await staleResponse.json(), { error: 'המשחק השתנה מאז שפתחתם אותו.' });
    const copyResponse = await fetch(`${baseUrl}/api/lessons/linked-game-lesson/games`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: tutorCookie },
      body: JSON.stringify({
        action: 'copy', assignmentId: saved.id, expectedRevision: published.revision,
        title: saved.title, body: saved.body,
      }),
    });
    assert.equal(copyResponse.status, 200);
    const copied = (await copyResponse.json()).assignment;
    assert.notEqual(copied.id, saved.id);
    assert.equal(copied.status, 'draft');

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

    db = new DatabaseSync(join(dataDir, 'results.db'));
    const secondStart = '2027-04-16T10:00:00.000Z';
    db.prepare(`INSERT INTO bookings_v2 (student_id, start, end, at, status) VALUES (?, ?, ?, ?, 'confirmed')`)
      .run(student.id, secondStart, '2027-04-16T10:45:00.000Z', secondStart);
    db.prepare(`INSERT INTO lessons (slug, student, title, topic, at, lesson_at, status) VALUES (?, ?, ?, ?, ?, ?, 'ready')`)
      .run('linked-game-lesson-two', 'legacy label', 'שברים', 'שברים', secondStart, secondStart);
    db.close();
    db = undefined;
    const secondCreated = await fetch(`${baseUrl}/api/lessons/linked-game-lesson-two/games`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: tutorCookie },
      body: JSON.stringify({ studentId: student.id, template: 'sequence' }),
    }).then(response => response.json());
    await fetch(`${baseUrl}/api/lessons/linked-game-lesson-two/games`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: tutorCookie },
      body: JSON.stringify({ action: 'publish', assignmentId: secondCreated.assignment.id,
        expectedRevision: secondCreated.assignment.revision }),
    });
    const duplicateTitles = await fetch(`${baseUrl}/api/portal/${portal.code}`, { headers: { Cookie: familyCookie } }).then(response => response.json());
    assert.deepEqual(
      duplicateTitles.games.filter(item => item.lessonTitle === 'שברים').map(item => item.lessonSlug).sort(),
      ['linked-game-lesson', 'linked-game-lesson-two'],
      'duplicate visible lesson titles retain separate stable lesson identities',
    );

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
