import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, login, familySession } from './harness.mjs';

export const googleTestServer = () => startServer({ fakeGoogle: true, env: {
  GOOGLE_LOGIN_CLIENT_ID: 'login-client.apps.googleusercontent.com', GOOGLE_LOGIN_CLIENT_SECRET: 'synthetic-secret',
  GOOGLE_TUTOR_EMAILS: 'tutor@gmail.com',
} });
const cookieOf = (r, prefix) => r.headers.getSetCookie().find(c => c.startsWith(prefix + '='))?.split(';')[0];
export async function beginGoogle(server, fields = {}, cookie = '') {
  const response = await fetch(server.baseUrl + '/auth/google/start', { method: 'POST', redirect: 'manual',
    headers: { Origin: server.baseUrl, Cookie: cookie }, body: new URLSearchParams(fields) });
  assert.equal(response.status, 303);
  const provider = new URL(response.headers.get('location'));
  assert.equal(provider.origin, 'https://accounts.google.com');
  return { provider, cookie: [cookie, cookieOf(response, 'maab_google_flow')].filter(Boolean).join('; ') };
}
export async function finishGoogle(server, flow, profile = {}) {
  const code = 'login.' + Buffer.from(JSON.stringify({ nonce: flow.provider.searchParams.get('nonce'), ...profile })).toString('base64url');
  return fetch(server.baseUrl + '/auth/google/callback?' + new URLSearchParams({ state: flow.provider.searchParams.get('state'), code }),
    { redirect: 'manual', headers: { Cookie: flow.cookie } });
}
async function seed(server, email = 'parent@gmail.com') {
  const tutor = await login(server.baseUrl);
  const res = await fetch(server.baseUrl + '/api/students', { method: 'POST', headers: { Cookie: tutor, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'onboarding-child', name: 'נועה לדוגמה', email, phone: '0501234567', level: 'כיתה ח', subject: 'מתמטיקה' }) });
  assert.equal(res.status, 200);
  const get = async scope => (await (await fetch(server.baseUrl + '/api/students/onboarding-child/link', { method: 'POST',
    headers: { Cookie: tutor, 'Content-Type': 'application/json' }, body: JSON.stringify({ scope }) })).json());
  const parent = await get('account');
  return { parentCookie: await familySession(parent.link), child: await get('student') };
}
const dbRead = (server, sql) => { const db = new DatabaseSync(server.dbPath); try { return db.prepare(sql).all(); } finally { db.close(); } };

test('WhatsApp invitation links Google to the existing child and keeps parent access separate', async () => {
  const s = await googleTestServer();
  try {
    const { child, parentCookie } = await seed(s);
    const token = child.link.split('#')[1];
    for (let n = 0; n < 2; n++) {
      const inspect = await fetch(s.baseUrl + '/api/access/inspect', { method: 'POST', headers: { Cookie: parentCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
      assert.equal((await inspect.json()).previewDestination, '/app/student?s=onboarding-child');
      assert.equal(inspect.headers.getSetCookie().length, 0, 'preview preserves the parent session');
    }
    const flow = await beginGoogle(s, { token });
    const response = await finishGoogle(s, flow);
    assert.equal(response.headers.get('location'), '/app/student?s=onboarding-child');
    const childCookie = cookieOf(response, 'maab_family');
    assert.ok(childCookie);
    assert.equal((await fetch(s.baseUrl + '/api/portal/onboarding-child?kind=parent', { headers: { Cookie: childCookie } })).status, 401);
    assert.equal((await fetch(s.baseUrl + '/app/parent', { redirect: 'manual', headers: { Cookie: parentCookie } })).status, 200);
    assert.equal(dbRead(s, 'SELECT * FROM students_v2').length, 1, 'Google did not duplicate the learner');
    assert.equal(dbRead(s, 'SELECT * FROM accounts').length, 1);
    const join = await fetch(s.baseUrl + '/api/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: child.joinCode }) });
    assert.equal(join.status, 401, 'the companion code is consumed with the invitation');
    const again = await finishGoogle(s, await beginGoogle(s));
    assert.equal(again.headers.get('location'), '/app/student?s=onboarding-child', 'later independent sign-in opens the same child');
    const replay = await finishGoogle(s, flow);
    assert.match(replay.headers.get('location'), /authError=expired/);
  } finally { await s.stop(); }
});

test('a known Google mailbox opens the existing family; a third-party email requires existing access', async () => {
  for (const email of ['parent@gmail.com', 'parent@example.test']) {
    const s = await googleTestServer();
    try {
      await seed(s, email);
      const response = await finishGoogle(s, await beginGoogle(s), { email, subject: 'parent-subject' });
      assert.equal(response.headers.get('location'), email.endsWith('@gmail.com') ? '/app/parent' : '/portal?authError=email-proof');
      assert.equal(dbRead(s, 'SELECT * FROM accounts').length, 1);
    } finally { await s.stop(); }
  }
});

test('an independent student or parent can onboard without booking, phone, or a parent email', async () => {
  for (const role of ['learner', 'parent']) {
    const s = await googleTestServer();
    try {
      const callback = await finishGoogle(s, await beginGoogle(s, { next: '/booking?resume=1' }));
      assert.equal(callback.headers.get('location'), '/onboarding');
      const cookie = cookieOf(callback, 'maab_google_pending');
      const response = await fetch(s.baseUrl + '/onboarding', { method: 'POST', redirect: 'manual', headers: { Origin: s.baseUrl, Cookie: cookie, Accept: 'text/html' },
        body: new URLSearchParams({ role, name: 'נועה לדוגמה', level: 'כיתה ח' }) });
      assert.equal(response.status, 303);
      assert.equal(response.headers.get('location'), '/booking?resume=1');
      const account = dbRead(s, 'SELECT * FROM accounts')[0];
      assert.equal(account.is_self, role === 'learner' ? 1 : 0);
      assert.equal(account.phone, null);
      assert.equal(dbRead(s, 'SELECT * FROM bookings_v2').length, 0);
      const identity = dbRead(s, 'SELECT * FROM google_identities')[0];
      assert.equal(identity.scope_kind, 'account');
      const again = await finishGoogle(s, await beginGoogle(s));
      assert.match(again.headers.get('location'), role === 'learner' ? /^\/app\/student\?s=/ : /^\/app\/parent$/);
      const replay = await fetch(s.baseUrl + '/onboarding', { method: 'POST', redirect: 'manual', headers: { Origin: s.baseUrl, Cookie: cookie, Accept: 'text/html' }, body: new URLSearchParams({ role, name: 'Duplicate', level: 'כיתה ח' }) });
      assert.equal(replay.status, 303);
      assert.equal(dbRead(s, 'SELECT * FROM accounts').length, 1);
    } finally { await s.stop(); }
  }
});

test('a conflicting Google identity cannot claim a child; the invitation remains available', async () => {
  const s = await googleTestServer();
  try {
    const { child } = await seed(s);
    await finishGoogle(s, await beginGoogle(s), { email: 'parent@gmail.com', subject: 'same-subject' });
    const response = await finishGoogle(s, await beginGoogle(s, { token: child.link.split('#')[1] }), { email: 'parent@gmail.com', subject: 'same-subject' });
    assert.match(response.headers.get('location'), /authError=conflict/);
    assert.equal(cookieOf(response, 'maab_family'), undefined);
    const valid = await finishGoogle(s, await beginGoogle(s, { token: child.link.split('#')[1] }), { subject: 'real-child' });
    assert.equal(valid.headers.get('location'), '/app/student?s=onboarding-child');
  } finally { await s.stop(); }
});

test('OAuth requires the initiating browser, correct nonce, issuer, audience, expiry, verification, and signature', async () => {
  const s = await googleTestServer();
  try {
    const first = await beginGoogle(s, { next: 'https://evil.test' });
    assert.equal(first.provider.searchParams.get('scope'), 'openid email profile');
    assert.equal(first.provider.searchParams.get('code_challenge_method'), 'S256');
    const stolen = await finishGoogle(s, { ...first, cookie: '' });
    assert.match(stolen.headers.get('location'), /authError=expired/);
    for (const profile of [{ nonce: 'wrong' }, { audience: 'wrong' }, { issuer: 'https://evil.test' }, { azp: 'another-client' }, { verified: false }, { expired: true }, { tampered: true }]) {
      const response = await finishGoogle(s, await beginGoogle(s), profile);
      assert.match(response.headers.get('location'), /authError=google/);
      assert.equal(cookieOf(response, 'maab_family'), undefined);
    }
    assert.equal(dbRead(s, 'SELECT * FROM google_identities').length, 0);
  } finally { await s.stop(); }
});

test('only explicitly allowed Google accounts receive a tutor session', async () => {
  const s = await googleTestServer();
  try {
    const denied = await finishGoogle(s, await beginGoogle(s, { intent: 'tutor' }), { email: 'outsider@gmail.com' });
    assert.equal(denied.headers.get('location'), '/login?authError=tutor');
    assert.equal(cookieOf(denied, 'maab_session'), undefined);
    const allowed = await finishGoogle(s, await beginGoogle(s, { intent: 'tutor', next: '/app/library' }), { email: 'tutor@gmail.com' });
    assert.equal(allowed.headers.get('location'), '/app/library');
    assert.ok(cookieOf(allowed, 'maab_session'));
    assert.equal(cookieOf(allowed, 'maab_family'), undefined);
  } finally { await s.stop(); }
});

test('existing device access can link Google, but logging out during linking invalidates the action', async () => {
  const s = await googleTestServer();
  try {
    const { parentCookie } = await seed(s, 'parent@example.test');
    const flow = await beginGoogle(s, { intent: 'link' }, parentCookie);
    const loggedOut = { ...flow, cookie: flow.cookie.split('; ').filter(c => c.startsWith('maab_google_flow=')).join('; ') };
    const denied = await finishGoogle(s, loggedOut, { email: 'parent@example.test' });
    assert.match(denied.headers.get('location'), /authError=expired/);
    const allowed = await finishGoogle(s, await beginGoogle(s, { intent: 'link' }, parentCookie), { email: 'parent@example.test' });
    assert.equal(allowed.headers.get('location'), '/app/parent');
  } finally { await s.stop(); }
});


test('an invitation revoked after Google starts cannot connect a profile', async () => {
  const s = await googleTestServer();
  try {
    const { child, parentCookie } = await seed(s);
    const flow = await beginGoogle(s, { token: child.link.split('#')[1] });
    await fetch(s.baseUrl + '/api/student-link', { method: 'POST', headers: { Cookie: parentCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'onboarding-child' }) });
    const result = await finishGoogle(s, flow);
    assert.match(result.headers.get('location'), /authError=expired/);
    assert.equal(dbRead(s, 'SELECT * FROM google_identities').length, 0);
  } finally { await s.stop(); }
});


test('choosing the unlinked parent Google account cannot accidentally bind it to the child', async () => {
  const s = await googleTestServer();
  try {
    const { child } = await seed(s);
    const wrong = await finishGoogle(s, await beginGoogle(s, { token: child.link.split('#')[1] }), { email: 'parent@gmail.com', subject: 'fresh-parent' });
    assert.match(wrong.headers.get('location'), /authError=parent-account/);
    assert.equal(dbRead(s, 'SELECT * FROM google_identities').length, 0);
    const right = await finishGoogle(s, await beginGoogle(s, { token: child.link.split('#')[1] }), { email: 'child@gmail.com', subject: 'correct-child' });
    assert.equal(right.headers.get('location'), '/app/student?s=onboarding-child');
  } finally { await s.stop(); }
});
