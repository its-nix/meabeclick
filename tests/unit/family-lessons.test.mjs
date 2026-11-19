/**
 * The lesson record a family sees — pre-launch review, 2026-09-28
 * (Todoist 6hfCvVX9fVVmq89H). Generation at BOOKING time added the lesson
 * to the family's page dated today, with the plan's gradeContext — a note
 * for the tutor — as its "summary"; so «שיעורים שנעשו: 1» appeared before
 * the first lesson. And the slides the page promised were never linked.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parentSource } from './family-source.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f) => readFileSync(join(process.cwd(), f), 'utf8');
const { toFamilyLesson } = await import('../../src/lib/family-lesson.ts');

test('a generated lesson hides the tutor-facing note and carries no presentation link', () => {
  const l = toFamilyLesson({ date: '2027-04-05', topic: 'שברים', summary: 'נלמד בכיתה ז; נדרש: מכנה משותף', slug: 'noga-mtmtik-x1' }, '2027-04-01');
  assert.ok(!('slidesUrl' in l), 'families get no presentation link: old site decks are retired, native Slides are private teacher decks');
  assert.equal(l.summary, null, 'gradeContext was written for the tutor');
  assert.equal(l.upcoming, true);
});

test('a lesson on or before today has happened; an imported one keeps its summary', () => {
  const l = toFamilyLesson({ date: '2027-04-01', topic: 'אחוזים', summary: 'חזרנו על אחוזים לקראת המבחן' }, '2027-04-01');
  assert.equal(l.upcoming, false);
  assert.equal(l.summary, 'חזרנו על אחוזים לקראת המבחן', 'no slug: written for the family, from the old ledger');
});

test('both family pages count only lessons that have happened, and show what is coming', () => {
  const parent = parentSource();
  const student = read('src/routes/app/student/+page.svelte');
  assert.match(parent, /filter\(l => !l\.upcoming\)/);
  assert.match(student, /!l\.upcoming/);
  assert.match(student, /לקראת השיעור/);
});

test('the parent can open the child\'s board from their page, and no family page links a presentation', () => {
  const parent = parentSource();
  assert.match(parent, /href="\/app\/student\?s=\{currentId\}"/);
  assert.doesNotMatch(parent, /slidesUrl/);
  assert.doesNotMatch(read('src/routes/app/student/+page.svelte'), /slidesUrl/);
  assert.match(read('src/routes/api/portal/[code]/+server.ts'), /toFamilyLesson\(/);
});

test('empty states point to the existing booking flow', () => {
  const student = read('src/routes/app/student/+page.svelte');
  const day = student.slice(student.indexOf('<div class="dayone">'), student.indexOf('<div class="dayone">') + 700);
  assert.match(day, /\{#if canBook[^}]*\}[\s\S]*href="\/booking"/, 'only a viewer who may book is offered the link');
  const parent = parentSource();
  assert.match(parent, /עדיין לא נרשמו שיעורים[\s\S]{0,300}href="\/booking"/);
});
