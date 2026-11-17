// tests/unit/lesson-skill-link.test.mjs
//
// The link that makes practice into evidence about a skill.
//
// Spec §2: game results and homework already carry everything an assessment
// wants — outcome, attempts, whether the work was done — and
// neither was connected to a skill. Every suggestion rule in §3.2 dies here.
//
// The link is made by the PIPELINE, never by the model. The generator is
// told a skill's TITLE; the node id stays on the server and is what the
// rows are tagged with. A model asked for an id can return one that does
// not exist or belongs to another student's plan.
//
// Generated homework is OFFLINE work written for one skill, so it carries
// node_id; game results reach their skill through native_results.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'skill-link-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const S = await import('../../src/lib/server/plans/store.ts');
const L = await import('../../src/lib/server/lessons.ts');
const T = await import('../../src/lib/server/lesson/targeting.ts');
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
function freshStudent() {
  seq += 1;
  const account = E.createAccount({ name: `משפחה ${seq}`, phone: null, credential: 'x' });
  const student = E.createStudent({ code: `kid${seq}`, name: `תלמיד ${seq}`, accountId: account.id, credential: 'x' });
  E.upsertEnrollment({ studentId: student.id, subject: 'מתמטיקה', level: 'כיתה יא', teacherId: null });
  const enrollment = E.enrollmentsForStudent(student.id)[0];
  return { student, enrollment };
}

test('a student with a plan gets the first unblocked skill as the lesson target', () => {
  const { student, enrollment } = freshStudent();
  S.createPlan({ studentId: student.id, enrollmentId: enrollment.id, template, goal: 'בגרות' });

  const target = T.targetSkillFor(student.code, 'מתמטיקה');
  assert.ok(target, 'a student with a plan must have a target');
  assert.equal(target.title, 'חוקי חזקות', 'the second skill is blocked by the first');
});

test('a student with no plan targets nothing, and that is not an error', () => {
  // The overwhelmingly common case today: nobody has a plan until the tutor
  // builds one. Generation must carry on exactly as before and simply
  // produce no evidence link.
  const { student } = freshStudent();
  assert.equal(T.targetSkillFor(student.code, 'מתמטיקה'), null);
});

test('a subject with no enrollment targets nothing rather than another subject\'s plan', () => {
  const { student, enrollment } = freshStudent();
  S.createPlan({ studentId: student.id, enrollmentId: enrollment.id, template, goal: 'בגרות' });
  assert.equal(T.targetSkillFor(student.code, 'פיזיקה'), null,
    "a physics lesson must not be tagged with a maths plan's skill");
});

test('an unknown student code targets nothing', () => {
  assert.equal(T.targetSkillFor('nobody', 'מתמטיקה'), null);
});

test('homework records the skill it practises', () => {
  const { student, enrollment } = freshStudent();
  const planId = S.createPlan({ studentId: student.id, enrollmentId: enrollment.id, template, goal: 'בגרות' });
  const nodeId = S.planData(planId).nodes.find(n => n.key === 'calc.r.a').id;

  const id = L.addHomework({ studentId: student.id, task: 'תרגיל', nodeId });
  const row = handle().prepare('SELECT node_id FROM homework WHERE id = ?').get(id);
  assert.equal(row.node_id, nodeId);
});

test('homework with no skill is null, not zero', () => {
  // Null means "this practice is not evidence about any skill". Zero would
  // be a node id, and node 0 does not exist — a falsy id that reads as
  // "unset" in one place and as a lookup in another is how this codebase
  // has produced silent wrong answers before.
  const { student } = freshStudent();
  const id = L.addHomework({ studentId: student.id, task: 'תרגיל' });
  const row = handle().prepare('SELECT node_id FROM homework WHERE id = ?').get(id);
  assert.equal(row.node_id, null);
});
