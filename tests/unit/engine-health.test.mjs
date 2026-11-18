// Whether the lesson engine is down, and until when — so the tutor reads it
// on her dashboard instead of learning it from a booking that failed.
//
// On 2026-09-30 production's Codex account ran out of usage; Codex said when
// it would be back ("try again at Oct 12th, 2026 7:26 PM"), and the app threw
// that away: the log said "codex exited 1", the dashboard said nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = await mkdtemp(join(tmpdir(), 'engine-health-'));
process.env.DB_PATH = join(process.env.DATA_DIR, 'db.sqlite');
const H = await import('../../src/lib/server/lesson/engine-health.ts');
const { spawnAgent } = await import('../../src/lib/server/lesson/spawn.ts');
const E = await import('../../src/lib/server/entities.ts');
const { handle } = await import('../../src/lib/server/db.ts');
const J = await import('../../src/lib/server/native-learning/jobs.ts');

test("the reset time is read from Codex's own words, and nothing else is", () => {
  const now = new Date('2026-10-01T09:00:00');
  assert.equal(H.parseRetryAt("You've hit your usage limit ... or try again at Oct 12th, 2026 7:26 PM.", now),
    new Date('Oct 12, 2026 7:26 PM').toISOString());
  assert.equal(H.parseRetryAt('... or try again at 7:38 PM.', now), new Date('2026-10-01T19:38:00').toISOString(), 'a time alone is today');
  assert.equal(H.parseRetryAt('... or try again at 8:05 AM.', now), new Date('2026-10-02T08:05:00').toISOString(), 'unless it has passed: tomorrow');
  assert.equal(H.parseRetryAt('codex exited 1', now), null);
  assert.equal(H.parseRetryAt('try again at <script>alert(1)</script>', now), null);
});

test('a quota or sign-in failure marks the engine down; a success marks it up', () => {
  H.noteEngineFailure('codex', 'engine-quota', 'try again at Oct 12th, 2026 7:26 PM.');
  const down = H.engineDown('codex');
  assert.equal(down.kind, 'engine-quota');
  assert.equal(down.until, new Date('Oct 12, 2026 7:26 PM').toISOString());
  H.noteEngineSuccess('codex');
  assert.equal(H.engineDown('codex'), null);

  H.noteEngineFailure('codex', 'bad-output', 'not JSON');
  assert.equal(H.engineDown('codex'), null, 'one bad lesson is not the engine down');
});

/** A fake codex that says `out` on stdout and exits `code`. */
async function stub(out, code) {
  const dir = await mkdtemp(join(tmpdir(), 'stub-codex-'));
  const script = join(dir, 'codex');
  await writeFile(script, `#!/bin/sh\ncat > /dev/null\nprintf '%s' "${out}"\nexit ${code}\n`, { mode: 0o755 });
  return script;
}

test('every Codex run reports itself: the quota message marks it down, the next good run up', async () => {
  const quota = await stub("ERROR: You've hit your usage limit. try again at Oct 12th, 2026 7:26 PM.", 1);
  await assert.rejects(() => spawnAgent(quota, [], 'p', tmpdir(), { label: 'codex', timeoutMs: 10_000 }));
  assert.equal(H.engineDown('codex')?.kind, 'engine-quota');
  const ok = await stub('done', 0);
  await spawnAgent(ok, [], 'p', tmpdir(), { label: 'codex', timeoutMs: 10_000 });
  assert.equal(H.engineDown('codex'), null);
});

test('the dashboard is told which coming lessons have no draft because of it', () => {
  const account = E.createAccount({ name: 'Synthetic', credential: 'test' });
  const day = (n) => `2099-06-${String(n).padStart(2, '0')}`;
  const failed = (code, name, n, errorCode) => {
    const student = E.createStudent({ code, name, accountId: account.id, credential: 'test' });
    const bookingId = E.reserveBooking({ studentId: student.id, start: `${day(n)}T10:00:00.000Z`, end: `${day(n)}T11:30:00.000Z`, durationMin: 90 });
    J.enqueueNativeLesson({ bookingId, studentId: student.id });
    handle().prepare(`UPDATE native_lesson_jobs SET state='failed', error_code=? WHERE booking_id=?`).run(errorCode, bookingId);
  };
  failed('eh-noga', 'נוגה', 3, 'engine-quota');
  failed('eh-alon', 'אלון', 4, 'bad-output');
  const past = E.createStudent({ code: 'eh-past', name: 'עבר', accountId: account.id, credential: 'test' });
  const pastBooking = E.reserveBooking({ studentId: past.id, start: '2020-06-03T10:00:00.000Z', end: '2020-06-03T11:30:00.000Z', durationMin: 90 });
  J.enqueueNativeLesson({ bookingId: pastBooking, studentId: past.id });
  handle().prepare(`UPDATE native_lesson_jobs SET state='failed', error_code='engine-quota' WHERE booking_id=?`).run(pastBooking);

  assert.equal(H.engineAlert(), null, 'nothing to say while the engine is up');
  H.noteEngineFailure('codex', 'engine-quota', 'try again at Oct 12th, 2026 7:26 PM.');
  const alert = H.engineAlert();
  assert.equal(alert.kind, 'engine-quota');
  assert.deepEqual(alert.affected.map(a => a.student), ['נוגה'], 'coming, and failed because the engine is down — not for another reason, not past');
  H.noteEngineSuccess('codex');
});
