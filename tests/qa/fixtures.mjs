import { test as base, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { startServer, login, familySession } from '../characterization/harness.mjs';
import { seedLearning } from '../characterization/learning-fixture.mjs';
import { createServer as createHttpsServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export { expect };
export const test = base.extend({
  learningConnection:[false,{option:true}],
  tlsCredentials: [async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'qa-local-tls-'));
    try {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
      await use({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, { scope: 'worker' }],
  qa: async ({ browser, tlsCredentials,learningConnection }, use, info) => {
    let server;
    let learningDir;
    const learningEnv={};
    if(learningConnection){
      learningDir=mkdtempSync(join(tmpdir(),'qa-learning-google-'));
      const workspace={version:1,ownerEmail:'owner@example.com',projectFolderId:'project12345',learningFolderId:'learning12345',spreadsheetId:'spreadsheet12345',templatesFolderId:'templates12345',libraryFolderId:'library12345',studentsFolderId:'students12345',reviewFolderId:'review12345',studentProfileTemplateId:'profile12345',lessonBriefTemplateId:'brief12345'};
      writeFileSync(join(learningDir,'workspace.json'),JSON.stringify(workspace));
      Object.assign(learningEnv,{LEARNING_GOOGLE_CLIENT_ID:'synthetic-learning-client',LEARNING_GOOGLE_CLIENT_SECRET:'synthetic-learning-secret',LEARNING_GOOGLE_WORKSPACE_FILE:join(learningDir,'workspace.json'),LEARNING_GOOGLE_TOKEN_KEY:'ab'.repeat(32)});
    }
    const proxy = createHttpsServer(tlsCredentials, (incoming, response) => {
      if (!server) { response.writeHead(503).end(); return; }
      const upstream = httpRequest(server.baseUrl + incoming.url, {
        method: incoming.method, headers: { ...incoming.headers, 'x-forwarded-proto': 'https' },
      }, result => { response.writeHead(result.statusCode, result.headers); result.pipe(response); });
      upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
      incoming.pipe(upstream);
    });
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    const browserUrl = `https://127.0.0.1:${proxy.address().port}`;
    const contexts = [];
    const errors = [];
    try {
      server = await startServer({ fakeGoogle:learningConnection,env: { NODE_ENV: 'production', SITE_URL: browserUrl, ORIGIN: browserUrl,...learningEnv } });
      // Seed helpers use HTTP on the private backend; browsers use the HTTPS
      // entry point, preserving the app's real production cookie semantics.
      const sessionForLink = link => familySession(link.replace(browserUrl, server.baseUrl));
      const tutor = await login(server.baseUrl);
      const learner = await seedLearning(server, 'qa', { sessionForLink });
      const request = async (path, { method = 'GET', cookie = tutor, json } = {}) => {
        const response = await fetch(server.baseUrl + path, {
          method, redirect: 'manual', headers: { Cookie: cookie, ...(json === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(json === undefined ? {} : { body: JSON.stringify(json) }),
        });
        return response;
      };
      const create = async (code, email, name) => {
        const r = await request('/api/students', { method: 'POST', json: { code, email, name, subject: 'מתמטיקה', level: 'כיתה ט' } });
        expect(r.status, await r.clone().text()).toBe(200);
        return code;
      };
      const sibling = await create('qa-sibling', 'learning-qa@example.com', 'אחות בדיקה');
      const outsider = await create('qa-outsider', 'other@example.com', 'משפחה אחרת');
      const credential = await request(`/api/students/${learner.code}/link`, { method: 'POST', json: { scope: 'student' } });
      expect(credential.status).toBe(200);
      const student = await sessionForLink((await credential.json()).link);
      const cookies = { tutor, parent: learner.cookie, student, anonymous: '' };
      const page = async (role) => {
        const context = await browser.newContext({ viewport: info.project.use.viewport, locale: 'he-IL', reducedMotion: 'reduce', baseURL: browserUrl, ignoreHTTPSErrors: true });
        contexts.push(context);
        await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
        if (cookies[role]) {
          const [name, ...value] = cookies[role].split('=');
          await context.addCookies([{ name, value: value.join('='), url: browserUrl, secure: true }]);
        }
        // Browser journeys stay local, including fonts and accidental external navigation.
        await context.route('**/*', route => new URL(route.request().url()).origin === browserUrl
          ? route.continue() : route.fulfill({ status: 200, contentType: 'text/plain', body: '' }));
        context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
        return context.newPage();
      };
      const evidence = async (p, label) => {
        await expect(p.locator('body')).toBeVisible();
        expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: horizontal overflow`).toBe(true);
        await info.attach(label, { body: await p.screenshot({ fullPage: true, animations: 'disabled' }), contentType: 'image/png' });
      };
      const row = (sql, ...params) => {
        const db = new DatabaseSync(server.dbPath, { readOnly: true });
        try {
          db.exec('PRAGMA busy_timeout=5000');
          return db.prepare(sql).get(...params);
        } finally { db.close(); }
      };
      await use({ ...server, browserUrl, learner, sibling, outsider, cookies, request, page, evidence, row });
      expect(errors, 'uncaught browser errors').toEqual([]);
    } finally {
      const teardown = await Promise.allSettled(contexts.map(async (context, i) => {
        const failed = info.status !== info.expectedStatus || errors.length > 0;
        const path = info.outputPath(`context-${i}.zip`);
        try {
          if (failed) {
            await context.tracing.stop({ path });
            await info.attach(`trace-${i}`, { path, contentType: 'application/zip' });
            for (const [n, p] of context.pages().entries()) {
              await info.attach(`failure-${i}-${n}`, { body: await p.screenshot({ fullPage: true, timeout: 3000 }), contentType: 'image/png' }).catch(() => {});
            }
          } else await context.tracing.stop();
        } finally { await context.close(); }
      }));
      proxy.closeAllConnections();
      await new Promise(resolve => proxy.close(resolve));
      if (server) await server.stop();
      if(learningDir)rmSync(learningDir,{recursive:true,force:true});
      const failed = teardown.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
    }
  },
});
