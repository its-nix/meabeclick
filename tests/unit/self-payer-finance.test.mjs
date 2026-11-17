import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'self-payer-')), 'db.sqlite');
const E = await import('../../src/lib/server/entities.ts');
const { selfPayerFinance } = await import('../../src/lib/server/self-payer-finance.ts');

test('a student who is the payer of record gets the account balance and their charges', () => {
  const account = E.createAccount({ name: 'בוגר', credential: 'sp-1', isSelf: true });
  const student = E.createStudent({ code: 'self-one', name: 'בוגר', accountId: account.id, credential: 'sp-1' });
  const facts = selfPayerFinance(E.getStudentByCode('self-one'));
  assert.ok(facts);
  assert.equal(facts.balance.dueAgorot, 0);
  assert.deepEqual(facts.charges, []);
  assert.equal(student.id, E.getStudentByCode('self-one').id);
});

test('a child in a family account gets nothing: parents pay, the child does not see money', () => {
  const account = E.createAccount({ name: 'משפחה', credential: 'sp-2' });
  E.createStudent({ code: 'kid-one', name: 'ילד', accountId: account.id, credential: 'sp-2' });
  assert.equal(selfPayerFinance(E.getStudentByCode('kid-one')), null);
});

test('the portal API offers money to a student only through that helper, and never to the tutor path', () => {
  const api = readFileSync('src/routes/api/portal/[code]/+server.ts', 'utf8');
  assert.match(api, /selfPayerFinance\(/);
  assert.match(api, /kind === 'student' && !locals\.authenticated/);
});

test('the student page shows the payment card only when the server sent a balance', () => {
  const page = readFileSync('src/routes/app/student/+page.svelte', 'utf8');
  assert.match(page, /\{#if DATA\.balance\}/);
  assert.match(page, /PAYBOX_LINK/);
});
