import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = await mkdtemp(join(tmpdir(), 'marketing-trends-'));
process.env.DB_PATH = join(dataDir, 'results.db');
const { handle } = await import('../../src/lib/server/db.ts');
const { marketingTrends } = await import('../../src/lib/server/marketing-trends.ts');
const { recordEvent } = await import('../../src/lib/server/marketing.ts');
const E = await import('../../src/lib/server/entities.ts');
const P = await import('../../src/lib/server/payments.ts');

const account = E.createAccount({ name: 'Synthetic family', credential: 'test' });
const student = E.createStudent({ code: 'trends', name: 'Synthetic student', accountId: account.id, credential: 'test' });

test('daily visitors deduplicate across sources, reset at Israel midnight, and exclude events outside the exact window', () => {
  for (const [at, visitorId, source] of [
    ['2026-07-01T20:59:59.000Z', 'repeat', 'a'],
    ['2026-07-01T20:59:59.000Z', 'repeat', 'b'],
    ['2026-07-01T21:00:00.000Z', 'repeat', 'a'],
    ['2026-07-02T08:00:00.000Z', 'other', 'a'],
    ['2026-06-30T21:00:00.000Z', 'too-early', 'a'],
    ['2026-07-02T10:00:00.001Z', 'too-late', 'a'],
  ]) recordEvent({ event: 'landing_visit', at, visitorId, utm: { source } });
  recordEvent({ event: 'landing_visit', at: '2026-07-02T08:00:00.000Z' });
  recordEvent({ event: 'cta_click', target: 'booking', at: '2026-07-02T08:00:00.000Z', visitorId: 'click-only' });
  recordEvent({ event: 'lesson_scheduled', at: '2026-07-02T10:00:00.000Z' });
  const days = marketingTrends('2026-07-01T10:00:00.000Z', '2026-07-02T10:00:00.000Z');
  assert.deepEqual(days.map(d => [d.date, d.visitors, d.bookings]), [['2026-07-01', 1, 0], ['2026-07-02', 2, 1]]);
  assert.ok(days.every(d => !('visitor_id' in d)), 'only aggregates leave the server');
});

test('empty days are zero-filled through the DST change without skipped or duplicate dates', () => {
  const days = marketingTrends('2026-10-23T12:00:00.000Z', '2026-10-26T12:00:00.000Z');
  assert.deepEqual(days.map(d => d.date), ['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26']);
  assert.ok(days.every(d => d.visitors === 0 && d.bookings === 0));
  recordEvent({ event: 'landing_visit', at: '2026-10-24T21:30:00.000Z', visitorId: 'summer' });
  recordEvent({ event: 'landing_visit', at: '2026-10-25T21:30:00.000Z', visitorId: 'winter' });
  const result = marketingTrends('2026-10-23T12:00:00.000Z', '2026-10-26T12:00:00.000Z');
  assert.equal(result.find(d => d.date === '2026-10-25').visitors, 2);
  assert.equal(result.find(d => d.date === '2026-10-26').visitors, 0);
});

test('payments aggregate integer agorot by charge date/current status, exclude void and out-of-range charges', () => {
  for (const [date, amountAgorot, status] of [
    ['2026-11-01', 3333, 'paid'], ['2026-11-01', 3333, 'paid'],
    ['2026-11-01', 21500, 'owed'], ['2026-11-01', 99000, 'void'],
    ['2026-10-31', 88800, 'paid'], ['2026-11-03', 88800, 'paid'],
  ]) P.addPayment({ accountId: account.id, studentId: student.id, date, kind: 'single', amountAgorot, status });
  const days = marketingTrends('2026-11-01T08:00:00.000Z', '2026-11-02T08:00:00.000Z');
  assert.deepEqual(days.map(d => [d.date, d.paidAgorot, d.owedAgorot]), [['2026-11-01', 6666, 21500], ['2026-11-02', 0, 0]]);
});

test.after(async () => { handle().close(); await rm(dataDir, { recursive: true, force: true }); });
