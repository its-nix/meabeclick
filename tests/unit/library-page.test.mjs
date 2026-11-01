/**
 * The library page, source-level (the browser walk is in the PR).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = readFileSync(join(process.cwd(), 'src/routes/app/library/+page.svelte'), 'utf8');

test('the material table comes first; next student skills remain available in a disclosure', () => {
  const due = page.indexOf('<details class="due">');
  assert.ok(due > 0);
  assert.ok(due > page.indexOf('<table>'), 'the requested table is the primary surface');
  assert.match(page, /\{#each view\.due as d \(d\.templateId \+ '\/' \+ d\.skillKey\)\}/);
  assert.match(page, /d\.students\.join\(', '\)/);
});

test("preparing a due skill uses that skill's own template, not the one on screen", () => {
  assert.match(page, /prepare\(d\.templateId, \{ skill: d\.skillKey \}/);
  assert.match(page, /body: JSON\.stringify\(\{ template: templateId, \.\.\.body \}\)/);
});

test('with no plans yet, it says what to do rather than showing nothing', () => {
  assert.match(page, /\{#if view\.due\.length === 0\}/);
  assert.match(page, /אחרי שנפתחת תכנית בכרטיס התלמיד\/ה, המיומנות של השיעור הבא תופיע כאן/);
});

test('a due skill on its way keeps the page refreshing', () => {
  assert.match(page, /view\.rows\.some\(r => r\.item && \['queued', 'preparing'\]\.includes\(r\.item\.status\)\)/);
  assert.match(page, /fetch\('\/api\/library\?all=1'/);
});
