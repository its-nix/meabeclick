// A signed-in student lists and plays approved native games; everyone else is turned away.
// Simulate tutor review at the Google boundary, then exercise the production HTTP routes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, familySession } from './harness.mjs';
import { simulatedGoogle } from '../simulated-lesson-review.mjs';

function book(baseUrl) {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 7 + (8 - start.getUTCDay()) % 7);
  start.setUTCHours(8, 0, 0, 0);
  const end = new Date(start.getTime() + 90 * 60_000);
  return fetch(`${baseUrl}/api/book`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'יובל כהן', subject: 'מתמטיקה', level: 'כיתה ט', phone: '0501234567', email: 'orit@example.com',
      durationMin: 90, start: start.toISOString(), end: end.toISOString() }),
  });
}

test('the games list and player serve a signed-in student only, and the answer endpoint trusts the session, not the body', async t => {
  const google = await simulatedGoogle(t);
  const { baseUrl, dbPath, dataDir, stop } = await startServer({ env: google.env });
  const localLink = link => link.replace(google.env.SITE_URL, baseUrl);
  try {
    const first = await (await book(baseUrl)).json();
    const parent = await familySession(localLink(first.portal.link));
    const share = await (await fetch(`${baseUrl}/api/student-link`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: parent }, body: JSON.stringify({ code: first.portal.code }) })).json();
    const child = await familySession(localLink(share.link));

    const db = new DatabaseSync(dbPath);
    const { id: studentId } = db.prepare('SELECT id FROM students_v2 WHERE code=?').get(first.portal.code);
    const { id: bookingId } = db.prepare('SELECT id FROM bookings_v2 LIMIT 1').get();
    db.close();
    const review = await google.review({ bookingId, studentId, dbPath, baseUrl, dataDir });
    const get = (path, cookie) => fetch(`${baseUrl}${path}`, { headers: cookie ? { Cookie: cookie } : {}, redirect: 'manual' });
    const gamePath = `/app/student/games/${bookingId}/axis-game`;
    assert.equal((await get(gamePath, child)).status, 404);
    await review.approve();
    const list = await get('/app/student/games', child);
    assert.equal(list.status, 200);
    const html = await list.text();
    assert.match(html, /המשחקים שלי/);
    assert.ok(!/"answer"|solution|hints/.test(html), 'no answers in the list');

    const play = await get(`/app/student/games/${bookingId}/axis-game`, child);
    assert.equal(play.status, 200);
    const player = await play.text();
    assert.match(player, /dir="rtl"/);
    assert.match(player, new RegExp(`/api/student-games/${bookingId}`));
    assert.ok(!player.includes('"answer"'), 'the player document carries no answers');

    for (const path of ['/app/student/games', `/app/student/games/${bookingId}/axis-game`]) {
      for (const cookie of [null, parent]) {
        const r = await get(path, cookie);
        assert.equal(r.status, 302, `${path} ${cookie ? 'parent' : 'anonymous'}`);
      }
    }
    assert.equal((await get(`/app/student/games/${bookingId}/nope`, child)).status, 404);

    const post = (cookie, body) => fetch(`${baseUrl}/api/student-games/${bookingId}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
    const attempt = { version: review.version, taskId: 'axis-1', action: 'attempt', input: '38', eventId: 'e1', studentId: 999 };
    assert.equal((await post(null, attempt)).status, 401);
    assert.equal((await post(parent, attempt)).status, 401, 'an adult session cannot record a child result');
    const ok = await post(child, attempt);
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).correct, true);

    await review.withdraw();
    assert.equal((await get(gamePath, child)).status, 404);

    const check = new DatabaseSync(dbPath);
    const rows = check.prepare('SELECT student_id, booking_id, outcome FROM native_results').all();
    check.close();
    assert.deepEqual(rows.map(r => [Number(r.student_id), Number(r.booking_id), r.outcome]), [[studentId, bookingId, 'correct']]);
  } finally { await stop(); }
});
