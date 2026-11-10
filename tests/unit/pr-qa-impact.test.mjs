import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectImpact } from '../../scripts/pr-qa/impact.mjs';

const fixture = {
  'src/routes/app/student/+page.svelte': '<script>import Nav from "$lib/components/Nav.svelte";</script>',
  'src/routes/app/parent/+page.svelte': '<script>import Nav from "$lib/components/Nav.svelte";</script>',
  'src/lib/components/Nav.svelte': '<nav>Navigation</nav>',
  'src/routes/api/portal/[code]/homework/+server.ts': 'import { save } from "$server/homework.ts";',
  'src/lib/server/homework.ts': 'export const save = () => {};',
  'src/routes/app/dashboard/+page.svelte': '<h1>Dashboard</h1>',
};
const run = (paths, before = fixture, after = fixture) => selectImpact({ changedFiles: paths, baseFiles: before, headFiles: after });

test('a direct page change selects only its journeys plus cross-role smoke', () => {
  const plan = run(['src/routes/app/parent/+page.svelte']);
  assert.deepEqual(plan.routes, ['/app/parent']);
  assert.ok(plan.journeys.includes('roles-smoke'));
  assert.ok(plan.journeys.includes('parent-history'));
  assert.equal(plan.journeys.includes('tutor-create'), false);
  assert.equal(plan.mode, 'selected');
});
test('shared component aliases propagate to both consuming role pages', () => {
  const plan = run(['src/lib/components/Nav.svelte']);
  assert.deepEqual(plan.routes, ['/app/parent', '/app/student']);
  assert.ok(plan.journeys.includes('homework-submit'));
});
test('API implementation imports select dependent user journeys', () => {
  const plan = run(['src/lib/server/homework.ts']);
  assert.deepEqual(plan.routes, ['/api/portal/[code]/homework']);
  assert.ok(plan.journeys.includes('homework-submit'));
  assert.ok(plan.journeys.includes('homework-publish'));
});
test('removed imports retain their base-side page impact', () => {
  const after = { ...fixture, 'src/routes/app/student/+page.svelte': '<h1>Student</h1>' };
  delete after['src/lib/components/Nav.svelte'];
  const plan = run(['src/lib/components/Nav.svelte'], fixture, after);
  assert.ok(plan.routes.includes('/app/student'));
  assert.ok(plan.routes.includes('/app/parent'));
});
test('a renamed route preserves old and new path coverage and falls back for an unknown page', () => {
  const after = { ...fixture, 'src/routes/app/new-destination/+page.svelte': '<h1>New</h1>' };
  delete after['src/routes/app/parent/+page.svelte'];
  const plan = run(['src/routes/app/parent/+page.svelte', 'src/routes/app/new-destination/+page.svelte'], fixture, after);
  assert.deepEqual(plan.routes, ['/app/new-destination', '/app/parent']);
  assert.equal(plan.mode, 'full');
  assert.match(plan.reasons.join(' '), /unmapped route/);
});
test('a layout change expands to its descendant pages, excluding unrelated routes', () => {
  const files = { ...fixture, 'src/routes/app/+layout.svelte': '<main>Layout</main>', 'src/routes/booking/+page.svelte': '<h1>Book</h1>' };
  const plan = run(['src/routes/app/+layout.svelte'], files, files);
  assert.deepEqual(plan.routes, ['/app/dashboard', '/app/parent', '/app/student']);
});
test('route groups and module re-exports preserve dependency traversal', () => {
  const files = {
    'src/routes/(family)/app/student/+page.svelte': '<script>import { item } from "$lib/item";</script>',
    'src/lib/item/index.ts': 'export { item } from "../shared.ts";',
    'src/lib/shared.ts': 'export const item = 1;',
  };
  assert.deepEqual(run(['src/lib/shared.ts'], files, files).routes, ['/app/student']);
});
test('unknown runtime files and deployment infrastructure expand to full verification', () => {
  for (const path of ['src/lib/server/unimported.ts', 'Dockerfile', 'docker-compose.yml', 'src/hooks.server.ts', 'package-lock.json', '.github/workflows/deploy.yml', 'static/logo.svg']) {
    const plan = run([path]);
    assert.equal(plan.mode, 'full', path);
    assert.ok(plan.journeys.length >= 10);
  }
});
test('documentation-only diffs and no-change diffs explicitly skip UI verification', () => {
  for (const paths of [[], ['README.md', 'docs/quality/notes.md'], ['marketing/notes.md']]) {
    const plan = run(paths);
    assert.equal(plan.mode, 'skip');
    assert.deepEqual(plan.journeys, []);
    assert.match(plan.reasons.join(' '), /no runtime/);
  }
});
test('a public page and a shared stylesheet have conservative coverage', () => {
  assert.ok(run(['src/routes/booking/+page.svelte']).journeys.includes('public-booking'));
  const files = { ...fixture, 'src/routes/+layout.svelte': '<script>import "$lib/theme.css";</script>', 'src/lib/theme.css': 'body {color:red}' };
  assert.equal(run(['src/lib/theme.css'], files, files).mode, 'full');
});

test('an unknown route is reported as uncovered, even though the fallback selects all tests', () => {
  const plan = run(['src/routes/new-feature/+page.svelte']);
  assert.deepEqual(plan.unmappedRoutes, ['/new-feature']);
  assert.equal(plan.mode, 'full');
});

test('an unresolved runtime change expands coverage even alongside a resolved page', () => {
  assert.equal(run(['src/routes/app/parent/+page.svelte', 'src/lib/unresolved.ts']).mode, 'full');
});
test('test fixtures and build context changes always run the UI gate', () => {
  for (const path of ['tests/characterization/harness.mjs', 'tests/characterization/learning-fixture.mjs', '.dockerignore', 'tsconfig.json']) {
    assert.equal(run([path]).mode, 'full', path);
  }
});

test('shared lesson changes map existing preparation and source boundaries to their checked journeys', () => {
  const learning = ['/app/learning-pilot', '/api/learning-pilot', '/app/learn/[slug]/homework', '/app/lessons/[slug]/preview', '/app/lessons/[slug]/source/[questionId]', '/api/reports', '/api/reports/prompt'];
  const workspace = ['/api/drive-sync', '/api/library/import', '/api/library/prepare'];
  for (const [journey, routes] of [['learning', learning], ['workspace', workspace]]) for (const route of routes) {
    const file = 'src/routes' + route + '/+server.ts';
    const plan = selectImpact({ changedFiles: [file], headFiles: { [file]: 'export const GET=()=>new Response();' } });
    assert.deepEqual(plan.unmappedRoutes, [], route);
    assert.ok(plan.journeys.includes(journey), route);
  }
});
