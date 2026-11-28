import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, createCipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { config, provider } from './central-drive-fixture.mjs';
import { receipt, seedRetired } from './learning-archive-fixture.mjs';
import { login } from './characterization/harness.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const site = 'https://staging.meabeclick.com';
const owner = { id: 'owner', type: 'user', role: 'owner', emailAddress: config.ownerEmail };
const scope = hash(JSON.stringify(['meabeclick-central-v1', config.ownerEmail, config.learningFolderId]));
const tokenKey = randomBytes(32);
const clientId = 'synthetic-client';
const cronKey = 'fixture-cron-key';

function connectFixture(dataDir) {
  writeFileSync(join(dataDir, 'workspace.json'), JSON.stringify(config));
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', tokenKey, iv);
  const identity = createHash('sha256').update(JSON.stringify([clientId, site + '/auth/google/callback', config])).digest('base64url');
  cipher.setAAD(Buffer.from(identity));
  const record = { refreshToken: 'synthetic', checkedAt: new Date().toISOString(), verified: true, syncEnabled: true, syncEpoch: 'fixture', realRecords: null };
  const data = Buffer.concat([cipher.update(JSON.stringify(record)), cipher.final()]);
  mkdirSync(join(dataDir, '.credentials'), { recursive: true });
  writeFileSync(join(dataDir, '.credentials/learning-google.json'), JSON.stringify({
    version: 1, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: data.toString('base64url'),
  }));
}

async function until(check, description) {
  const deadline = Date.now() + 60_000;
  do {
    const result = await check();
    if (result) return result;
    await delay(100);
  } while (Date.now() < deadline);
  assert.fail('Timed out waiting for ' + description);
}

export async function simulatedGoogle(t) {
  const google = provider();
  for (const [id, parent, key] of [
    [receipt.workspaceId, config.learningFolderId, 'workspace'], [receipt.reviewId, receipt.workspaceId, 'review'],
    ['fixtureSiteFolder', config.learningFolderId, 'folder:site'], [receipt.studentsId, 'fixtureSiteFolder', 'folder:students'],
    [receipt.indexId, receipt.workspaceId, 'register'],
  ]) {
    google.files.set(id, { id, parents: [parent], version: '1', owners: [owner], permissions: [owner],
      appProperties: { meaCentralScope: scope, meaCentralKey: hash(key) },
      mimeType: 'application/vnd.google-apps.' + (id === receipt.indexId ? 'spreadsheet' : 'folder') });
  }
  const tabs = () => google.spreadsheets.get(receipt.indexId)?.sheets ?? [];
  const tab = title => tabs().find(s => s.properties.title === title);
  const errors = [];
  async function respond(url, method, headers, body) {
    const file = google.files.get(url.pathname.split('/').at(-1));
    if (file && url.searchParams.get('alt') === 'media') return new Response(file.bytes);
    if (file && method === 'PATCH' && url.searchParams.has('addParents')) {
      file.parents = [url.searchParams.get('addParents')];
      return Response.json({ id: file.id, parents: file.parents });
    }
    if (url.pathname.endsWith('/values:batchUpdate')) {
      for (const { range, values } of JSON.parse(body).data) {
        const [, title, column, row] = /^'([^']+)'!([A-Z])(\d+)$/.exec(range);
        tab(title).rows[Number(row)-1].values[column.charCodeAt(0)-65] = { userEnteredValue: { stringValue: values[0][0] } };
      }
      return Response.json({});
    }
    const init = { headers, ...(method === 'GET' ? {} : { method, body }) };
    const response = await google.fetch(url, init);
    if (url.hostname === 'sheets.googleapis.com' && url.pathname.endsWith(':batchUpdate')) {
      for (const { appendCells } of JSON.parse(body).requests) if (appendCells) {
        const sheet = tabs().find(s => s.properties.sheetId === appendCells.sheetId);
        (sheet.rows ??= []).push(...appendCells.rows);
      }
    }
    for (const f of google.files.values()) {
      f.permissions = [owner];
      f.version ??= '1';
    }
    return response;
  }
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const response = await respond(new URL('https://' + req.url.slice(1)), req.method, req.headers, Buffer.concat(chunks));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (e) { errors.push(String(e)); res.writeHead(500).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  function records(title) {
    const rows = tab('Native ' + title)?.rows ?? [];
    const keys = rows[0]?.values.map(c => c.userEnteredValue.stringValue.match(/\[([^\]]+)\]$/)[1]) ?? [];
    return rows.slice(1).map(row => ({
      get(key) { return row.values[keys.indexOf(key)]?.userEnteredValue?.stringValue; },
      set(key, value) { const i = keys.indexOf(key); assert.ok(i >= 0); row.values[i] = { userEnteredValue: { stringValue: value } }; },
    }));
  }
  return {
    env: { NODE_OPTIONS: '--import=' + new URL('./lesson-provider-preload.mjs', import.meta.url).href,
      SITE_URL: site, NATIVE_LESSON_AUTHORING_ENABLED: 'true', CRON_KEY: cronKey,
      LEARNING_GOOGLE_CLIENT_ID: clientId, LEARNING_GOOGLE_CLIENT_SECRET: 'synthetic', LEARNING_GOOGLE_TOKEN_KEY: tokenKey.toString('hex'),
      LESSON_PROVIDER_URL: 'http://127.0.0.1:' + server.address().port },
    async review({ baseUrl, dataDir, dbPath, bookingId, studentId }) {
      connectFixture(dataDir);
      const db = new DatabaseSync(dbPath);
      try { seedRetired(db); } finally { db.close(); }
      const cookie = await login(baseUrl);
      const jobUrl = baseUrl + '/api/native-lessons/' + bookingId;
      const prepared = await fetch(jobUrl, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, preparation: { request: 'Normal distribution', priorKnowledge: 'Reads a graph' } }) });
      assert.equal(prepared.status, 200, await prepared.clone().text());
      await until(async () => {
        const { job } = await (await fetch(jobUrl, { headers: { cookie } })).json();
        assert.ok(['queued','preparing','review'].includes(job.state), JSON.stringify([job.state,job.reason,job.errorCode,errors,google.calls.at(-1)?.url]));
        return job.state === 'review';
      }, 'worker publication');
      const materials = records('Materials');
      for (const [kind, mime] of [['presentation','presentation'],['homework','document']]) {
        const url = materials.find(m => m.get('kind') === kind).get('url');
        assert.equal(google.files.get(new URL(url).pathname.split('/')[3]).mimeType, 'application/vnd.google-apps.' + mime);
      }
      const game = materials.find(m => m.get('kind') === 'game' && m.get('audience') === 'student');
      const assignment = records('Assignments').find(a => a.get('material_id') === game.get('material_id'));
      assert.equal(game.get('review_status'), 'review');
      assert.equal(assignment.get('status'), 'draft');
      async function sync(expected) {
        const r = await fetch(baseUrl + '/api/central-drive-sync', { headers: { 'x-cron-key': cronKey } });
        assert.equal(r.status, 200);
        await until(() => game.get('site_status') === expected, 'timer to write ' + expected);
        assert.deepEqual(errors, []);
      }
      return { version: game.get('content_sha256'),
        async approve() {
          game.set('review_status','approved'); game.set('publication_status','published'); game.set('release_id','fixture-release');
          assignment.set('status','assigned'); await sync('approved');
        },
        async withdraw() { assignment.set('status','cancelled'); await sync('withdrawn'); },
      };
    },
  };
}
