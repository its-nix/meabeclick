/**
 * The vision's targets (PRODUCT.md, "Vision") measured from tables that
 * already exist. Read-only: the script never writes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'vision-')), 'results.db');
const { handle } = await import('../../src/lib/server/db.ts');   // builds legacy tables + runs migrations
handle();
const { measure, PLAN_LADDER } = await import('../../scripts/vision-metrics.mjs');

const NOW = new Date('2026-10-15T12:00:00Z');
const daysAgo = (d) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const db = new DatabaseSync(process.env.DB_PATH);
db.exec(`
  INSERT INTO accounts (id, name, credential, created_at) VALUES (1, 'a', 'x', '${daysAgo(90)}');
  INSERT INTO students_v2 (id, code, name, account_id, credential, created_at) VALUES
    (1, 's1', 'one', 1, 'x', '${daysAgo(90)}'),
    (2, 's2', 'two', 1, 'x', '${daysAgo(90)}'),
    (3, 's3', 'three', 1, 'x', '${daysAgo(90)}'),
    (4, 's4', 'four', 1, 'x', '${daysAgo(90)}');
`);
const booking = db.prepare(
  `INSERT INTO bookings_v2 (student_id, start, "end", at, status) VALUES (?, ?, ?, ?, ?)`);
booking.run(1, daysAgo(3), daysAgo(3), daysAgo(10), 'confirmed');   // active
booking.run(1, daysAgo(10), daysAgo(10), daysAgo(20), 'confirmed'); // same student, counted once
booking.run(2, daysAgo(40), daysAgo(40), daysAgo(50), 'confirmed'); // too old
booking.run(3, daysAgo(2), daysAgo(2), daysAgo(9), 'cancelled');    // cancelled
booking.run(4, daysAgo(-2), daysAgo(-2), daysAgo(1), 'confirmed');  // future, not yet taught

const pay = db.prepare(`INSERT INTO payments
  (account_id, student_id, date, kind, amount_agorot, status) VALUES (1, 1, ?, 'double', ?, ?)`);
pay.run('2026-09-03', 21500, 'paid');
pay.run('2026-09-20', 21500, 'owed');
pay.run('2026-09-25', 12000, 'void');
pay.run('2026-10-01', 30000, 'paid'); // current month, excluded
pay.run('2026-08-31', 12000, 'paid'); // two months ago, excluded

const m = measure(new DatabaseSync(process.env.DB_PATH, { readOnly: true }), NOW);

test('an active student is one taught lesson in the last 30 days, counted once', () => {
  assert.equal(m.activeStudents, 1);
});

test('revenue is last calendar month, paid and owed apart, void ignored', () => {
  assert.deepEqual(m.revenue, { month: '2026-09', paidAgorot: 21500, owedAgorot: 21500 });
});

test('it says out loud what it cannot measure', () => {
  assert.ok(m.notes.some((n) => n.includes('lessons booked through the site (bookings_v2)')));
});

test('an empty window reports zeros', () => {
  const empty = measure(new DatabaseSync(process.env.DB_PATH, { readOnly: true }), new Date('2030-01-01T00:00:00Z'));
  assert.equal(empty.activeStudents, 0);
  assert.deepEqual(empty.planMix, {
    total: 0,
    other: 0,
    plans: [
      { minutes: 45, kind: 'single', name: 'יחיד', count: 0 },
      { minutes: 90, kind: 'double', name: 'כפול', count: 0 },
      { minutes: 135, kind: 'triple', name: 'משולש', count: 0 },
    ],
  });
});

test('the plan ladder the metric names is the one plans.ts sells', async () => {
  const { PLANS } = await import('../../src/lib/plans.ts');
  assert.deepEqual(PLAN_LADDER, PLANS.map((p) => ({ minutes: p.minutes, kind: p.kind, name: p.name })));
});

test('plan mix counts bookings created in the last 30 days by the stored duration', () => {
  // Seed rows: three confirmed bookings whose `at` is inside the window and
  // whose duration was never stored, plus one cancelled and one too old.
  assert.equal(m.planMix.total, 3);
  assert.equal(m.planMix.other, 3);
  assert.deepEqual(m.planMix.plans.map((p) => p.count), [0, 0, 0]);
  assert.ok(m.notes.some((n) => n.includes('bookings_v2.at')));

  const w = new DatabaseSync(process.env.DB_PATH);
  const ins = w.prepare(
    `INSERT INTO bookings_v2 (student_id, start, "end", duration, at, status) VALUES (1, ?, ?, ?, ?, ?)`);
  const start = daysAgo(1);
  ins.run(start, start, 90, daysAgo(2), 'confirmed');
  ins.run(start, start, 90, daysAgo(3), 'confirmed');
  ins.run(start, start, 45, daysAgo(4), 'confirmed');
  ins.run(start, start, 135, daysAgo(5), 'confirmed');
  ins.run(start, start, 60, daysAgo(6), 'confirmed');      // not a sold plan
  ins.run(start, start, 90, daysAgo(7), 'cancelled');      // excluded
  ins.run(start, start, 90, daysAgo(40), 'confirmed');     // outside the window
  try {
    const later = measure(new DatabaseSync(process.env.DB_PATH, { readOnly: true }), NOW);
    assert.deepEqual(
      Object.fromEntries(later.planMix.plans.map((p) => [p.kind, p.count])),
      { single: 1, double: 2, triple: 1 },
    );
    assert.equal(later.planMix.other, 4);   // three seed rows with no duration, plus 60
    assert.equal(later.planMix.total, 8);   // seed 3 + the five in-window rows above
  } finally {
    w.exec(`DELETE FROM bookings_v2 WHERE duration IS NOT NULL`);
  }
});

test('the 30-day funnel counts each step, which plan, and where the visit came from', async () => {
  const { PLAN_KINDS } = await import('../../scripts/vision-metrics.mjs');
  const { PLANS } = await import('../../src/lib/plans.ts');
  assert.deepEqual(PLAN_KINDS, PLANS.map((p) => [p.kind, p.name]));

  const w = new DatabaseSync(process.env.DB_PATH);
  const ev = w.prepare(
    `INSERT INTO marketing_events (at, visitor_id, event, detail, utm_source, referrer) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  ev.run(daysAgo(2), 'v1', 'landing_visit', null, 'google', 'https://www.google.com');
  ev.run(daysAgo(1), 'v1', 'landing_visit', null, 'google', 'https://www.google.com');
  ev.run(daysAgo(2), 'v2', 'landing_visit', null, 'google', 'https://www.google.com');
  ev.run(daysAgo(4), 'v3', 'landing_visit', null, null, 'https://l.facebook.com');
  ev.run(daysAgo(40), 'v4', 'landing_visit', null, 'google', 'https://www.google.com');
  ev.run(daysAgo(2), 'v1', 'booking_start', null, 'google', 'https://www.google.com');
  ev.run(daysAgo(2), 'v2', 'booking_start', null, 'google', 'https://www.google.com');
  ev.run(daysAgo(2), 'v1', 'plan_selected', 'double', 'google', 'https://www.google.com');
  ev.run(daysAgo(2), 'v2', 'plan_selected', 'single', 'google', 'https://www.google.com');
  ev.run(daysAgo(2), 'v1', 'time_selected', null, 'google', 'https://www.google.com');
  ev.run(daysAgo(2), 'v1', 'booking_submitted', null, 'google', 'https://www.google.com');
  ev.run(daysAgo(2), 'v1', 'lesson_scheduled', null, 'google', 'https://www.google.com');
  w.prepare(`UPDATE bookings_v2 SET heard_from = 'friend' WHERE at = ?`).run(daysAgo(10));
  w.prepare(`UPDATE bookings_v2 SET heard_from = 'google' WHERE at = ?`).run(daysAgo(50));
  try {
    const later = measure(new DatabaseSync(process.env.DB_PATH, { readOnly: true }), NOW);
    const step = Object.fromEntries(later.funnel.steps.map((s) => [s.event, s]));
    assert.deepEqual(later.funnel.steps.map((s) => s.label), [
      'landing view', 'booking start', 'plan selected', 'time selected', 'details submitted', 'booking confirmed',
    ]);
    assert.equal(step.landing_visit.n, 3);
    assert.equal(step.landing_visit.ofPrevious, null);
    assert.equal(step.booking_start.n, 2);
    assert.equal(step.booking_start.ofPrevious, 2 / 3);
    assert.equal(step.booking_start.ofLanding, 2 / 3);
    assert.equal(step.plan_selected.n, 2);
    assert.equal(step.plan_selected.ofPrevious, 1);
    assert.equal(step.time_selected.n, 1);
    assert.equal(step.booking_submitted.n, 1);
    assert.equal(step.lesson_scheduled.n, 1);
    assert.equal(step.lesson_scheduled.ofLanding, 1 / 3);
    assert.deepEqual(later.funnel.plans, { single: 1, double: 1, triple: 0 });
    assert.deepEqual(later.funnel.sources, [
      { source: 'google', visits: 2, confirmed: 1 },
      { source: null, visits: 1, confirmed: 0 },
    ]);
    assert.deepEqual(later.funnel.referrers, [
      { referrer: 'https://www.google.com', visits: 2, confirmed: 1 },
      { referrer: 'https://l.facebook.com', visits: 1, confirmed: 0 },
    ]);
    assert.deepEqual(later.funnel.heardFrom, { friend: 1 });
    assert.ok(later.notes.some((n) => n.includes('anonymous first-party events')));

    const empty = measure(new DatabaseSync(process.env.DB_PATH, { readOnly: true }), new Date('2030-01-01T00:00:00Z'));
    assert.ok(empty.funnel.steps.every((s) => s.n === 0 && s.ofLanding === null && s.ofPrevious === null));
    assert.deepEqual(empty.funnel.plans, { single: 0, double: 0, triple: 0 });
    assert.deepEqual(empty.funnel.sources, []);
    assert.deepEqual(empty.funnel.referrers, []);
    assert.deepEqual(empty.funnel.heardFrom, {});
  } finally {
    w.exec(`DELETE FROM marketing_events`);
    w.exec(`UPDATE bookings_v2 SET heard_from = NULL`);
  }
});
