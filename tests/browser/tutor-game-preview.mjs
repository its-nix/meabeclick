// Synthetic-only regression: tutors preview game files without student score writes.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright-core';
import { startServer, login } from '../characterization/harness.mjs';

const evidence = process.env.EVIDENCE_DIR ?? join(tmpdir(), 'meabeclick-tutor-game-preview');
await mkdir(evidence, { recursive: true });
const server = await startServer();
let browser;
const report = { syntheticOnly: true, errors: [], resultRequests: [] };
try {
  const cookie = await login(server.baseUrl);
  const created = await fetch(`${server.baseUrl}/api/students`, {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'preview-pupil', name: 'תלמיד לדוגמה', subject: 'מתמטיקה', level: 'כיתה ח' }),
  }).then(r => r.json());
  const db = new DatabaseSync(server.dbPath);
  const at = '2028-01-10T10:00:00.000Z';
  db.prepare(`INSERT INTO bookings_v2 (student_id, start, end, at, status) VALUES (?, ?, ?, ?, 'confirmed')`).run(created.student.id, at, at, at);
  db.prepare(`INSERT INTO lessons (slug, student, at, lesson_at, status, games) VALUES (?, ?, ?, ?, 'ready', ?)`).run(
    'tutor-preview-lesson', 'תלמיד לדוגמה', at, at, JSON.stringify([{ title: 'משחק לדוגמה', url: 'games/quiz.html?d=tutor-preview-game&s=preview-pupil' }]),
  );
  const counts = () => ['results', 'results_v2'].map(table => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
  const before = counts();
  await mkdir(join(server.dataDir, 'games-data'), { recursive: true });
  await writeFile(join(server.dataDir, 'games-data', 'tutor-preview-game.json'), JSON.stringify({
    title: 'משחק לדוגמה', subject: 'מתמטיקה', questions: [{ q: 'כמה הם 2 ועוד 2?', options: ['4', '5'], answer: 0 }],
  }));
  const lessons = await fetch(`${server.baseUrl}/api/lessons?studentCode=preview-pupil`, { headers: { Cookie: cookie } }).then(r => r.json());
  const path = lessons.lessons[0].games[0].url;
  assert.equal((await fetch(server.baseUrl + path, { redirect: 'manual' })).status, 302, 'preview requires a tutor session');
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : chromium.executablePath()), headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const [name, ...value] = cookie.split('=');
  await context.addCookies([{ name, value: value.join('='), url: server.baseUrl }]);
  // A tutor preview must not flush even an earlier student's queued results.
  await context.addInitScript(() => localStorage.setItem('mea-beclick:pending-results', JSON.stringify([{ student: 'old-student', dataId: 'old-game', t: 'old-token' }])));
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('request', request => { if (request.url().includes('/api/game-result')) report.resultRequests.push(request.url()); });
  await page.goto(server.baseUrl + path);
  await page.locator('.preview-banner').waitFor();
  assert.equal(await page.locator('.best-note').count(), 0);
  assert.equal(await page.locator('a.back').first().getAttribute('href'), '/app/students/preview-pupil');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole('button', { name: '4', exact: true }).click();
  await page.getByRole('button', { name: 'סיום 🏁', exact: true }).click();
  await page.locator('#done').waitFor();
  assert.equal(await page.locator('#done a.back').getAttribute('href'), '/app/students/preview-pupil');
  assert.equal(await page.locator('.save-line').innerText(), '');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.screenshot({ path: join(evidence, 'completed-390.png'), fullPage: true });
  assert.deepEqual(report.resultRequests, [], 'preview must neither flush queued results nor post its score');
  assert.deepEqual(counts(), before);
  await page.goto(`${server.baseUrl}/app/play/quiz?teacher=1&d=missing-preview&returnTo=%2Fapp%2Fstudents%2Fpreview-pupil`);
  assert.equal(await page.locator('a.error-home').getAttribute('href'), '/app/students/preview-pupil');
  await page.screenshot({ path: join(evidence, 'missing-390.png'), fullPage: true });
  assert.deepEqual(report.errors, []);
  db.close();
  console.log(`Tutor preview completion and recovery verified. Evidence: ${evidence}`);
} finally {
  await writeFile(join(evidence, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  await server.stop();
}
