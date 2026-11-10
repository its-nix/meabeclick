import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePlan } from '../../scripts/pr-qa/plan.mjs';
import { JOURNEY_IDS } from '../../scripts/pr-qa/catalog.mjs';

const head = 'a'.repeat(40);
const plan = { version: 1, headSha: head, mode: 'selected', journeys: ['roles-smoke', 'payments'], unmappedRoutes: [] };
test('valid selected plan preserves explicit journeys', () => {
  assert.deepEqual(validatePlan(plan, head).journeys, plan.journeys);
});
test('stale, unknown, empty, incomplete and skipped plans cannot pass as UI runs', () => {
  for (const patch of [
    { headSha: 'b'.repeat(40) }, { journeys: ['invented'] }, { journeys: [] },
    { journeys: ['payments'] }, { mode: 'full' }, { mode: 'skip' },
    { unmappedRoutes: ['/new-page'] }, { version: 2 },
  ]) assert.throws(() => validatePlan({ ...plan, ...patch }, head));
});
test('full plan requires every declared journey', () => {
  assert.equal(validatePlan({ ...plan, mode: 'full', journeys: JOURNEY_IDS }, head).mode, 'full');
});
