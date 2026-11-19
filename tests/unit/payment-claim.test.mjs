import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'claim-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const P = await import('../../src/lib/server/payments.ts');
const C = await import('../../src/lib/server/payments/confirmation.ts');
const L = await import('../../src/lib/server/payments/claim.ts');

const acct = E.createAccount({ name: 'משפחה', credential: 'c' });
const kid = E.createStudent({ code: 'kid', name: 'ילד', accountId: acct.id, credential: 'k' });
const charge = (amountAgorot = 12000) => P.addPayment({ accountId: acct.id, studentId: kid.id, date: '2026-11-01', kind: 'single', amountAgorot, status: 'owed' });

test('a claim records time, never marks paid, and is idempotent', () => {
  const id = charge();
  assert.equal(L.claimPayment(id, 'ביט'), 'claimed');
  const first = P.paymentById(id);
  assert.equal(first.status, 'owed');
  assert.ok(first.claimed_at);
  assert.equal(first.claim_note, 'ביט');
  assert.equal(L.claimPayment(id), 'already_claimed');
  assert.equal(P.paymentById(id).claimed_at, first.claimed_at);
  assert.equal(P.balanceForAccount(acct.id, '2026-12-01').dueAgorot >= 12000, true);
});

test('claims on paid or void or missing charges are refused', () => {
  const paid = charge(); C.confirmPayment({ chargeId: paid, source: 'manual', amountAgorot: 12000 });
  assert.equal(L.claimPayment(paid), 'already_paid');
  const v = charge(); P.setPaymentStatus([v], 'void');
  assert.equal(L.claimPayment(v), 'not_claimable');
  assert.equal(L.claimPayment(999999), 'not_claimable');
});

test('rejecting clears the claim and leaves the charge owed', () => {
  const id = charge(); L.claimPayment(id);
  assert.equal(L.clearClaims([id]), 1);
  const row = P.paymentById(id);
  assert.equal(row.claimed_at, null); assert.equal(row.status, 'owed');
});

test('manual confirmation pays, clears the claim and records provenance', () => {
  const id = charge(); L.claimPayment(id);
  assert.deepEqual(C.confirmPayment({ chargeId: id, source: 'manual', amountAgorot: 12000 }), { chargeId: id, changed: true });
  const row = P.paymentById(id);
  assert.equal(row.status, 'paid'); assert.equal(row.paid_source, 'manual'); assert.equal(row.claimed_at, null);
  assert.equal(C.confirmPayment({ chargeId: id, source: 'manual', amountAgorot: 12000 }).changed, false);
});

test('amount mismatch, void, unknown and non-integer inputs are rejected', () => {
  const id = charge();
  assert.throws(() => C.confirmPayment({ chargeId: id, source: 'manual', amountAgorot: 100 }), /does not match/);
  assert.throws(() => C.confirmPayment({ chargeId: id, source: 'manual', amountAgorot: 120.5 }), /integer/);
  assert.throws(() => C.confirmPayment({ chargeId: 987654, source: 'manual', amountAgorot: 1 }), /unknown charge/);
  P.setPaymentStatus([id], 'void');
  assert.throws(() => C.confirmPayment({ chargeId: id, source: 'manual', amountAgorot: 12000 }), /void/);
  assert.equal(P.paymentById(id).status, 'void');
});

test('processor confirmation is idempotent by reference and rejects conflicts', () => {
  const a = charge(), b = charge();
  assert.throws(() => C.confirmPayment({ chargeId: a, source: 'processor', amountAgorot: 12000 }), /reference/);
  assert.equal(C.confirmPayment({ chargeId: a, source: 'processor', reference: 'tx-1', amountAgorot: 12000 }).changed, true);
  assert.equal(C.confirmPayment({ chargeId: a, source: 'processor', reference: 'tx-1', amountAgorot: 12000 }).changed, false);
  assert.throws(() => C.confirmPayment({ chargeId: a, source: 'processor', reference: 'tx-2', amountAgorot: 12000 }), /different reference/);
  assert.throws(() => C.confirmPayment({ chargeId: b, source: 'processor', reference: 'tx-1', amountAgorot: 12000 }), /already used/);
  assert.equal(P.paymentById(b).status, 'owed');
});

test('un-marking paid clears provenance so the reference can be reused', () => {
  const id = charge(); C.confirmPayment({ chargeId: id, source: 'processor', reference: 'tx-9', amountAgorot: 12000 });
  P.setPaymentStatus([id], 'owed');
  const row = P.paymentById(id);
  assert.equal(row.paid_reference, null); assert.equal(row.status, 'owed');
});

test('claim attempts are rate limited per key', () => {
  const t = 1_000_000;
  for (let i = 0; i < 10; i++) assert.equal(L.allowClaimAttempt('k', t + i), true);
  assert.equal(L.allowClaimAttempt('k', t + 11), false);
  assert.equal(L.allowClaimAttempt('k', t + 61_000), true);
  assert.equal(L.allowClaimAttempt('other', t), true);
});
