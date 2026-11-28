import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, createCipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { canAccessDocument, effectivePermissions, patchDriveFile } from './drive-access-fixture.mjs';
import { config, provider } from './central-drive-fixture.mjs';
import { receipt, seedRetired } from './learning-archive-fixture.mjs';
import { login } from './characterization/harness.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const site = 'https://staging.meabeclick.com';
const owner = { id: 'owner', type: 'user', role: 'owner', emailAddress: config.ownerEmail };
const scope = hash(JSON.stringify(['meabeclick-central-v1', config.ownerEmail, config.learningFolderId]));
const tokenKey = randomBytes(32);
export const homeworkAccounts = { student: 'student@example.test', parent: 'parent@example.test' };
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
    [config.projectFolderId, null, 'project'], [config.learningFolderId, config.projectFolderId, 'learning'],
    [receipt.workspaceId, config.learningFolderId, 'workspace'], [receipt.reviewId, receipt.workspaceId, 'review'],
    ['fixtureSiteFolder', config.learningFolderId, 'folder:site'], [receipt.studentsId, 'fixtureSiteFolder', 'folder:students'],
    [receipt.indexId, receipt.workspaceId, 'register'],
  ]) {
    google.files.set(id, { id, parents: parent ? [parent] : [], version: '1', owners: [owner], permissions: [owner],
      appProperties: { meaCentralScope: scope, meaCentralKey: hash(key) },
      mimeType: 'application/vnd.google-apps.' + (id === receipt.indexId ? 'spreadsheet' : 'folder') });
  }
  const tabs = () => google.spreadsheets.get(receipt.indexId)?.sheets ?? [];
  const tab = title => tabs().find(s => s.properties.title === title);
  const errors = [];
  async function respond(url, method, headers, body) {
    const [, , , , fileId, resource, permissionId] = url.pathname.split('/');
    const file = google.files.get(fileId);
    if (file && resource === 'permissions') {
      if (method === 'GET') return Response.json({ permissions: effectivePermissions(google.files, fileId) });
      if (method === 'POST') {
        const grant = { ...JSON.parse(body), id: 'grant-' + randomBytes(6).toString('hex') };
        file.permissions.push(grant);
        return Response.json(grant);
      }
      if (method === 'DELETE') {
        file.permissions = file.permissions.filter(p => p.id !== permissionId);
        return new Response(null, { status: 204 });
      }
    }
    if (file && !resource && method === 'PATCH') {
      return patchDriveFile(google.files, file, url.searchParams, body.length ? JSON.parse(body) : {});
    }
    if (file && url.searchParams.get('alt') === 'media') return new Response(file.bytes);
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
      if (f.permissions?.length === 1 && f.permissions[0].type === 'user' && Object.keys(f.permissions[0]).length === 1) f.permissions = [owner];
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
      try {
        seedRetired(db);
        const { account_id } = db.prepare('SELECT account_id FROM students_v2 WHERE id=?').get(studentId);
        const link = db.prepare('INSERT INTO google_identities(subject,scope_kind,scope_id,email,created_at) VALUES (?,?,?,?,?)');
        for (const [kind, id, email] of [['student',studentId,homeworkAccounts.student],['account',account_id,homeworkAccounts.parent]]) {
          link.run('fixture-' + kind, kind, id, email, new Date().toISOString());
        }
      } finally { db.close(); }
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
      const homework = materials.find(m => m.get('kind') === 'homework');
      const homeworkUrl = new URL(homework.get('url'));
      const doc = google.files.get(homeworkUrl.pathname.split('/')[3]);
      const releases = [game, homework].map(material => ({
        material, assignment: records('Assignments').find(a => a.get('material_id') === material.get('material_id')),
      }));
      assert.equal(game.get('review_status'), 'review');
      for (const { assignment } of releases) assert.equal(assignment.get('status'), 'draft');
      async function sync(expected) {
        const r = await fetch(baseUrl + '/api/central-drive-sync', { headers: { 'x-cron-key': cronKey } });
        assert.equal(r.status, 200);
        await until(() => game.get('site_status') === expected, 'timer to write ' + expected);
        await until(() => expected === 'approved'
          ? doc.permissions.some(p => p.emailAddress === homeworkAccounts.parent && p.role === 'reader')
          : doc.permissions.every(p => p.role === 'owner'), 'homework permission sync');
        await until(() => {
          const db = new DatabaseSync(dbPath, { readOnly: true });
          try {
            const row = db.prepare('SELECT ready FROM native_homework_delivery WHERE doc_id=?').get(doc.id);
            return Boolean(row?.ready) === (expected === 'approved');
          } finally { db.close(); }
        }, 'portal delivery state');
        assert.deepEqual(errors, []);
      }
      return { version: game.get('content_sha256'), homeworkUrl: homeworkUrl.href,
        documentRequest(link, email, edit) {
          const target = new URL(link);
          assert.equal(target.origin, homeworkUrl.origin);
          assert.deepEqual(target.pathname.split('/').slice(0,4), homeworkUrl.pathname.split('/').slice(0,4));
          if (!canAccessDocument(google.files, doc.id, email, edit !== undefined)) return { status: 403 };
          if (edit !== undefined) doc.worksheet = edit;
          return { status: 200, text: doc.worksheet };
        },
        async approve() {
          for (const { material, assignment } of releases) {
            material.set('review_status','approved'); material.set('publication_status','published'); material.set('release_id','fixture-release');
            assignment.set('status','assigned');
          }
          await sync('approved');
        },
        async withdraw() { for (const { assignment } of releases) assignment.set('status','cancelled'); await sync('withdrawn'); },
      };
    },
  };
}
