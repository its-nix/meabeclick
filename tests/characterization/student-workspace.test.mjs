import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, login, familySession } from './harness.mjs';

const markup = html => html.split(/<script\b/)[0];
const book = (baseUrl, day, email) => fetch(baseUrl + '/api/book', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'תלמיד בדיקה', subject: 'מתמטיקה', level: 'כיתה ח', phone: '0501234567', email,
    durationMin: 45, mode: 'online', start: `2028-01-${day}T10:00:00+02:00`, end: `2028-01-${day}T10:45:00+02:00` }),
}).then(r => r.json());

test('overview is a linked student table; guarded detail keeps only the selected student tools', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const first = await book(baseUrl, '10', 'workspace-a@example.test');
    const second = await book(baseUrl, '11', 'workspace-b@example.test');
    const admin = await login(baseUrl);
    const headers = { Cookie: admin };
    const overview = await fetch(baseUrl + '/app/dashboard', { headers });
    assert.match(overview.headers.get('cache-control'), /private, no-store/);
    const overviewMarkup = markup(await overview.text());
    assert.match(overviewMarkup, /class="roster-table /);
    assert.ok(overviewMarkup.includes(`/app/students/${first.portal.code}`));
    assert.ok(overviewMarkup.includes(`/app/students/${second.portal.code}`));
    assert.doesNotMatch(overviewMarkup, /class="student-card|id="hw-results"|id="lessons-list"|>כניסה לפורטל</);

    const path = `/app/students/${first.portal.code}`;
    assert.equal((await fetch(baseUrl + path, { redirect: 'manual' })).status, 302);
    const family = await familySession(first.portal.link);
    assert.equal((await fetch(baseUrl + path, { headers: { Cookie: family }, redirect: 'manual' })).status, 302);
    const detail = await fetch(baseUrl + path, { headers });
    assert.equal(detail.status, 200);
    assert.match(detail.headers.get('cache-control'), /private, no-store/);
    const html = await detail.text();
    assert.match(markup(html), /class="student-card/);
    assert.match(html, /workspace-a@example.test/);
    assert.doesNotMatch(html, /workspace-b@example.test/);
    assert.equal((await fetch(baseUrl + '/app/students/unknown-code', { headers })).status, 404);
  } finally { await stop(); }
});

