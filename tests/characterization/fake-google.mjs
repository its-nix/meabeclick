// tests/characterization/fake-google.mjs
//
// A fake Google for the test server only: harness.mjs loads it with
// `node --import` when a test asks for `fakeGoogle`. It answers the service
// account's sign-in and the calendar's event writes, records every request
// it answers (one JSON line each, in $FAKE_GOOGLE_LOG), and lets every
// other request through to the real fetch. Production code has no hook for
// it: the app makes its ordinary calls to Google, and this stands in front.
import { appendFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, exportJWK } from 'jose';
const loginKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
const loginJwk = { ...await exportJWK(loginKey.publicKey), kid: 'login-test', alg: 'RS256', use: 'sig' };

const realFetch = globalThis.fetch;
const GOOGLE = new Set(['oauth2.googleapis.com', 'www.googleapis.com']);
let events = 0;

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!GOOGLE.has(url.hostname)) return realFetch(input, init);

  const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
  appendFileSync(process.env.FAKE_GOOGLE_LOG, JSON.stringify({
    method: init.method ?? 'GET', url: url.href, headers, body: init.body == null ? null : String(init.body),
  }) + '\n');

  const answer = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.pathname === '/oauth2/v3/certs') return answer(200, { keys: [loginJwk] });
  if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/token') {
    const form = new URLSearchParams(String(init.body ?? ''));
    const code = form.get('code') ?? '';
    if (code.startsWith('login.')) {
      const profile = JSON.parse(Buffer.from(code.slice(6), 'base64url').toString());
      const claims = { sub: profile.subject ?? 'google-student', email: profile.email ?? 'student@gmail.com',
        email_verified: profile.verified ?? true, name: profile.name ?? 'נועה לדוגמה', nonce: profile.nonce, hd: profile.hd, azp: profile.azp };
      let token = await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'login-test' })
        .setIssuer(profile.issuer ?? 'https://accounts.google.com').setAudience(profile.audience ?? form.get('client_id'))
        .setIssuedAt().setExpirationTime(profile.expired ? '0s' : '5m').sign(loginKey.privateKey);
      if (profile.tampered) token = token.slice(0, -8) + 'tampered';
      return answer(200, { id_token: token, access_token: 'fake-login-access-token', token_type: 'Bearer' });
    }
    return answer(200, { access_token: 'fake-token', expires_in: 3600, token_type: 'Bearer' });
  }
  if (init.method === 'POST' && /^\/calendar\/v3\/calendars\/[^/]+\/events$/.test(url.pathname)) {
    events += 1;
    return answer(200, { id: `fake-event-${events}` });
  }
  return answer(404, { error: 'not faked' });
};
