// tests/unit/skill-evidence.test.mjs
//
// Gathering what a skill actually has behind it.
//
// This is the read half of the link added in #98: game plays reach a skill
// through native_results.skill_node_id, written work through
// homework.node_id. The engine in plans/suggest.ts is pure and takes this
// as input; this file is where the SQL that feeds it is held to the one
// rule that matters — evidence belongs to the child who produced it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'skill-ev-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const S = await import('../../src/lib/server/plans/store.ts');
const L = await import('../../src/lib/server/lessons.ts');
const EV = await import('../../src/lib/server/plans/evidence.ts');
const { handle } = await import('../../src/lib/server/db.ts');

const template = {
  id: 'demo', version: 1, subject: 'מתמטיקה', track: '5 יח״ל', reviewed: null,
  topics: [{
    key: 'calc', title: 'חשבון',
    branches: [{
      key: 'calc.r', title: 'כללי גזירה',
      skills: [
        { key: 'calc.r.a', title: 'חוקי חזקות', requires: [] },
        { key: 'calc.r.b', title: 'כלל המנה', requires: ['calc.r.a'] },
      ],
    }],
  }],
};

let seq = 0;
function freshPlan() {
  seq += 1;
  const account = E.createAccount({ name: `משפחה ${seq}`, phone: null, credential: 'x' });
  const student = E.createStudent({ code: `kid${seq}`, name: `תלמיד ${seq}`, accountId: account.id, credential: 'x' });
  E.upsertEnrollment({ studentId: student.id, subject: 'מתמטיקה', level: 'כיתה יא', teacherId: null });
  const enrollment = E.enrollmentsForStudent(student.id)[0];
  const planId = S.createPlan({ studentId: student.id, enrollmentId: enrollment.id, template, goal: 'ב' });
  const nodes = S.planData(planId).nodes.filter(n => n.kind === 'skill');
  return { student, planId, nodes };
}

/** One answered round of an approved native game, as recordNativeResult stores it. */
const addResult = (studentId, nodeId, gameId, at, outcomes, bookingId = null) =>
  outcomes.forEach((outcome, i) => handle().prepare(
    `INSERT INTO native_results (student_id, booking_id, game_id, round_id, skill_node_id, outcome, attempts, at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
  ).run(studentId, bookingId, gameId, `${gameId}-r${i}`, nodeId === null ? null : String(nodeId), outcome, at));

test('a skill with nothing behind it gathers nothing', () => {
  const { student, nodes } = freshPlan();
  const ev = EV.evidenceForSkill(student.id, nodes[0].id);
  assert.deepEqual(ev, { plays: [], homework: [] });
});

test('plays of native games become evidence for their skill', () => {
  const { student, nodes } = freshPlan();
  addResult(student.id, nodes[0].id, 'game-a', '2026-09-01', ['correct', 'correct', 'incorrect', 'correct']);
  addResult(student.id, nodes[0].id, 'game-b', '2026-09-03', ['correct', 'assisted', 'correct', 'correct']);

  const ev = EV.evidenceForSkill(student.id, nodes[0].id);
  assert.equal(ev.plays.length, 2);
  assert.deepEqual(ev.plays.map(p => [p.score, p.total]), [[3, 4], [4, 4]]);
  assert.deepEqual(ev.plays.map(p => p.hints), [0, 1], 'an assisted round counts as a hint');
  assert.equal(ev.plays[0].at, '2026-09-01', 'oldest first, so a trend reads forwards');
});

test('a play with no plan skill is evidence for nothing', () => {
  const { student, nodes } = freshPlan();
  addResult(student.id, null, 'not-linked', '2026-09-01', ['correct', 'correct']);
  assert.equal(EV.evidenceForSkill(student.id, nodes[0].id).plays.length, 0);
});

test('an answer awaiting the tutor is not evidence yet', () => {
  const { student, nodes } = freshPlan();
  addResult(student.id, nodes[0].id, 'open-ended', '2026-09-01', ['awaiting-review', 'awaiting-review']);
  assert.equal(EV.evidenceForSkill(student.id, nodes[0].id).plays.length, 0);
});

test("one child's play never becomes evidence about another child", () => {
  // The same game goes to many children; each result belongs to the child
  // who answered it.
  const a = freshPlan();
  const b = freshPlan();
  addResult(b.student.id, b.nodes[0].id, 'shared', '2026-09-01', ['correct', 'correct']);

  assert.equal(EV.evidenceForSkill(a.student.id, a.nodes[0].id).plays.length, 0,
    "child A has no plays; B's must not appear under A's skill");
  assert.equal(EV.evidenceForSkill(b.student.id, b.nodes[0].id).plays.length, 1);
});

test('plays of a game tied to a different skill do not leak across skills', () => {
  const { student, nodes } = freshPlan();
  addResult(student.id, nodes[1].id, 'game-b', '2026-09-01', ['correct', 'correct']);
  assert.equal(EV.evidenceForSkill(student.id, nodes[0].id).plays.length, 0);
  assert.equal(EV.evidenceForSkill(student.id, nodes[1].id).plays.length, 1);
});

test('homework tagged with the skill becomes evidence, with its grade', () => {
  const { student, nodes } = freshPlan();
  const id = L.addHomework({ studentId: student.id, task: 'תרגיל', nodeId: nodes[0].id });
  L.gradeHomework(id, 'ok');

  const ev = EV.evidenceForSkill(student.id, nodes[0].id);
  assert.equal(ev.homework.length, 1);
  assert.equal(ev.homework[0].grade, 'ok');
  assert.equal(ev.homework[0].submitted, true, 'grading establishes the work exists');
});

test('untagged homework is evidence for no skill', () => {
  const { student, nodes } = freshPlan();
  L.addHomework({ studentId: student.id, task: 'תרגיל' });
  assert.equal(EV.evidenceForSkill(student.id, nodes[0].id).homework.length, 0);
});

test('ungraded homework arrives ungraded rather than as a pass', () => {
  const { student, nodes } = freshPlan();
  L.addHomework({ studentId: student.id, task: 'תרגיל', nodeId: nodes[0].id });
  const ev = EV.evidenceForSkill(student.id, nodes[0].id);
  assert.equal(ev.homework[0].grade, null);
  assert.equal(ev.homework[0].submitted, false);
});
