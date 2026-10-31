// Synthetic engineering smoke. No production/AT or independent UX approval implied.
// npm run build; PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node tests/browser/homework-clarity.mjs
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { startServer, login, familySession } from '../characterization/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright-core');
const evidenceDir = process.env.EVIDENCE_DIR ?? join(tmpdir(), 'homework-clarity-evidence');
await mkdir(evidenceDir, { recursive: true });
const server = await startServer();
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const report = { syntheticOnly: true, browser: browser.version(), viewports: [], errors: [], manualAT: 'NOT_RUN', deviceSafariAndroid: 'NOT_RUN' };
try {
  const booking = await fetch(`${server.baseUrl}/api/book`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'תלמיד בדיקה', subject: 'מתמטיקה', level: 'כיתה ח', phone: '0501234567', email: 'homework@example.com', durationMin: 45, start: '2027-04-15T10:00:00.000Z', end: '2027-04-15T10:45:00.000Z' }),
  });
  assert.equal(booking.status, 200);
  const { portal } = await booking.json();
  const cookie = await familySession(portal.link);
  const [name, value] = cookie.split('=');
  const context = await browser.newContext({ viewport: { width: 320, height: 800 }, reducedMotion: 'reduce' });
  await context.addCookies([{ name, value, url: server.baseUrl, httpOnly: true, sameSite: 'Lax' }]);
  const tasks = [
    { id: 101, task: '1. במשולש ABC. הנתונים: AB = 3.5, AC = 4; A(2, 3)\nהשאלה: חשבו את ההיקף.\n2. פתרו x + 2 = 7', skill: 'משולשים', assigned: '2026-10-30', due: '2026-11-05', submitted: false, graded: false },
    { id: 102, task: 'פתרו 8-x-3=5-x', submitted: true, graded: false },
    { id: 103, task: 'תרגיל שנבדק', submitted: false, graded: true, grade: 'ok' },
    { id: 104, task: 'משחק תרגול', url: '/app/play/quiz?d=synthetic', submitted: false, graded: false },
    { task: '<img src=x onerror=alert(1)>\nטקסט קודם ללא מזהה', submitted: false, graded: false },
  ];
  let fixtureMode = true;
  let patchCount = 0;
  let mode = 'success';
  let release;
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== server.baseUrl) return route.abort();
    if (!fixtureMode) return route.continue();
    if (url.pathname === '/app/play/quiz') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<html lang="he" dir="rtl"><h1>משחק סינתטי</h1></html>' });
    if (url.pathname === `/api/portal/${portal.code}`) return route.fulfill({ json: { name: 'תלמיד בדיקה', homework: tasks, lessons: [], games: [], progress: { kind: 'skills', done: 9, total: 10, percent: 90 } } });
    if (url.pathname.endsWith('/homework') && request.method() === 'PATCH') {
      patchCount++;
      if (mode === 'pending') await new Promise(resolve => { release = resolve; });
      if (mode === 'failure') return route.fulfill({ status: 500, json: { error: 'synthetic failure' } });
      const body = request.postDataJSON();
      const task = tasks.find(t => t.id === body.id);
      task.submitted = body.submitted;
      return route.fulfill({ json: { homework: tasks.filter(t => t.id).map(({ id, submitted, graded }) => ({ id, submitted, graded })), progress: { kind: 'skills', done: 9, total: 10, percent: 90 } } });
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', e => report.errors.push(e.message));
  await page.goto(`${server.baseUrl}/app/student?s=${portal.code}&v=hw`);
  await page.getByRole('heading', { name: 'שיעורי הבית שלי', exact: true }).waitFor({ timeout: 5000 });
  const progress = page.getByRole('status');
  assert.match(await progress.textContent(), /2 מתוך 4 מטלות בכתב הוגשו או נבדקו/);
  const writtenProgress = page.getByRole('progressbar', { name: 'הגשת מטלות בכתב', exact: true });
  assert.equal(await writtenProgress.getAttribute('max'), '4');
  assert.equal(await writtenProgress.getAttribute('value'), '2');
  assert.equal(await page.getByRole('progressbar', { name: 'ההתקדמות שלי', exact: true }).getAttribute('aria-valuenow'), '9');
  // Navigation/play history is not submission or grading evidence.
  await page.goto(new URL(await page.locator('.homework-card').nth(3).getByRole('link').getAttribute('href'), server.baseUrl).href);
  await page.getByRole('heading', { name: 'משחק סינתטי', exact: true }).waitFor();
  tasks[3].plays = 1;
  tasks[3].lastPlayedAt = '2026-10-31T10:00:00Z';
  await page.goBack();
  await page.getByRole('heading', { name: 'שיעורי הבית שלי', exact: true }).waitFor();
  assert.match(await progress.textContent(), /2 מתוך 4 מטלות בכתב הוגשו או נבדקו/);
  assert.equal(await writtenProgress.getAttribute('max'), '4');
  assert.equal(await writtenProgress.getAttribute('value'), '2');
  assert.equal(await page.locator('.homework-card').count(), 5);
  const first = page.locator('.homework-card').first();
  assert.equal(await first.locator('.problem').count(), 2);
  assert.deepEqual(await first.locator('.datum').allTextContents(), ['AB = 3.5', 'AC = 4', 'A(2, 3)']);
  assert.match(await first.textContent(), /משולשים/);
  assert.match(await first.textContent(), /ניתן ב־/);
  assert.equal(await page.getByText(/להגשה עד/).count(), 1);
  assert.equal(await page.locator('img[src="x"],input[type="file"]').count(), 0);
  assert.match(await page.locator('.homework-card').last().textContent(), /<img src=x onerror=alert\(1\)>/);
  assert.equal(await page.locator('.homework-card').nth(2).getByRole('button').count(), 0);
  assert.equal(await page.locator('.homework-card').last().getByRole('button').count(), 0);
  assert.match(await page.locator('.homework-card').nth(3).getByRole('link').getAttribute('href'), /^\/app\/play\//);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth }));
    assert.ok(dimensions.page <= dimensions.viewport, `overflow at ${width}`);
    await page.screenshot({ path: join(evidenceDir, `homework-${width}.png`), fullPage: true });
    report.viewports.push(dimensions);
  }
  await page.setViewportSize({ width: 320, height: 800 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  const reflow = await page.evaluate(() => ({ width: innerWidth, page: document.documentElement.scrollWidth }));
  report.text200Reflow = reflow;
  await page.screenshot({ path: join(evidenceDir, 'homework-320-text200.png'), fullPage: true });
  assert.ok(reflow.page <= reflow.width, '200% text reflow');
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  const toggle = first.getByRole('button');
  assert.equal(await first.getByRole('button', { name: 'סיימתי — מטלה 1', exact: true }).count(), 1);
  await toggle.focus();
  const focus = await toggle.evaluate(el => ({ outline: getComputedStyle(el).outlineStyle, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }));
  assert.equal(focus.outline, 'solid');
  assert.ok(focus.width >= 44 && focus.height >= 44);
  mode = 'pending';
  await page.keyboard.press('Space');
  await page.getByText('שומר…', { exact: true }).waitFor();
  assert.equal(await first.getByRole('button', { name: 'שומר… — מטלה 1', exact: true }).count(), 1);
  assert.match(await progress.textContent(), /2 מתוך 4/);
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  await page.keyboard.press('Space');
  assert.equal(patchCount, 1);
  release();
  await first.getByRole('button', { name: 'ביטול הגשה — מטלה 1', exact: true }).waitFor();
  assert.equal(await first.getByRole('button', { name: 'ביטול הגשה — מטלה 1', exact: true }).count(), 1);
  await page.waitForFunction(() => document.querySelector('[role="status"]').textContent.includes('3 מתוך 4'));
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  assert.equal(await toggle.evaluate(el => el === document.activeElement), true);
  mode = 'failure';
  await toggle.click();
  await page.getByRole('alert').waitFor();
  assert.match(await progress.textContent(), /3 מתוך 4/);
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  mode = 'pending';
  await toggle.click();
  await first.getByRole('button', { name: 'שומר… — מטלה 1', exact: true }).waitFor();
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  assert.match(await progress.textContent(), /3 מתוך 4/);
  release();
  await page.waitForFunction(() => document.querySelector('[role="status"]').textContent.includes('2 מתוך 4'));
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  assert.equal(await first.getByRole('button', { name: 'סיימתי — מטלה 1', exact: true }).count(), 1);
  await page.reload();
  await page.getByRole('heading', { name: 'שיעורי הבית שלי', exact: true }).waitFor();
  assert.match(await page.getByRole('status').textContent(), /2 מתוך 4/);
  const gameOnly = tasks[3];
  tasks.splice(0, tasks.length, gameOnly);
  await page.reload();
  await page.getByRole('heading', { name: 'שיעורי הבית שלי', exact: true }).waitFor();
  assert.match(await progress.textContent(), /0 מתוך 0 מטלות בכתב הוגשו או נבדקו/);
  assert.equal(await writtenProgress.count(), 0);
  assert.equal(await page.locator('.homework-card').getByRole('link').count(), 1);
  tasks.splice(0);
  await page.reload();
  await page.getByText('עוד אין שיעורי בית — הם יופיעו כאן אחרי השיעור הראשון.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('progressbar', { name: 'הגשת מטלות בכתב' }).count(), 0);
  // Real local API + disposable SQLite, not a synthesized PATCH result.
  const adminCookie = await login(server.baseUrl);
  const created = await fetch(`${server.baseUrl}/api/students/${portal.code}/activity`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ kind: 'homework', task: 'משימה סינתטית מהשרת: פתרו x + 1 = 3', date: '2026-11-05' }),
  });
  assert.ok(created.ok);
  fixtureMode = false;
  await page.reload();
  await page.getByText('משימה סינתטית מהשרת:', { exact: false }).waitFor();
  const realToggle = page.locator('.homework-card').first().getByRole('button');
  await realToggle.click();
  await page.waitForFunction(() => document.querySelector('[role="status"]').textContent.includes('1 מתוך 1'));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.includes('1 מתוך 1'));
  assert.equal(await page.locator('.homework-card').first().getByRole('button').getAttribute('aria-pressed'), 'true');
  await page.locator('.homework-card').first().getByRole('button').click();
  await page.waitForFunction(() => document.querySelector('[role="status"]').textContent.includes('0 מתוך 1'));
  report.realLocalApiAndReloadPersistence = 'PASS';
  assert.deepEqual(report.errors, []);
  report.keyboardAndServerConfirmedSaveUndoFailure = 'PASS';
  report.legacyGradedGameEmptyAndSafeText = 'PASS';
  report.accessibleNamesInitialPendingSubmittedUndo = 'PASS';
  report.writtenOnlyAggregateUnplayedAndReturnedGameExcluded = 'PASS';
  await writeFile(join(evidenceDir, 'browser-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, evidenceDir }, null, 2));
} finally {
  await browser.close();
  await server.stop();
}
