import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'tutor-native-results-')), 'db.sqlite');
const E = await import('../../src/lib/server/entities.ts');
const S = await import('../../src/lib/server/plans/store.ts');
const J = await import('../../src/lib/server/native-learning/jobs.ts');
const R = await import('../../src/lib/server/native-learning/results.ts');
const T = await import('../../src/lib/server/native-learning/tutor-results.ts');
const { handle } = await import('../../src/lib/server/db.ts');

const template = { id: 'demo', version: 1, subject: 'מתמטיקה', track: '5', reviewed: null,
 topics: [{ key: 'calc', title: 'חשבון', branches: [{ key: 'calc.r', title: 'כללי', skills: [{ key: 'calc.r.a', title: 'חוקי חזקות', requires: [] }] }] }] };
let seq = 0;
function setup() {
 seq++;
 const account = E.createAccount({ name: `t${seq}`, phone: null, credential: 'x' });
 const student = E.createStudent({ code: `tn${seq}`, name: `s${seq}`, accountId: account.id, credential: 'x' });
 E.upsertEnrollment({ studentId: student.id, subject: 'מתמטיקה', level: 'כיתה יא', teacherId: null });
 const enrollment = E.enrollmentsForStudent(student.id)[0];
 S.createPlan({ studentId: student.id, enrollmentId: enrollment.id, template, goal: 'ב' });
 const bookingId = E.reserveBooking({ studentId: student.id, start: `2029-0${(seq % 9) + 1}-02T10:00:00.000Z`, end: `2029-0${(seq % 9) + 1}-02T11:30:00.000Z`, durationMin: 90 });
 J.enqueueNativeLesson({ bookingId, studentId: student.id });
 handle().prepare('UPDATE native_lesson_jobs SET bundle=? WHERE booking_id=?').run(JSON.stringify({ objectives: [{ id: 'o1', title: 'חוקי חזקות' }] }), bookingId);
 const game = { id: 'g1', title: 'משחק חזקות', kind: 'quiz', rounds: [
  { id: 'r1', prompt: 'שאלה 1', objectiveId: 'o1', grading: 'checked', check: { answer: 42 }, solution: 'SECRET' },
  { id: 'r2', prompt: 'שאלה 2', objectiveId: 'o1', grading: 'tutor-review' }] };
 handle().prepare(`INSERT INTO native_games (material_id,release_id,student_id,booking_id,game_id,kind,content_json,source_file_id,source_revision,content_sha256,approved_at)
  VALUES ('m'||?,'rel',?,?,'g1','quiz',?,'f','1','h','2029-01-01T00:00:00Z')`).run(seq, student.id, bookingId, JSON.stringify(game));
 return { student, bookingId };
}
const rec = (c, roundId, outcome = 'correct', attempts = 1) =>
 R.recordNativeResult({ studentId: c.student.id, bookingId: c.bookingId, gameId: 'g1', roundId, outcome, attempts, seconds: 9 });

test('lists latest result per round grouped by game, with skill title, and no answer keys', () => {
 const c = setup();
 rec(c, 'r1', 'incorrect', 1); rec(c, 'r1', 'correct', 2); rec(c, 'r2');
 const games = T.tutorNativeResults(c.student.id);
 assert.equal(games.length, 1);
 assert.equal(games[0].gameTitle, 'משחק חזקות');
 const r1 = games[0].rounds.find(r => r.roundId === 'r1');
 assert.deepEqual([r1.outcome, r1.attempts, r1.seconds, r1.skillTitle, r1.prompt], ['correct', 2, 9, 'חוקי חזקות', 'שאלה 1']);
 assert.equal(games[0].rounds.find(r => r.roundId === 'r2').outcome, 'awaiting-review');
 assert.doesNotMatch(JSON.stringify(games), /SECRET|answer|solution/);
});

test('results are scoped to the student asked for', () => {
 const a = setup(), b = setup(); rec(a, 'r1');
 assert.equal(T.tutorNativeResults(b.student.id).length, 0);
 assert.equal(T.tutorNativeResults(a.student.id).length, 1);
});

test('tutor decides an awaiting-review round once; progress row becomes appendable; other students refused', () => {
 const a = setup(), b = setup();
 const open = rec(a, 'r2');
 assert.equal(R.progressRowForResult(open, 'calc.r.a', { studentRef: 's', lessonId: 'l', assignmentId: 'a' }), null);
 assert.throws(() => T.decideTutorReview(b.student.id, open.id, 'correct'), e => e.status === 404);
 assert.throws(() => T.decideTutorReview(a.student.id, open.id, 'awaiting-review'), e => e.status === 400);
 assert.throws(() => T.decideTutorReview(a.student.id, 'x', 'correct'), e => e.status === 400);
 const done = T.decideTutorReview(a.student.id, open.id, 'assisted');
 assert.equal(done.outcome, 'assisted');
 assert.ok(R.progressRowForResult(done, 'calc.r.a', { studentRef: 's', lessonId: 'l', assignmentId: 'a' }));
 assert.throws(() => T.decideTutorReview(a.student.id, open.id, 'correct'), e => e.status === 409);
});
