// tests/characterization/booking-mode.test.mjs
//
// Online or in person, through the real /api/book (Todoist
// 6hmR35WgcWp7Mj2q). The choice is kept on the booking. Anything but the
// two is refused before a family is enrolled or an hour is claimed, because
// a lesson at the student's home is not on offer. A request with no mode at
// all (a page opened before this shipped, a confirmation held before it)
// still books, and records that it never said.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, familySession } from './harness.mjs';
import { OFFICE_ADDRESS, OFFICE_NAV_LINK } from '../../src/lib/contact.ts';

const body = (over) => JSON.stringify({
  name: 'נוגה ישראלי', level: 'כיתה ח', phone: '0501234567', durationMin: 45, ...over,
});

test('booking immediately returns its assigned tutor permanent Meet room, not another tutor room', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  const db = new DatabaseSync(dbPath);
  try {
    db.prepare('UPDATE teachers SET meet_url = ? WHERE id = 1').run('https://meet.google.com/aaa-bbbb-ccc');
    db.prepare('UPDATE teachers SET meet_url = ?, calendar_id = ?, busy_ics = ? WHERE id = 2')
      .run('https://meet.google.com/ddd-eeee-fff', 'lior-lessons@example.test', 'https://127.0.0.1:1/lior.ics');
    const hour = { mode: 'online', start: '2028-01-10T10:00:00+02:00', end: '2028-01-10T10:45:00+02:00' };
    const first = await (await post(baseUrl, { ...hour, email: 'room1@example.test' })).json();
    assert.equal(first.fallback, true, 'the room is available even before a calendar write succeeds');
    assert.equal(first.place.href, 'https://meet.google.com/aaa-bbbb-ccc');
    const second = await (await post(baseUrl, { ...hour, email: 'room2@example.test' })).json();
    assert.equal(second.place.href, 'https://meet.google.com/ddd-eeee-fff');
    const held = await (await post(baseUrl, { ...hour, email: 'room1@example.test',
      start: '2028-01-11T10:00:00+02:00', end: '2028-01-11T10:45:00+02:00' })).json();
    assert.equal(held.awaitingConfirmation, true);
    assert.equal(held.place, undefined, 'an unconfirmed email hold does not hand out a room');
    const cookie = await familySession(first.portal.link);
    const again = await fetch(baseUrl + '/api/book', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: body({ ...hour, email: 'room1@example.test', start: '2028-01-12T10:00:00+02:00', end: '2028-01-12T10:45:00+02:00' }),
    }).then(r => r.json());
    assert.equal(again.place.href, first.place.href, 'the room stays permanent across bookings');
  } finally { db.close(); await stop(); }
});

test('in-person confirmation returns the office; an unset online room never invents a link', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const office = await (await post(baseUrl, { mode: 'in_person', email: 'office@example.test',
      start: '2028-01-10T10:00:00+02:00', end: '2028-01-10T10:45:00+02:00' })).json();
    assert.deepEqual(office.place, { mode: 'in_person', label: 'פנים מול פנים', where: OFFICE_ADDRESS, href: OFFICE_NAV_LINK });
    const online = await (await post(baseUrl, { mode: 'online', email: 'no-room@example.test',
      start: '2028-01-11T10:00:00+02:00', end: '2028-01-11T10:45:00+02:00' })).json();
    assert.equal(online.place.href, null);
    assert.equal(online.place.where, null);
  } finally { await stop(); }
});
const post = (baseUrl, over) => fetch(`${baseUrl}/api/book`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(over),
});

test('the mode is kept on the booking; any other value is refused before anything is written', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const ok = await post(baseUrl, { email: 'mode1@example.com', mode: 'in_person',
      start: '2027-06-01T10:00:00+03:00', end: '2027-06-01T10:45:00+03:00' });
    assert.equal(ok.status, 200, await ok.clone().text());

    const bad = await post(baseUrl, { email: 'mode2@example.com', mode: 'home',
      start: '2027-06-02T10:00:00+03:00', end: '2027-06-02T10:45:00+03:00' });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /אונליין או פנים מול פנים/);

    const none = await post(baseUrl, { email: 'mode3@example.com',
      start: '2027-06-03T10:00:00+03:00', end: '2027-06-03T10:45:00+03:00' });
    assert.equal(none.status, 200, await none.clone().text());

    const db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db.prepare(`SELECT a.email, b.mode FROM bookings_v2 b
      JOIN students_v2 s ON s.id = b.student_id JOIN accounts a ON a.id = s.account_id ORDER BY b.id`).all();
    assert.deepEqual(rows.map((r) => ({ ...r })), [
      { email: 'mode1@example.com', mode: 'in_person' },
      { email: 'mode3@example.com', mode: null },
    ]);
    assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM accounts WHERE email = 'mode2@example.com'`).get().c, 0,
      'the refused request enrolled nobody');
  } finally { await stop(); }
});
