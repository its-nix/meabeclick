import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const page = readFileSync('src/routes/+error.svelte', 'utf8');
test('game error wording is scoped to actual play routes', () => {
  assert.match(page, /page.url.pathname.startsWith\('\/app\/play\/'\)/);
  assert.match(page, /status === 403 && isGame/);
  assert.match(page, /status === 404 && isGame/);
  assert.match(page, /לא מצאנו את העמוד הזה/);
  assert.match(page, /אין גישה לעמוד הזה/);
});
test('error recovery offers the tutor overview or family entry according to the route', () => {
  assert.match(page, /href=\{recovery.href\}/);
  assert.match(page, /href: '\/app\/dashboard'/);
  assert.match(page, /href: '\/portal'/);
});
