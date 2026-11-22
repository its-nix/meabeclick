import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeNativePreparation, NATIVE_PREPARATION_REASONS } from '../../src/lib/server/native-learning/worker.ts';

const generic = 'נדרשת הכנת מורה';
test('every known and legacy reason gets its own message and next step', () => {
  for (const reason of [...Object.keys(NATIVE_PREPARATION_REASONS), 'unsupported_context']) {
    const d = describeNativePreparation('needs-preparation', reason);
    assert.ok(d.reason.length > 10 && d.nextStep.length > 5, reason);
    assert.ok(!d.reason.includes(generic) && !d.nextStep.includes(generic), reason);
  }
  assert.notEqual(describeNativePreparation('needs-preparation', 'unsupported_context').reason, describeNativePreparation('needs-preparation', 'missing_brief').reason);
});
test('unknown, null and unmapped reasons fall back to a manual next step', () => {
  for (const r of ['made_up_code', null, undefined, '']) {
    const d = describeNativePreparation('needs-preparation', r);
    assert.match(d.nextStep, /ידנית/);
    assert.ok(d.reason);
  }
});
test('every other state explains itself and says what to do', () => {
  for (const s of ['queued', 'preparing', 'review', 'failed', 'cancelled', 'surprise']) {
    const d = describeNativePreparation(s, null);
    assert.ok(d.reason && d.nextStep, s);
  }
});
