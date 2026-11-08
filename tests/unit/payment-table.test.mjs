import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paymentRows } from '../../src/lib/payment-table.ts';

const charges = [
  { id: 4, date: '2026-11-01', status: 'owed' },
  { id: 3, date: '2026-11-03', status: 'paid' },
  { id: 2, date: '2026-11-01', status: 'void' },
  { id: 1, date: '2027-01-01', status: 'owed' },
];

test('payments sort in either date direction with stable same-day ordering, without changing the ledger', () => {
  const snapshot = structuredClone(charges);
  assert.deepEqual(paymentRows(charges, 'all', 'newest').map(c => c.id), [1, 3, 2, 4]);
  assert.deepEqual(paymentRows(charges, 'all', 'oldest').map(c => c.id), [2, 4, 3, 1]);
  assert.deepEqual(charges, snapshot);
});

test('unpaid filtering includes future charges and excludes paid and void records', () => {
  assert.deepEqual(paymentRows(charges, 'owed', 'oldest').map(c => c.id), [4, 1]);
  assert.deepEqual(paymentRows(charges, 'paid', 'newest').map(c => c.id), [3]);
  assert.deepEqual(paymentRows([], 'all', 'newest'), []);
});
