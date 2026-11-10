import { JOURNEY_IDS } from './catalog.mjs';

/** A broken selection must fail, never silently execute zero tests. */
export function validatePlan(plan, headSha) {
  if (plan?.version !== 1 || plan.headSha !== headSha || !['selected', 'full'].includes(plan.mode)
    || !Array.isArray(plan.journeys) || !plan.journeys.includes('roles-smoke')
    || plan.journeys.some(id => !JOURNEY_IDS.includes(id))
    || new Set(plan.journeys).size !== plan.journeys.length
    || !Array.isArray(plan.unmappedRoutes) || plan.unmappedRoutes.length
    || plan.mode === 'full' && JOURNEY_IDS.some(id => !plan.journeys.includes(id))) {
    throw new Error('Invalid, stale or uncovered PR QA plan; regenerate the selection.');
  }
  return plan;
}
