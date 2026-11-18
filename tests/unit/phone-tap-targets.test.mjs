import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('login back link is at least 44px tall on a phone', () => {
  const css = readFileSync('src/routes/login/+page.svelte', 'utf8').match(/\n\s*a \{([^}]*)\}/)?.[1] ?? '';
  assert.match(css, /min-height:\s*44px/);
});

test('dashboard roster rows open a student only through the name link, with no stretched overlay', () => {
  const page = readFileSync('src/routes/app/dashboard/+page.svelte', 'utf8');
  assert.doesNotMatch(page, /student-row-link::after/);
  assert.match(page, /<a class="student-row-link" href="\/app\/students\/\{s\.code\}">/);
});
