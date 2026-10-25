import { test } from 'node:test';
import assert from 'node:assert/strict';

test('access attempts are bounded per client without blocking a different client', async () => {
  const { allowAccessAttempt } = await import(`../../src/lib/server/access-rate-limit.ts?test=${Date.now()}`);

  for (let attempt = 0; attempt < 12; attempt++) {
    assert.equal(allowAccessAttempt('198.51.100.1'), true);
  }
  assert.equal(allowAccessAttempt('198.51.100.1'), false);
  for (let attempt = 13; attempt < 600; attempt++) {
    assert.equal(allowAccessAttempt('198.51.100.1'), false);
  }
  assert.equal(allowAccessAttempt('198.51.100.2'), true);
});