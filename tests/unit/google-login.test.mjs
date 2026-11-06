import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
let google, dir;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'google-config-'));
  process.env.DB_PATH = join(dir, 'test.db');
  process.env.SESSION_SECRET = 'synthetic-only';
  process.env.SITE_URL = 'https://example.test';
  google = await import('../../src/lib/server/google-login.ts');
});
after(async () => { await rm(dir, { recursive: true, force: true }); });
test('approved deployment can reuse Meet while a partial dedicated login client stays disabled', () => {
  process.env.GOOGLE_WEB_CLIENT_ID = 'existing-client';
  process.env.GOOGLE_WEB_CLIENT_SECRET = 'existing-secret';
  delete process.env.GOOGLE_LOGIN_CLIENT_ID;
  delete process.env.GOOGLE_LOGIN_CLIENT_SECRET;
  assert.equal(google.googleLoginConfig().clientId, 'existing-client');
  assert.equal(google.googleLoginConfig().redirectUri, 'https://example.test/auth/google/callback');
  process.env.GOOGLE_LOGIN_CLIENT_ID = 'dedicated-client';
  delete process.env.GOOGLE_LOGIN_CLIENT_SECRET;
  assert.equal(google.googleLoginConfig(), null);
  process.env.GOOGLE_LOGIN_CLIENT_SECRET = 'dedicated-secret';
  assert.equal(google.googleLoginConfig().clientId, 'dedicated-client');
  assert.equal(google.googleLoginConfig().redirectUri, 'https://example.test/auth/google/callback');
});
test('the sign-in return path keeps a booking draft but cannot leave the site', () => {
  assert.equal(google.loginNext('/booking?resume=1'), '/booking?resume=1');
  for (const value of ['//evil.test/path', '/\\evil.test', 'https://evil.test', '/auth/google/start', '/onboarding', null]) {
    assert.equal(google.loginNext(value), '/portal');
  }
});


test('the approved tutor accounts are exact and require verified Google mailbox ownership', () => {
  delete process.env.GOOGLE_TUTOR_EMAILS;
  assert.deepEqual(google.tutorGoogleEmails(), ['nikates2929@gmail.com', 'lior3226@gmail.com']);
  for (const email of google.tutorGoogleEmails()) assert.equal(google.tutorGoogleAllowed({ email, authoritative: true }), true);
  assert.equal(google.tutorGoogleAllowed({ email: 'outsider@gmail.com', authoritative: true }), false);
  assert.equal(google.tutorGoogleAllowed({ email: 'lior3226@gmail.com', authoritative: false }), false);
  process.env.GOOGLE_TUTOR_EMAILS = '';
  assert.deepEqual(google.tutorGoogleEmails(), []);
});
