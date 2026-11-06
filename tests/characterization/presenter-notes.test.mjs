import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { startServer, login } from './harness.mjs';
import { seedLearning } from './learning-fixture.mjs';

test('presenter notes are tutor-only, match publication and do not reset student progress', async () => {
  const server = await startServer();
  try {
    const pupil = await seedLearning(server), tutor = await login(server.baseUrl);
    const db = new DatabaseSync(server.dbPath);
    const plan = JSON.parse(db.prepare("SELECT content FROM lesson_materials WHERE lesson_slug=? AND kind='plan'").get(pupil.slug).content);
    plan.learning.scenes[0].presenterNotes.explanation = 'PrivateGuideOne';
    db.prepare("UPDATE lesson_materials SET content=? WHERE lesson_slug=? AND kind='plan'").run(JSON.stringify(plan), pupil.slug);
    db.close();
    const path = `/app/lessons/${pupil.slug}/presenter`;
    const get = (path, cookie) => fetch(server.baseUrl + path, { headers: cookie ? { Cookie: cookie } : {}, redirect: 'manual' });
    for (const cookie of [undefined, pupil.cookie]) {
      const response = await get(path, cookie);
      assert.equal(response.status, 302);
      assert.match(response.headers.get('location'), /\/login\?next=/);
    }
    const guide = await get(path, tutor);
    assert.equal(guide.status, 200);
    assert.match(guide.headers.get('cache-control'), /private, no-store/);
    assert.match(guide.headers.get('content-security-policy'), /frame-ancestors 'self'/);
    assert.match(await guide.text(), /PrivateGuideOne/);
    for (const [path, cookie] of [[`/app/learn/${pupil.slug}`, pupil.cookie], [`/lessons/${pupil.slug}`, tutor], [`/app/learn/${pupil.slug}?solutions=1`, tutor]]) {
      const html = await (await get(path, cookie)).text();
      assert.ok(!html.includes('PrivateGuideOne'));
      assert.ok(!html.includes('presenterNotes'));
    }
    const api = `/api/learning/${pupil.slug}`;
    const state = await (await get(api, pupil.cookie)).json();
    await fetch(server.baseUrl + api, { method: 'POST', headers: { Cookie: pupil.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: randomUUID(), sceneId: 'independent', action: 'answer', value: 4, fingerprint: state.fingerprint }) });
    plan.learning.scenes[0].presenterNotes.explanation = 'PrivateGuideTwo';
    const edit = (action, expectedVersion) => fetch(`${server.baseUrl}/api/lessons/${pupil.slug}/experience`, { method: 'PUT', headers: { Cookie: tutor, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, expectedVersion, expectedTarget: pupil.slug, learning: plan.learning }) });
    assert.equal((await edit('draft', 1)).status, 200);
    assert.ok(!(await (await get(path, tutor)).text()).includes('PrivateGuideTwo'));
    assert.equal((await edit('publish', 2)).status, 200);
    assert.match(await (await get(path, tutor)).text(), /PrivateGuideTwo/);
    const after = await (await get(api, pupil.cookie)).json();
    assert.equal(after.fingerprint, state.fingerprint);
    assert.equal(after.progress.independent.solved, true);
  } finally { await server.stop(); }
});
