import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'les-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const L = await import('../../src/lib/server/lessons.ts');
const { handle } = await import('../../src/lib/server/db.ts');

const acct = E.createAccount({ name: 'משפחה', credential: 'x' });
const stu  = E.createStudent({ code: 'noga', name: 'נוגה', accountId: acct.id, credential: 'p' });

test('new homework is neither submitted nor graded', () => {
  L.addHomework({ studentId: stu.id, task: 'משחק זיכרון' });

  const hw = L.homeworkForStudent(stu.id);
  assert.equal(hw.length, 1);
  assert.equal(hw[0].submitted, false);
  assert.equal(hw[0].graded, false);
});

test('playing a native game does not submit homework — homework is submitted by hand', () => {
  const id = L.addHomework({ studentId: stu.id, task: 'ציד טעויות' });
  handle().prepare(
    `INSERT INTO native_results (student_id, game_id, round_id, outcome, attempts, at) VALUES (?, 'game-1', 'r1', 'correct', 1, '2026-09-01')`
  ).run(stu.id);

  const item = L.homeworkForStudent(stu.id).find(h => h.id === id);
  assert.equal(item.submitted, false);
  assert.equal(item.graded, false);
});

test('written work is submitted by hand', () => {
  const id = L.addHomework({ studentId: stu.id, task: 'תרגילים 1-10 בספר' });
  const find = () => L.homeworkForStudent(stu.id).find(h => h.id === id);
  assert.equal(find().submitted, false);

  L.setHomeworkSubmitted(id, true, 'student');
  assert.equal(find().submitted, true);
  assert.equal(find().submitted_by, 'student', 'who said so is part of the claim');
  assert.equal(find().graded, false, 'saying you did it is not a mark');

  // Reversible: a child who taps it by accident has to be able to take it back.
  L.setHomeworkSubmitted(id, false, 'student');
  assert.equal(find().submitted, false);
});

test('grading records the submission too, because looking at work proves it exists', () => {
  const id = L.addHomework({ studentId: stu.id, task: 'תרגילים 11-20 בספר' });
  const find = () => L.homeworkForStudent(stu.id).find(h => h.id === id);

  L.gradeHomework(id, 'partial', 'teacher');
  assert.equal(find().graded, true);
  assert.equal(find().grade, 'partial');
  assert.equal(find().graded_by, 'teacher');
  assert.equal(find().submitted, true, 'she read it, so it was handed in');
});

test('a grade can be taken back without unsubmitting the work', () => {
  const id = L.addHomework({ studentId: stu.id, task: 'תרגיל נוסף' });
  L.setHomeworkSubmitted(id, true, 'student');
  L.gradeHomework(id, 'redo', 'teacher');
  L.gradeHomework(id, null);

  const row = L.homeworkForStudent(stu.id).find(h => h.id === id);
  assert.equal(row.graded, false);
  assert.equal(row.grade, null);
  assert.equal(row.submitted, true, 'the child still did it');
});

test('an automatic grade is distinguishable from the tutor\'s', () => {
  // Grading can be machine-filled later. A parent is entitled to tell a mark
  // the tutor gave from one a program produced.
  const id = L.addHomework({ studentId: stu.id, task: 'משחק' });
  L.gradeHomework(id, 'ok', 'auto');
  const row = L.homeworkForStudent(stu.id).find(h => h.id === id);
  assert.equal(row.graded_by, 'auto');
  assert.notEqual(row.graded_by, 'teacher');
});
