/**
 * How long the deck is follows the lesson's plan: a 45-minute lesson and a
 * 135-minute one used to be asked for the same "6-10 slides".
 */
import '../isolate-lesson-data.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { slideTarget } = await import('../../src/lib/server/lesson/prep.ts');
const { PLANS } = await import('../../src/lib/plans.ts');

test('every plan says how long its deck is, and longer lessons get longer decks', () => {
  const counts = PLANS.map(p => p.slides);
  for (const n of counts) assert.ok(Number.isInteger(n) && n >= 4, 'validateLesson refuses fewer than 4');
  assert.deepEqual([...counts].sort((a, b) => a - b), counts);
  assert.equal(PLANS.find(p => p.minutes === 45).slides, 8);
  assert.equal(PLANS.find(p => p.minutes === 135).slides, 14);
});

test('the slide instruction follows the plan, and keeps the old range when there is none', () => {
  assert.equal(slideTarget(45), 'בערך 8 שקפים');
  assert.equal(slideTarget(135), 'בערך 14 שקפים');
  assert.equal(slideTarget(undefined), '6-10 שקפים');
  assert.equal(slideTarget(50), '6-10 שקפים', 'a duration with no plan is not guessed at');
});
