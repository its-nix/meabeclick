import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'native-results-')), 'db.sqlite');
const E = await import('../../src/lib/server/entities.ts');
const S = await import('../../src/lib/server/plans/store.ts');
const J = await import('../../src/lib/server/native-learning/jobs.ts');
const R = await import('../../src/lib/server/native-learning/results.ts');
const EV = await import('../../src/lib/server/plans/evidence.ts');
const W = await import('../../src/lib/learning/workspace.ts');
const { handle } = await import('../../src/lib/server/db.ts');

const template = { id: 'demo', version: 1, subject: 'מתמטיקה', track: '5 יח״ל', reviewed: null,
 topics: [{ key: 'calc', title: 'חשבון', branches: [{ key: 'calc.r', title: 'כללי גזירה', skills: [
  { key: 'calc.r.a', title: 'חוקי חזקות', requires: [] }, { key: 'calc.r.b', title: 'כלל המנה', requires: [] }] }] }] };
let seq = 0;
function setup() {
 seq++;
 const account = E.createAccount({ name: `f${seq}`, phone: null, credential: 'x' });
 const student = E.createStudent({ code: `nr${seq}`, name: `s${seq}`, accountId: account.id, credential: 'x' });
 E.upsertEnrollment({ studentId: student.id, subject: 'מתמטיקה', level: 'כיתה יא', teacherId: null });
 const enrollment = E.enrollmentsForStudent(student.id)[0];
 const planId = S.createPlan({ studentId: student.id, enrollmentId: enrollment.id, template, goal: 'ב' });
 const nodes = S.planData(planId).nodes.filter(n => n.kind === 'skill');
 const bookingId = E.reserveBooking({ studentId: student.id, start: `2029-0${(seq % 9) + 1}-01T10:00:00.000Z`, end: `2029-0${(seq % 9) + 1}-01T11:30:00.000Z`, durationMin: 90 });
 J.enqueueNativeLesson({ bookingId, studentId: student.id });
 const bundle = { objectives: [{ id: 'o1', title: 'חוקי חזקות' }, { id: 'o2', title: 'נושא אחר' }] };
 handle().prepare('UPDATE native_lesson_jobs SET bundle=? WHERE booking_id=?').run(JSON.stringify(bundle), bookingId);
 const game = { id: 'g1', kind: 'quiz', rounds: [
  { id: 'r1', objectiveId: 'o1', grading: 'checked' }, { id: 'r2', objectiveId: 'o1', grading: 'checked' },
  { id: 'r3', objectiveId: 'o1', grading: 'tutor-review' }, { id: 'r4', objectiveId: 'o2', grading: 'checked' }] };
 handle().prepare(`INSERT INTO native_games (material_id,release_id,student_id,booking_id,game_id,kind,content_json,source_file_id,source_revision,content_sha256,approved_at)
  VALUES ('m'||?,'rel',?,?,'g1','quiz',?,'f','1','h','2029-01-01T00:00:00Z')`).run(seq, student.id, bookingId, JSON.stringify(game));
 return { student, bookingId, nodes };
}
const rec = (c, roundId, outcome = 'correct', attempts = 1) =>
 R.recordNativeResult({ studentId: c.student.id, bookingId: c.bookingId, gameId: 'g1', roundId, outcome, attempts, seconds: 12 });

test('the server resolves the plan skill from the approved round; unmatched objectives store null', () => {
 const c = setup();
 assert.equal(rec(c, 'r1').skillNodeId, String(c.nodes.find(n => n.title === 'חוקי חזקות').id));
 assert.equal(rec(c, 'r4').skillNodeId, null);
 assert.throws(() => rec(c, 'nope'), /approved game/);
 assert.throws(() => R.recordNativeResult({ studentId: c.student.id + 999, bookingId: c.bookingId, gameId: 'g1', roundId: 'r1', outcome: 'correct', attempts: 1, seconds: 1 }), /approved game/);
 assert.throws(() => rec(c, 'r1', 'bogus'), /outcome/);
});

test('tutor-review rounds wait, and only the tutor function finalises them once', () => {
 const c = setup();
 const r = rec(c, 'r3', 'correct');
 assert.equal(r.outcome, 'awaiting-review');
 assert.equal(R.recordTutorReviewOutcome({ resultId: r.id, outcome: 'assisted' }).outcome, 'assisted');
 assert.throws(() => R.recordTutorReviewOutcome({ resultId: r.id, outcome: 'correct' }), /awaiting/);
 assert.throws(() => R.recordTutorReviewOutcome({ resultId: r.id, outcome: 'awaiting-review' }), /invalid/);
});

test('results map to Progress rows that pass the workspace rules, and append is idempotent via a fake Sheet', async () => {
 const c = setup();
 rec(c, 'r1'); rec(c, 'r2', 'assisted', 2); rec(c, 'r3'); rec(c, 'r4');
 const ctx = () => ({ studentRef: 'st-1', lessonId: 'l-1', assignmentId: 'a-1' });
 const store = [];
 const sheet = { progressIds: async () => new Set(store.map(r => r.evidence_id)), appendProgress: async rows => { store.push(...rows); } };
 assert.deepEqual(await R.appendNativeResultsToProgress({ sheet, studentId: c.student.id, context: ctx }), { appended: 2, skipped: 2 });
 assert.deepEqual(await R.appendNativeResultsToProgress({ sheet, studentId: c.student.id, context: ctx }), { appended: 0, skipped: 4 });
 assert.deepEqual(store.map(r => [r.skill, r.outcome, r.support, r.evidence_type]), [
  ['calc.r.a', 'demonstrated', 'independent', 'game'], ['calc.r.a', 'practising', 'guided', 'game']]);
 const snap = { version: 1, Students: [{ student_id: 'st-1', display_name: 'x', subject: 'מ', education_level: 'ת', status: 'active', is_demo: false }],
  Lessons: [{ lesson_id: 'l-1', student_id: 'st-1', date: '2029-01-01', goals: 'g', status: 'planned', is_demo: false }],
  Materials: [], Assignments: [], Progress: store.map(r => ({ ...r, assignment_id: '' })) };
 assert.deepEqual(W.workspaceProblems(snap), []);
});

test('a native result appears in parent evidence against its plan skill, and only for its own student', () => {
 const c = setup(), other = setup();
 const node = c.nodes.find(n => n.title === 'חוקי חזקות');
 rec(c, 'r1'); rec(c, 'r2', 'incorrect'); rec(c, 'r3');
 const ev = EV.evidenceForSkill(c.student.id, node.id);
 assert.equal(ev.plays.length, 1);
 assert.deepEqual([ev.plays[0].score, ev.plays[0].total], [1, 2]);
 assert.equal(EV.evidenceForSkill(other.student.id, node.id).plays.length, 0);
 assert.equal(EV.evidenceForSkill(c.student.id, c.nodes.find(n => n.title === 'כלל המנה').id).plays.length, 0);
});
