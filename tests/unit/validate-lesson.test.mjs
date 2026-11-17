// validateLesson is the structural gate between the model and a child.
import '../isolate-lesson-data.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLesson } from '../../src/lib/server/lesson/prep.ts';

/** A lesson that passes every structural check, so each test below varies
 *  exactly one thing and the failure it asserts is unambiguous. */
const base = () => ({
  title: 'שיעור',
  gradeContext: 'כיתה ז',
  slides: [1, 2, 3, 4].map(n => ({ heading: `שקף ${n}`, bullets: ['נקודה'] })),
  examples: [{ problem: '2+2', steps: ['מחברים'], answer: '4' }],
  homework: [{ task: 'תרגיל א', why: 'תרגול' }, { task: 'תרגיל ב', why: 'תרגול' }],
});

test('a well-formed lesson passes', () => {
  assert.deepEqual(validateLesson(base()), [],
    'the fixture must be clean, or every test below is testing the fixture');
});

test('a thin lesson fails every structural minimum', () => {
  const thin = { title: 'x', gradeContext: 'y', slides: [], examples: [], homework: [] };
  const problems = validateLesson(thin);
  assert.equal(problems.length, 3, `expected slides, examples and homework problems, got: ${JSON.stringify(problems)}`);
});

test('too few slides, examples or homework tasks are each reported', () => {
  const plan = base();
  plan.slides = plan.slides.slice(0, 3);
  plan.homework = plan.homework.slice(0, 1);
  const problems = validateLesson(plan);
  assert.equal(problems.length, 2);
});
