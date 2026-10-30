import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login } from './harness.mjs';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

// Synthetic identities, signed only with the harness's public test secret.
const signedCookie = (name, payload) => `${name}=${payload}.${createHmac('sha256', 'test-secret-not-a-real-one').update(payload).digest('base64url')}`;

test('metrics shell is server-authenticated and renders unknowns without source observations', async () => {
  const { baseUrl, stop, dbPath } = await startServer();
  try {
    const db = new DatabaseSync(dbPath);
    db.exec(`INSERT INTO accounts (id, name, credential, created_at) VALUES (901, 'PRIVATE_SYNTHETIC_ACCOUNT', 'synthetic', '2026-01-01');
      INSERT INTO students_v2 (id, code, name, account_id, credential, created_at) VALUES
      (901, 'synthetic-901', 'PRIVATE_SYNTHETIC_STUDENT', 901, 'synthetic', '2026-01-01');
      INSERT INTO payments (account_id, student_id, date, kind, amount_agorot, status) VALUES (901, 901, '2026-01-01', 'double', 9876543, 'paid');`);
    db.close();
    for (const cookie of ['', 'maab_family=not-an-admin',
      signedCookie('maab_family', `u.a.901.${Date.now() + 60000}`),
      signedCookie('maab_family', `u.s.901.${Date.now() + 60000}`),
      signedCookie('maab_session', String(Date.now() - 60000))]) {
      const r = await fetch(`${baseUrl}/app/metrics`, { redirect: 'manual', headers: { Cookie: cookie } });
      assert.equal(r.status, 302);
      assert.equal(r.headers.get('location'), '/login?next=%2Fapp%2Fmetrics');
      assert.doesNotMatch(await r.text(), /רצף יצירות נקיות|תלמידים פעילים|NOT_AVAILABLE/);
    }
    const cookie = await login(baseUrl);
    const start = performance.now();
    const r = await fetch(`${baseUrl}/app/metrics`, { headers: { Cookie: cookie } });
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.ok(performance.now() - start < 2000, 'static SSR must not wait for aggregate sources');
    assert.match(r.headers.get('cache-control'), /no-store/);
    assert.equal((html.match(/data-availability="NOT_AVAILABLE"/g) ?? []).length, 14);
    assert.match(html, /אין תמונת מצב מצרפית מאושרת/);
    assert.match(html, /31\.03\.2027/);
    assert.match(html, /Asia\/Jerusalem/);
    assert.match(html, /UNKNOWN/);
    assert.doesNotMatch(html, /PRIVATE_SYNTHETIC_|synthetic-901|9876543/);
    const gate = html.match(/<article aria-labelledby="metric-gate"[\s\S]*?<\/article>/)?.[0];
    assert.match(gate, /סף אמינות מחייב כעת/);
    assert.doesNotMatch(html, /<progress|עודכן עכשיו/);
    const actuals = [...html.matchAll(/<dd class="unknown[^>]*>(.*?)<\/dd>/g)].map(m => m[1]);
    assert.equal(actuals.length, 14);
    for (const actual of actuals) {
      assert.match(actual, /UNKNOWN \/ NOT_AVAILABLE/);
      assert.doesNotMatch(actual.replace(/<[^>]*>/g, ''), /[0-9]/, 'targets/zeros must not leak into actual values');
    }
    assert.ok(html.indexOf('id="operations"') < html.indexOf('id="business"'));
    assert.ok(html.indexOf('id="business"') < html.indexOf('id="learning"'));
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
    assert.ok(Buffer.byteLength(html) < 60000, 'bounded definitions-only payload');
    const dashboard = await fetch(`${baseUrl}/app/dashboard`, { headers: { Cookie: cookie } });
    assert.match(await dashboard.text(), /href="\/app\/metrics"/);
    await fetch(`${baseUrl}/api/logout`, { method: 'POST', headers: { Cookie: cookie } });
    const loggedOut = await fetch(`${baseUrl}/app/metrics`, { redirect: 'manual' });
    assert.equal(loggedOut.status, 302);
  } finally { await stop(); }
});
