import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from '../../scripts/pr-qa/report.mjs';

const plan = { mode: 'selected', headSha: 'a'.repeat(40), changedFiles: ['src/<script>.svelte'], routes: ['/app/parent'], journeys: ['roles-smoke'], reasons: ['impact'], unmappedRoutes: [] };
const result = { suites: [{ specs: [{ title: 'roles-smoke: dashboards', tests: [{ projectName: 'phone', expectedStatus: 'passed', results: [{ status: 'passed' }] }] }] }], errors: [], stats: { expected: 1, unexpected: 0, skipped: 0, flaky: 0 } };
const options = { selectionOutcome: 'success', runOutcome: 'success', projects: ['phone'] };
test('report records actual tested identity and escapes untrusted paths', () => {
  const report = buildReport(plan, result, options);
  assert.equal(report.status, 'passed');
  assert.ok(report.markdown.includes(plan.headSha));
  assert.equal(report.markdown.includes('<script>'), false);
});
test('missing, skipped, failed, flaky and incomplete runs never produce a pass', () => {
  for (const [p, r, o] of [
    [null, result, options], [plan, null, options], [plan, result, { ...options, runOutcome: 'failure' }],
    [plan, result, { ...options, selectionOutcome: 'failure' }],
    [plan, result, { ...options, projects: ['phone', 'desktop'] }],
    [{ ...plan, journeys: ['roles-smoke', 'payments'] }, result, options],
    [plan, { ...result, stats: { ...result.stats, skipped: 1 } }, options],
    [plan, { ...result, stats: { ...result.stats, flaky: 1 } }, options],
    [{ ...plan, unmappedRoutes: ['/new'] }, result, options],
    [plan, result, { ...options, supplemental: [{ id: 'legacy-ui', required: true, outcome: 'failure' }] }],
    [plan, result, { ...options, supplemental: [{ id: 'legacy-ui', required: true, outcome: 'skipped' }] }],
  ]) assert.notEqual(buildReport(p, r, o).status, 'passed');
});
test('documentation-only changes are explicitly skipped without claiming a browser run', () => {
  assert.equal(buildReport({ ...plan, mode: 'skip', journeys: [] }, null, { ...options, runOutcome: 'skipped' }).status, 'skipped');
});
