import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';
import { startServer, familySession } from './harness.mjs';

const body = (day, extra = {}) => ({
  name: 'תלמיד לדוגמה', subject: 'מתמטיקה', level: 'כיתה ח', phone: '0501234567',
  email: 'source-family@example.test', durationMin: 45, mode: 'online',
  start: `2028-01-` + day + 'T10:00:00+02:00', end: `2028-01-` + day + 'T10:45:00+02:00',
  ...extra,
});
const book = (baseUrl, day, extra = {}, cookie) => fetch(baseUrl + '/api/book', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  body: JSON.stringify(body(day, extra)),
});
const snapshots = db => db.prepare('SELECT heard_from, heard_from_detail FROM bookings_v2 ORDER BY id').all().map(r => ({ ...r }));
const source = db => db.prepare('SELECT source FROM family_acquisition_sources').get()?.source;

test('ask once, carry forward, correct current/future only, and never carry other free text', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  const db = new DatabaseSync(dbPath);
  try {
    const first = await (await book(baseUrl, '01', { heardFrom: 'other', heardDetail: 'synthetic source' })).json();
    const cookie = await familySession(first.portal.link);
    assert.equal(source(db), 'other');
    const page = await fetch(baseUrl + '/booking', { headers: { Cookie: cookie } });
    assert.match(page.headers.get('cache-control'), /private, no-store/);
    const html = await page.text();
    assert.match(html, /acquisitionSource:"other"/, 'authenticated loader includes the saved source');
    assert.equal((await book(baseUrl, '02', {}, cookie)).status, 200);
    assert.equal((await book(baseUrl, '03', { heardFrom: 'google', heardDetail: 'must not stick' }, cookie)).status, 200);
    assert.equal((await book(baseUrl, '04', {}, cookie)).status, 200);
    assert.equal(source(db), 'google');
    assert.deepEqual(snapshots(db), [
      { heard_from: 'other', heard_from_detail: 'synthetic source' },
      { heard_from: 'other', heard_from_detail: null },
      { heard_from: 'google', heard_from_detail: null },
      { heard_from: 'google', heard_from_detail: null },
    ]);
    assert.equal((await book(baseUrl, '04', { heardFrom: 'school' }, cookie)).status, 409);
    assert.equal(source(db), 'google', 'a failed booking cannot change the default');
  } finally { db.close(); await stop(); }
});

test('skipped/invalid new answers become explicit unknown; unknown returning families can update', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  const db = new DatabaseSync(dbPath);
  try {
    const first = await (await book(baseUrl, '01', { heardFrom: 'not-a-source' })).json();
    const cookie = await familySession(first.portal.link);
    assert.equal(source(db), 'unknown');
    assert.equal((await book(baseUrl, '02', {}, cookie)).status, 200);
    assert.equal((await book(baseUrl, '03', { heardFrom: 'friend' }, cookie)).status, 200);
    assert.equal((await book(baseUrl, '04', { heardFrom: 'invalid' }, cookie)).status, 200);
    assert.deepEqual(snapshots(db).map(r => r.heard_from), ['unknown', 'unknown', 'friend', 'friend']);
  } finally { db.close(); await stop(); }
});

test('signed-out known-family corrections apply only after confirmation', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  const db = new DatabaseSync(dbPath);
  try {
    await book(baseUrl, '01', { heardFrom: 'friend' });
    const held = await (await book(baseUrl, '02', { heardFrom: 'school' })).json();
    assert.equal(held.awaitingConfirmation, true);
    assert.equal(source(db), 'friend');
    assert.equal(snapshots(db).length, 1);
    const hold = db.prepare('SELECT id, expires_at FROM pending_bookings').get();
    const payload = 'p.' + hold.id + '.' + Date.parse(hold.expires_at);
    const token = payload + '.' + createHmac('sha256', 'test-secret-not-a-real-one').update(payload).digest('base64url');
    const confirmed = await fetch(baseUrl + '/api/book', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: token }),
    });
    assert.equal(confirmed.status, 200);
    assert.equal(source(db), 'school');
    assert.deepEqual(snapshots(db).map(r => r.heard_from), ['friend', 'school']);
  } finally { db.close(); await stop(); }
});
