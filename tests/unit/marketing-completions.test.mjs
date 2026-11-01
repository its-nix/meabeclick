import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'marketing-completions-')), 'results.db');
const { handle } = await import('../../src/lib/server/db.ts');
const E = await import('../../src/lib/server/entities.ts');
const M = await import('../../src/lib/server/marketing.ts');
const account = E.createAccount({ name: 'Synthetic family', credential: 'x' });
const student = E.createStudent({ code: 'completion-one', name: 'Synthetic one', accountId: account.id, credential: 'x' });
const other = E.createStudent({ code: 'completion-two', name: 'Synthetic two', accountId: account.id, credential: 'x' });
const since = '2029-01-01T00:00:00.000Z';
const until = '2029-01-31T00:00:00.000Z';

beforeEach(() => {
  handle().exec('DELETE FROM marketing_events; DELETE FROM lesson_reports; DELETE FROM bookings_v2;');
});

function booking({ start = '2029-01-10T10:00:00Z', end = '2029-01-10T10:45:00Z', status = 'confirmed', studentId = student.id } = {}) {
  return Number(handle().prepare(`INSERT INTO bookings_v2 (student_id, start, "end", duration, at, status)
    VALUES (?, ?, ?, 45, ?, ?)`).run(studentId, start, end, since, status).lastInsertRowid);
}
function report(id, { at = '2029-01-20T00:00:00Z', studentId = student.id } = {}) {
  handle().prepare(`INSERT INTO lesson_reports (booking_id, student_id, enrollment_id, created_at, updated_at)
    VALUES (?, ?, NULL, ?, ?)`).run(id, studentId, at, at);
}
function scheduled(id, source = 'synthetic', at = since) {
  assert.equal(M.recordEvent({ event: 'lesson_scheduled', bookingId: id, at, utm: { source } }), true);
}

test('a past booking is not attendance evidence without a matching tutor report', () => {
  const id = booking();
  scheduled(id);
  const row = M.funnel(since, until)[0];
  assert.equal(row.lessonsHeld, 1, 'legacy elapsed-booking field remains compatible');
  assert.equal(row.reportedLessons, 0);
  assert.equal(row.secondLessons, 0);
  assert.deepEqual({ ...M.funnelCompletionTotals(since, until) }, { reportedLessons: 0, secondLessons: 0 });
});

test('second lesson is the exact second reported lesson in lesson-time order, including pre-window history', () => {
  const first = booking({ start: '2028-12-20T10:00:00Z', end: '2028-12-20T10:45:00Z' });
  const second = booking();
  const third = booking({ start: '2029-01-22T10:00:00Z', end: '2029-01-22T10:45:00Z' });
  // Filing order does not determine lesson order. The first lesson has no
  // in-window marketing event, but still establishes this student's history.
  report(first, { at: '2029-01-25T00:00:00Z' });
  report(second, { at: '2029-01-15T00:00:00Z' });
  report(third, { at: '2029-01-23T00:00:00Z' });
  scheduled(first, 'old', '2028-12-01T00:00:00Z');
  scheduled(second, 'second');
  scheduled(third, 'third');
  const rows = M.funnel(since, until);
  assert.equal(rows.find(r => r.source === 'second').secondLessons, 1);
  assert.equal(rows.find(r => r.source === 'third').secondLessons, 0);
  assert.equal(rows.some(r => r.source === 'old'), false);
  assert.deepEqual({ ...M.funnelCompletionTotals(since, until) }, { reportedLessons: 2, secondLessons: 1 });
});

test('cancelled, future, mismatched and late reports do not count or advance the ordinal', () => {
  const cancelled = booking({ status: 'cancelled' }); report(cancelled); scheduled(cancelled);
  const future = booking({ end: '2029-02-01T00:00:00Z' }); report(future); scheduled(future);
  const mismatched = booking(); report(mismatched, { studentId: other.id }); scheduled(mismatched);
  const late = booking(); report(late, { at: '2029-01-31T00:00:00.001Z' }); scheduled(late);
  const valid = booking(); report(valid); scheduled(valid);
  assert.deepEqual({ ...M.funnelCompletionTotals(since, until) }, { reportedLessons: 1, secondLessons: 0 });
});

test('duplicate events, attribution corrections and report edits never inflate completion totals', () => {
  const first = booking(); report(first); scheduled(first); scheduled(first);
  const second = booking({ start: '2029-01-11T10:00:00Z' }); report(second); scheduled(second); scheduled(second, 'corrected');
  handle().prepare('UPDATE lesson_reports SET note = ?, updated_at = ? WHERE booking_id = ?')
    .run('Synthetic correction', '2029-02-10T00:00:00Z', second);
  const rows = M.funnel(since, until);
  assert.equal(rows.find(r => r.source === 'synthetic').reportedLessons, 2);
  assert.equal(rows.find(r => r.source === 'synthetic').secondLessons, 1);
  assert.equal(rows.find(r => r.source === 'corrected').reportedLessons, 1);
  assert.deepEqual({ ...M.funnelCompletionTotals(since, until) }, { reportedLessons: 2, secondLessons: 1 });
});

test('cutoff is inclusive and compares instants across offsets; each student has independent history', () => {
  const first = booking({ end: '2029-01-31T02:00:00+02:00' });
  report(first, { at: '2029-01-31T02:00:00+02:00' }); scheduled(first, 'one', until);
  const separate = booking({ studentId: other.id });
  report(separate, { studentId: other.id }); scheduled(separate, 'two');
  assert.deepEqual({ ...M.funnelCompletionTotals(since, until) }, { reportedLessons: 2, secondLessons: 0 });
});
