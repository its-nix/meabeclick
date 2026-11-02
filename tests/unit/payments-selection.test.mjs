import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idsForPanel, dueAgorot } from '../../src/lib/payments-selection.ts';

const yuval = [{ id: 1 }, { id: 2 }];
const noa = [{ id: 7 }];

test('operational follow-up counts due-now charges, never future paid or void rows', () => {
  const charges = [
    { status: 'owed', date: '2026-11-01', amount_agorot: 12001 },
    { status: 'owed', date: '2026-11-02', amount_agorot: 1234 },
    { status: 'owed', date: '2027-08-02', amount_agorot: 12000 },
    { status: 'paid', date: '2026-11-01', amount_agorot: 12000 },
    { status: 'void', date: '2026-11-01', amount_agorot: 12000 },
  ];
  assert.equal(dueAgorot(charges, '2026-11-02'), 13235);
  assert.equal(dueAgorot([], '2026-11-02'), 0);
});

test('a selection spanning two panels submits only the pressed panel', () => {
  // The exact regression: charges ticked under both children, the button
  // pressed under Noa. Yuval's ids must not travel.
  assert.deepEqual(idsForPanel([1, 2, 7], noa), [7]);
  assert.deepEqual(idsForPanel([1, 2, 7], yuval), [1, 2]);
});

test('a selection with nothing in this panel submits nothing', () => {
  assert.deepEqual(idsForPanel([1, 2], noa), []);
});

test('an empty panel submits nothing', () => {
  assert.deepEqual(idsForPanel([1, 2], []), []);
});
