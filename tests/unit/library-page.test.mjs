/**
 * The library page, source-level (the browser walk is in the PR).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = readFileSync(join(process.cwd(), 'src/routes/app/library/+page.svelte'), 'utf8');

test('poll failure labels last-known data and offers an explicit retry', () => {
  assert.match(page, /if \(!r.ok\) throw/);
  assert.match(page, /refreshError/);
  assert.match(page, /הנתונים המוצגים הם מהעדכון האחרון/);
  assert.match(page, /onclick=\{refresh\}/);
});

test('the standalone game catalog has a safe contextual return', () => {
  const games = readFileSync('src/routes/app/games/+page.svelte', 'utf8');
  assert.match(games, /safeTutorReturn/);
  assert.match(games, /href=\{returnTo\}/);
});

test('catalog filters and bounded page navigation stay outside its scrolling table', () => {
  for (const id of ['library-search', 'library-template', 'library-topic', 'library-status']) {
    assert.ok(page.indexOf('id="' + id + '"') < page.indexOf('<div class="table-wrap"'), id);
  }
  assert.match(page, /each pagedRows as row/);
  assert.match(page, /aria-label="עמודי הספרייה"/);
  assert.match(page, /replaceState\(libraryPath/);
  assert.match(page, /returnTo=\{encodeURIComponent\(libraryPath\)\}/);
});

test('preparation needs appear before the catalog and start expanded', () => {
  const due = page.indexOf('<details class="due"');
  assert.ok(due > 0);
  assert.ok(due < page.indexOf('<table>'), 'next preparation is not buried under catalog rows');
  assert.match(page, /<details class="due" open>/);
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
