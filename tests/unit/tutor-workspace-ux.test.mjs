import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const page = readFileSync('src/routes/app/dashboard/+page.svelte', 'utf8');

test('failed profile edits retain field-specific recoverable drafts and adjacent retry', () => {
  assert.match(page, /profileDrafts/);
  assert.doesNotMatch(page, /if \(!ok\) el.value =/);
  assert.match(page, /profileFeedback\(s.code, 'progressNote'\)/);
  assert.match(page, /profileFeedback\(s.code, 'goals'\)/);
  assert.match(page, /profileFeedback\(s.code, 'notes'\)/);
  assert.match(page, /ניסיון שמירה נוסף/);
  assert.match(page, /profileDrafts\[key\] === value/);
});

test('one payment ledger retains bulk actions and labels loading or stale data', () => {
  assert.equal((page.match(/class="payments-table"/g) ?? []).length, 1);
  assert.doesNotMatch(page, /class="pay-row"/);
  assert.match(page, /activityError\[s.code\]/);
  assert.match(page, /activityLoading\[s.code\]/);
  assert.match(page, /ledgerBusy\[s.code\]/);
  assert.match(page, /activitySequence\[code\] !== sequence/);
  assert.match(page, /checked=\{picked.has\(c.id\)\}/);
  assert.match(page, /onclick=\{\(\) => mark\(s.code, 'paid'\)\}/);
  assert.match(page, /data-label="פעולות"/);
  assert.match(page, /לא ניתן לטעון כרגע/);
  const badges = page.slice(page.indexOf('class="sc-badges"'), page.indexOf('</div>', page.indexOf('class="sc-badges"')));
  assert.ok(badges.indexOf('ledgerError[s.code]') < badges.indexOf('ledgerLoading[s.code]'), 'an initial load failure must not keep claiming to load');
});

test('destructive learner actions require confirmation before sending requests', () => {
  assert.match(page, /async function voidSession[^]*?if \(!await confirmDialog[^]*?return;[^]*?api\(/);
  assert.match(page, /async function deleteHw[^]*?if \(!await confirmDialog[^]*?return;[^]*?api\(/);
  assert.match(page, /status === 'void' && !await confirmDialog/);
});

test('operations and direct report actions precede the student roster', () => {
  const operations = page.indexOf('<h2 class="operations-title">');
  assert.ok(operations >= 0 && operations < page.indexOf('class="roster-table-wrap"'));
  assert.ok(page.indexOf('<ReportQueue') < page.indexOf('class="roster-table-wrap"'));
  assert.match(page, /השיעורים הקרובים/);
  assert.match(page, /מעקב תשלומים/);
  assert.doesNotMatch(page, /class="stats-bar"/);
  assert.match(page, /balanceError/);
  assert.match(page, /balanceSequence !== sequence/);
});
