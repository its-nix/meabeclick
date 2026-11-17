import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const page = readFileSync('src/routes/+error.svelte', 'utf8');
test('error wording is generic: no page-specific game copy', () => {
  assert.doesNotMatch(page, /isGame|\/app\/play\//);
  assert.match(page, /לא מצאנו את העמוד הזה/);
  assert.match(page, /אין גישה לעמוד הזה/);
});
test('error recovery offers the tutor overview or family entry according to the route', () => {
  assert.match(page, /href=\{recovery.href\}/);
  assert.match(page, /href: '\/app\/dashboard'/);
  assert.match(page, /href: '\/portal'/);
});
