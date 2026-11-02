import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchesPlanFilter } from '../../src/lib/plan-status.ts';

test('plan filtering uses domain flags and always excludes hidden skills', () => {
  const skill = { status: 'started', visibility: 'active', changed: true, recommended: false, blocked: true };
  for (const [filter, expected] of [['all', true], ['changed', true], ['blocked', true], ['recommended', false], ['needs_review', false]]) {
    assert.equal(matchesPlanFilter(skill, filter), expected);
  }
  assert.equal(matchesPlanFilter({ ...skill, status: 'needs_review' }, 'needs_review'), true);
  for (const filter of ['all', 'changed', 'blocked', 'recommended', 'needs_review']) {
    assert.equal(matchesPlanFilter({ ...skill, visibility: 'hidden' }, filter), false);
  }
});
test('the visible map receives the filter and exposes a recoverable empty result', () => {
  const page = readFileSync('src/routes/app/plan/[code]/+page.svelte', 'utf8');
  const tree = readFileSync('src/lib/components/LearningPlanTree.svelte', 'utf8');
  assert.match(page, /<LearningPlanTree\s+\{filter\}/);
  assert.ok(page.indexOf('class="filters"') < page.indexOf('<LearningPlanTree'));
  assert.match(page, /onclick=\{\(\) => \{ filter = f.id;/);
  assert.match(tree, /matchesPlanFilter\(skill, filter\)/);
  assert.match(tree, /אין מיומנויות שמתאימות למסנן/);
  assert.match(tree, /white-space: normal/);
});
test('plan and report recovery preserve the learner instead of forcing the overview', () => {
  for (const path of ['src/routes/app/plan/[code]/+page.svelte', 'src/routes/app/report/[booking]/+page.svelte']) {
    const page = readFileSync(path, 'utf8');
    assert.match(page, /safeTutorReturn/);
    assert.match(page, /href=\{returnTo\}/);
    assert.match(page, /'\/app\/students\/' \+ encodeURIComponent\(data.student.code\)/);
  }
  const report = readFileSync('src/routes/app/report/[booking]/+page.svelte', 'utf8');
  assert.match(report, /encodeURIComponent\(returnTo\)/);
  assert.match(report, /filter=changed/);
});
