import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, login, familySession } from './harness.mjs';

test('the all-track table is tutor-only, private and retains per-template material identity', async () => {
  const s = await startServer();
  try {
    assert.equal((await fetch(`${s.baseUrl}/api/library?all=1`)).status, 401);
    const cookie = await login(s.baseUrl);
    const headers = { Cookie: cookie };
    const response = await fetch(`${s.baseUrl}/api/library?all=1`, { headers });
    assert.match(response.headers.get('cache-control'), /private.*no-store/);
    const table = await response.json();
    assert.ok(table.templates.length > 1);
    assert.ok(table.rows.some(r => r.templateId === 'math-8'));
    assert.ok(table.rows.some(r => r.templateId === 'math-9'));
    assert.equal(new Set(table.rows.map(r => `${r.templateId}/${r.skillKey}`)).size, table.rows.length);
    const db = new DatabaseSync(s.dbPath);
    db.prepare(`INSERT INTO library_items(template_id,skill_key,slug,status,problem,updated_at)
      VALUES('math-8','alg.eq.word',NULL,'failed','Synthetic failure',?)`).run(new Date().toISOString());
    db.close();
    const updated = await (await fetch(`${s.baseUrl}/api/library?all=1`, { headers })).json();
    assert.equal(updated.rows.find(r => r.templateId === 'math-8' && r.skillKey === 'alg.eq.word').item.problem, 'Synthetic failure');
    const page = await fetch(`${s.baseUrl}/app/library`, { headers });
    assert.match(page.headers.get('cache-control'), /private.*no-store/);
    const html = await page.text();
    assert.match(html, /<table/);
    for (const id of ['library-search', 'library-template', 'library-topic', 'library-status']) assert.match(html, new RegExp(`id="${id}"`));
    assert.doesNotMatch(html, /<nav class="templates/);
    assert.match(html, /הכנה מחדש:.*כיתה ח/);
    const selected = await (await fetch(`${s.baseUrl}/app/library?template=math-8`, { headers })).text();
    const body = selected.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/)?.[1];
    assert.ok(body);
    assert.doesNotMatch(body, /כיתה ט/);
    assert.equal((await fetch(`${s.baseUrl}/app/library?template=missing`, { headers })).status, 404);
    const booking = await fetch(`${s.baseUrl}/api/book`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Synthetic learner', email: 'library-table@example.test', phone: '0501234567', level: 'כיתה ח', durationMin: 45,
        start: '2029-03-01T10:00:00+02:00', end: '2029-03-01T10:45:00+02:00' }),
    }).then(r => r.json());
    const family = await familySession(booking.portal.link);
    assert.equal((await fetch(`${s.baseUrl}/api/library?all=1`, { headers: { Cookie: family } })).status, 401);
    assert.notEqual((await fetch(`${s.baseUrl}/app/library`, { headers: { Cookie: family }, redirect: 'manual' })).status, 200);
  } finally { await s.stop(); }
});
