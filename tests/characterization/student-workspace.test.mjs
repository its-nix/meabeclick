import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, login, familySession } from './harness.mjs';

const markup = html => html.split(/<script\b/)[0];
const book = (baseUrl, day, email) => fetch(baseUrl + '/api/book', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'תלמיד בדיקה', subject: 'מתמטיקה', level: 'כיתה ח', phone: '0501234567', email,
    durationMin: 45, mode: 'online', start: `2028-01-${day}T10:00:00+02:00`, end: `2028-01-${day}T10:45:00+02:00` }),
}).then(r => r.json());

test('overview is a linked student table; guarded detail keeps only the selected student tools', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const first = await book(baseUrl, '10', 'workspace-a@example.test');
    const second = await book(baseUrl, '11', 'workspace-b@example.test');
    const admin = await login(baseUrl);
    const headers = { Cookie: admin };
    const overview = await fetch(baseUrl + '/app/dashboard', { headers });
    assert.match(overview.headers.get('cache-control'), /private, no-store/);
    const overviewMarkup = markup(await overview.text());
    assert.match(overviewMarkup, /class="roster-table /);
    assert.ok(overviewMarkup.includes(`/app/students/${first.portal.code}`));
    assert.ok(overviewMarkup.includes(`/app/students/${second.portal.code}`));
    assert.doesNotMatch(overviewMarkup, /class="student-card|id="hw-results"|id="lessons-list"|>כניסה לפורטל</);

    const path = `/app/students/${first.portal.code}`;
    assert.equal((await fetch(baseUrl + path, { redirect: 'manual' })).status, 302);
    const family = await familySession(first.portal.link);
    assert.equal((await fetch(baseUrl + path, { headers: { Cookie: family }, redirect: 'manual' })).status, 302);
    const detail = await fetch(baseUrl + path, { headers });
    assert.equal(detail.status, 200);
    assert.match(detail.headers.get('cache-control'), /private, no-store/);
    const html = await detail.text();
    assert.match(markup(html), /class="student-card/);
    assert.match(markup(html), /id="hw-results"/);
    assert.match(markup(html), /id="lessons-list"/);
    assert.match(html, /workspace-a@example.test/);
    assert.doesNotMatch(html, /workspace-b@example.test/);
    assert.equal((await fetch(baseUrl + '/app/students/unknown-code', { headers })).status, 404);
  } finally { await stop(); }
});

test('student-scoped results never combine same-name students or unattributed legacy plays', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  const db = new DatabaseSync(dbPath);
  try {
    const first = await book(baseUrl, '10', 'results-a@example.test');
    const second = await book(baseUrl, '11', 'results-b@example.test');
    const a = db.prepare('SELECT id FROM students_v2 WHERE code = ?').get(first.portal.code).id;
    const b = db.prepare('SELECT id FROM students_v2 WHERE code = ?').get(second.portal.code).id;
    const insert = db.prepare('INSERT INTO results_v2 (student_id, at, score, total, missed) VALUES (?, ?, ?, ?, ?)');
    insert.run(a, '2028-01-01', 2, 3, '[]');
    insert.run(b, '2028-01-01', 9, 10, '[]');
    db.prepare('INSERT INTO results (student, at, score, total, missed) VALUES (?, ?, ?, ?, ?)')
      .run('תלמיד בדיקה', '2028-01-01', 99, 100, '[]');
    const admin = await login(baseUrl);
    const read = code => fetch(baseUrl + '/api/results?studentCode=' + code, { headers: { Cookie: admin } });
    const resultA = await (await read(first.portal.code)).json();
    const resultB = await (await read(second.portal.code)).json();
    assert.equal(Object.values(resultA.students)[0].score, 2);
    assert.equal(Object.values(resultB.students)[0].score, 9);
    assert.equal(Object.values(resultA.students)[0].plays, 1);
    assert.equal((await read('unknown-code')).status, 404);
    assert.equal((await fetch(baseUrl + '/api/results?studentCode=' + first.portal.code)).status, 401);
  } finally { db.close(); await stop(); }
});

test('student-scoped generated lessons use unambiguous bookings, never a shared display name', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  const db = new DatabaseSync(dbPath);
  try {
    const first = await book(baseUrl, '10', 'lessons-a@example.test');
    const second = await book(baseUrl, '11', 'lessons-b@example.test');
    db.exec('DELETE FROM lessons');
    const insert = db.prepare('INSERT INTO lessons (slug, student, at, lesson_at, status, homework, games) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const times = db.prepare('SELECT start FROM bookings_v2 ORDER BY id').all();
    insert.run('student-a-lesson', 'תלמיד בדיקה', '2028-01-01', times[0].start, 'ready', '[]', '[]');
    insert.run('student-b-lesson', 'תלמיד בדיקה', '2028-01-01', times[1].start, 'ready', '[]', '[]');
    insert.run('unattributed-lesson', 'תלמיד בדיקה', '2028-01-01', '2020-01-01', 'ready', '[]', '[]');
    const admin = await login(baseUrl);
    const read = code => fetch(baseUrl + '/api/lessons?studentCode=' + code, { headers: { Cookie: admin } });
    assert.deepEqual((await (await read(first.portal.code)).json()).lessons.map(l => l.slug), ['student-a-lesson']);
    assert.deepEqual((await (await read(second.portal.code)).json()).lessons.map(l => l.slug), ['student-b-lesson']);
    assert.equal((await read('unknown-code')).status, 404);
    // A second live booking at the same instant makes the legacy lesson's
    // ownership unknowable. Hiding it is safer than filing it under both.
    const otherId = db.prepare('SELECT id FROM students_v2 WHERE code = ?').get(second.portal.code).id;
    db.prepare('INSERT INTO bookings_v2 (student_id, start, "end", at, status, teacher_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(otherId, times[0].start, times[0].start, '2028-01-01', 'confirmed', 2);
    assert.deepEqual((await (await read(first.portal.code)).json()).lessons, []);
  } finally { db.close(); await stop(); }
});
