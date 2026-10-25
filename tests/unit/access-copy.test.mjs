import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('the recovery email states the real 15-minute single-use lifetime', () => {
  const email = readFileSync('src/lib/server/email.ts', 'utf8');
  const portalEmail = email.slice(email.indexOf('export async function sendPortalLinkEmail'));

  assert.match(portalEmail, /15 דקות/);
  assert.match(portalEmail, /כניסה אחת/);
  assert.doesNotMatch(portalEmail, /שבועיים/);
});