import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, login } from './harness.mjs';

test('tutor presentation view offers a safe return to the exact library filters', async () => {
  const server = await startServer();
  try {
    const db = new DatabaseSync(server.dbPath), now = new Date().toISOString();
    const slug = 'lib-tutor-view';
    db.prepare("INSERT INTO lessons (slug,student,title,at,status,slides) VALUES (?,'ספרייה','משוואות לדוגמה',?,'ready','slides.html')").run(slug, now);
    db.prepare("INSERT INTO lesson_materials (lesson_slug,kind,version,content,origin,published_at,created_at) VALUES (?,'slides',1,?,'generated',?,?)")
      .run(slug, '<!doctype html><html lang="he" dir="rtl"><body>מצגת לדוגמה</body></html>', now, now);
    db.prepare("INSERT INTO library_items (template_id,skill_key,slug,status,updated_at) VALUES ('math-8','alg.eq.word',?,'ready',?)").run(slug, now);
    db.close();
    const path = `/app/lessons/${slug}/view`;
    assert.equal((await fetch(server.baseUrl + path, { redirect: 'manual' })).status, 302);
    const headers = { Cookie: await login(server.baseUrl) };
    const returnTo = '/app/library?template=math-8&search=משוואות&page=2';
    const response = await fetch(`${server.baseUrl}${path}?returnTo=${encodeURIComponent(returnTo)}`, { headers });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /private.*no-store/);
    const html = await response.text();
    assert.match(html, /חזרה לספריית התוכן/);
    const back = html.match(/href="(\/app\/library\?[^\"]+)"/)?.[1];
    assert.equal(decodeURIComponent(back?.replaceAll('&amp;', '&') ?? ''), returnTo);
    assert.match(html, /<iframe[^>]*src="\/lessons\/lib-tutor-view"/);
    const invalidReturn = await fetch(`${server.baseUrl}${path}?returnTo=https://evil.example`, { headers });
    assert.match(await invalidReturn.text(), /href="\/app\/library"/);
    assert.equal((await fetch(`${server.baseUrl}/app/lessons/missing/view`, { headers })).status, 404);
    const library = await (await fetch(`${server.baseUrl}/app/library?template=math-8&status=ready`, { headers })).text();
    assert.match(library, /href="\/app\/lessons\/lib-tutor-view\/view\?returnTo=/);
    // Direct student presentation URLs and stored materials are unchanged.
    assert.equal((await fetch(`${server.baseUrl}/lessons/${slug}`)).status, 200);
  } finally { await server.stop(); }
});
