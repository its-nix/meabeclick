// tests/characterization/students.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login, familySession } from './harness.mjs';

test('creating a student rejects a non-slug code', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const r = await fetch(`${baseUrl}/api/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ code: 'Bad Code', name: 'שם' }),
    });
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { error: 'הקוד חייב להיות באנגלית קטנה, בלי רווחים' });
  } finally { await stop(); }
});

test('a student added without a code gets one that says nothing about them', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const headers = { 'Content-Type': 'application/json', Cookie: cookie };
    const r = await fetch(`${baseUrl}/api/students`, { method: 'POST', headers, body: JSON.stringify({ name: 'נועם', email: 'noam2@example.com' }) });
    assert.equal(r.status, 200);
    const { student } = await r.json();
    assert.match(student.code, /^[0-9b-z]{8}$/, 'generated, like a booking\'s: not the child\'s name in a forwarded URL');

    const nameless = await fetch(`${baseUrl}/api/students`, { method: 'POST', headers, body: JSON.stringify({ code: 'x-y-z' }) });
    assert.equal(nameless.status, 400);
  } finally { await stop(); }
});

test('creating a duplicate code is rejected', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const body = JSON.stringify({ code: 'dana', name: 'דנה' });
    const headers = { 'Content-Type': 'application/json', Cookie: cookie };

    const first = await fetch(`${baseUrl}/api/students`, { method: 'POST', headers, body });
    assert.equal(first.status, 200);

    const second = await fetch(`${baseUrl}/api/students`, { method: 'POST', headers, body });
    assert.equal(second.status, 409);
    assert.deepEqual(await second.json(), { error: 'הקוד הזה כבר תפוס' });
  } finally { await stop(); }
});

test('a student added by hand is reachable by a link, not a password', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const r = await fetch(`${baseUrl}/api/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ code: 'noam', name: 'נועם', email: 'noam@example.com' }),
    });
    assert.equal(r.status, 200);
    const { student } = await r.json();

    // Nothing has a password any more, so "always gets one so they are not
    // locked out" became "the tutor can always mint a link". See
    // 'no-family-passwords' in expected-changes.mjs.
    assert.ok(!('password' in student), 'a student record must not carry a password');

    const linkRes = await fetch(`${baseUrl}/api/students/${student.code}/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ scope: 'student' }),
    });
    assert.equal(linkRes.status, 200);
    const access = await linkRes.json();
    assert.equal(access.scope, 'student');
    assert.ok(access.link.includes('/enter#'), 'the admin must be able to hand over a student link');

    // And that link actually opens the student's page.
    const cookie2 = await familySession(access.link);
    const portal = await fetch(`${baseUrl}/api/portal/${student.code}`, { headers: { Cookie: cookie2 } });
    assert.equal(portal.status, 200);
  } finally { await stop(); }
});
