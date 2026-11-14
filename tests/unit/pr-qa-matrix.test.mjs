import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matrixPaths, MATRIX_ROUTES } from '../../scripts/pr-qa/matrix.mjs';
import { JOURNEYS } from '../../scripts/pr-qa/catalog.mjs';

test('targeted legacy UI matrix opens the actual changed landing and confirmation pages', () => {
  const paths = ['/', '/booking', '/confirm-booking?t=synthetic', '/confirm-booking?t=invalid'];
  assert.deepEqual(matrixPaths(paths, { mode: 'selected', routes: ['/'] }), ['/']);
  assert.deepEqual(matrixPaths(paths, { mode: 'selected', routes: ['/confirm-booking'] }), paths.slice(2));
});
test('catalog page claims are backed by an executable direct or legacy page check', () => {
  const checks = new Set([...MATRIX_ROUTES, '/app/learn/[slug]', '/lessons/[slug]', '/app/learning-review', '/app/learning-pilot', '/app/learn/[slug]/homework', '/app/lessons/[slug]/preview', '/app/review-game/[caseId]/[template]', '/onboarding','/app/library/connection','/app/tutor-setup/callback','/app/native-review-activities']);
  for (const journey of JOURNEYS) for (const route of journey.routes) {
    // The source excerpt is JSON, not an HTML page; teaching-lifecycle HTTP tests cover its contract.
    if (route === '/app/lessons/[slug]/source/[questionId]') continue;
    if (!route.startsWith('/api/') && !route.startsWith('/auth/')) assert.ok(checks.has(route), `no browser page check: ${route}`);
  }
});
test('dynamic routes match their seeded instances without opening unrelated pages', () => {
  const paths = ['/app/plan/a', '/app/plan/b?tab=x', '/app/students/a', '/app/tutor-setup/test'];
  assert.deepEqual(matrixPaths(paths, { mode: 'selected', routes: ['/app/plan/[code]'] }), paths.slice(0, 2));
  assert.deepEqual(matrixPaths(paths, { mode: 'selected', routes: ['/app/tutor-setup/[code]'] }), paths.slice(3));
  assert.deepEqual(matrixPaths(paths, { mode: 'selected', routes: ['/api/plans'] }), []);
  assert.deepEqual(matrixPaths(paths, { mode: 'full', routes: [] }), paths);
  assert.ok(MATRIX_ROUTES.includes('/app/lessons/[slug]/edit'));
});
