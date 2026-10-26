import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = path => readFileSync(join(ROOT, path), 'utf8');
const student = read('src/routes/app/student/+page.svelte');
const picker = read('src/routes/app/games/+page.svelte');
const editor = read('src/routes/app/lessons/[slug]/edit/+page.svelte');
const fields = read('src/lib/components/GameContentEditor.svelte');
const api = read('src/routes/api/lessons/[slug]/games/+server.ts');

// These source contracts complement the server behavior tests. Real-browser
// keyboard/reflow evidence is still required before release.
test('student game groups use stable lesson identity and expose bounded recovery states', () => {
  assert.match(student, /group\.key/);
  assert.doesNotMatch(student, /as group \(group\.title\)/);
  assert.match(student, /class="games-skeleton"/);
  assert.match(student, /לא הצלחנו לטעון את המשחקים\./);
  assert.match(student, /המשחק לא זמין כרגע[\s\S]*לנסות שוב/);
  assert.match(student, /<bdi dir="ltr">/);
  assert.match(student, /\.play\s*\{[\s\S]*min-height:\s*44px/);
});

test('picker includes lesson date and every preview target is 44px', () => {
  assert.match(picker, /lessonAt/);
  assert.match(picker, /<bdi dir="ltr">/);
  assert.match(picker, /\.play\s*\{[\s\S]*min-height:\s*44px/);
});

test('tutor editor has accessible Hebrew validation, conflict recovery, focus, dirty protection and custom archive dialog', () => {
  assert.match(editor, /טעינת הגרסה החדשה/);
  assert.match(editor, /שמירת עותק חדש/);
  assert.match(editor, /gameDirty/);
  assert.match(editor, /beforeNavigate/);
  assert.match(editor, /gameHeading\?\.focus/);
  assert.match(editor, /previewButton\?\.focus/);
  assert.match(editor, /gameStatus\?\.focus/);
  assert.match(editor, /<dialog/);
  assert.doesNotMatch(editor, /onclick=\{\(\) => confirm\(/);
  assert.match(fields, /aria-invalid/);
  assert.match(fields, /aria-describedby/);
  assert.match(fields, /constraintsByTemplate/);
  assert.match(editor, /template=\{game\.template\}/);
  assert.match(api, /GameValidationError/);
  assert.doesNotMatch(api, /error:\s*message/);
  assert.doesNotMatch(api, /error:\s*'assignment not found'/);
});

test('structured game edits clone a plain snapshot instead of a reactive proxy', () => {
  assert.match(fields, /structuredClone\(\$state\.snapshot\(body\)\)/);
  assert.doesNotMatch(fields, /structuredClone\(body\)/);
});
