import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const parent = readFileSync('src/routes/app/parent/+page.svelte', 'utf8');
const student = readFileSync('src/routes/app/student/+page.svelte', 'utf8');

test('parent next lesson and learning evidence precede repeat access and detailed finance', () => {
  const lesson = parent.indexOf('class="next-lesson-box"');
  const progress = parent.indexOf('class="progress-overall"');
  const access = parent.indexOf('class="section share"');
  assert.ok(lesson < progress && progress < access);
  assert.match(parent, /<details class="family-administration"[^>]*>/);
  assert.match(parent, /<section class="section family-payments" hidden=\{parentView !== 'payments'\}>/);
  assert.equal((parent.match(/class="stats-bar"/g) ?? []).length, 1, 'financial counters remain only in the family finance disclosure');
});
test('student keeps a second progress summary only for distinct skill mastery', () => {
  const view = student.slice(student.indexOf("{#if activeView === 'hw'}"));
  assert.match(view, /\{#if DATA.progress\?\.kind === 'skills'\}\s*<div class="card">/);
  assert.equal((view.match(/מטלות בכתב הוגשו או נבדקו/g) ?? []).length, 1);
  assert.match(view, /שליטה במיומנויות/);
});
