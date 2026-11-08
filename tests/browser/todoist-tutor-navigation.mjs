// Synthetic regression for the iOS dashboard overlay reported in Todoist.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright-core';
import { startServer, login } from '../characterization/harness.mjs';
import { formatDateTime } from '../../src/lib/dates.ts';

const server = await startServer();
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : chromium.executablePath()), headless: true });
const evidence = process.env.EVIDENCE_DIR ?? join(tmpdir(), 'meabeclick-todoist-tutor');
await mkdir(evidence, { recursive: true });
try {
  const cookie = await login(server.baseUrl);
  for (let i = 0; i < 2; i++) {
    const response = await fetch(server.baseUrl + '/api/students', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: `navigation-${i}`, name: `תלמיד לדוגמה ${i}`, subject: 'מתמטיקה', email: `navigation-${i}@example.test` }),
    });
    assert.equal(response.status, 200);
  }
  const db = new DatabaseSync(server.dbPath), now = new Date().toISOString();
  for (const student of db.prepare('SELECT s.id, e.id AS enrollment FROM students_v2 s JOIN enrollments e ON e.student_id=s.id').all()) {
    const start = new Date(Date.now() - student.id * 86400000).toISOString();
    db.prepare('INSERT INTO bookings_v2 (student_id,enrollment_id,start,"end",duration,at,status) VALUES (?,?,?,?,45,?,\'confirmed\')')
      .run(student.id, student.enrollment, start, new Date(Date.parse(start) + 2700000).toISOString(), now);
  }
  const lessonAt = db.prepare('SELECT start FROM bookings_v2 ORDER BY id LIMIT 1').get().start;
  db.prepare("INSERT INTO lessons (slug,student,title,at,lesson_at,status) VALUES ('navigation-lesson','תלמיד לדוגמה 0','שיעור לדוגמה',?,?,'ready')").run(now, lessonAt);
  const librarySlug = 'lib-navigation';
  db.prepare("INSERT INTO lessons (slug,student,title,at,status,slides) VALUES (?,'ספרייה','משוואות לדוגמה',?,'ready','slides.html')").run(librarySlug, now);
  db.prepare("INSERT INTO lesson_materials (lesson_slug,kind,version,content,origin,published_at,created_at) VALUES (?,'slides',1,?,'generated',?,?)")
    .run(librarySlug, '<!doctype html><html lang="he" dir="rtl"><body><h1>מצגת לדוגמה</h1></body></html>', now, now);
  db.prepare("INSERT INTO library_items (template_id,skill_key,slug,status,updated_at) VALUES ('math-8','alg.eq.word',?,'ready',?)").run(librarySlug, now);
  db.close();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const [name, ...value] = cookie.split('=');
  await context.addCookies([{ name, value: value.join('='), url: server.baseUrl }]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.baseUrl + '/app/dashboard');
  await page.locator('.roster-table tbody tr').first().waitFor();
  // Safari versions that ignore positioning on table rows must not let a
  // stretched row link cover every unrelated control above the roster.
  await page.locator('.roster-table tbody tr').evaluateAll(rows => rows.forEach(row => { row.style.position = 'static'; }));
  const add = page.getByRole('button', { name: 'תלמיד/ה חדש/ה', exact: true });
  assert.equal(await add.evaluate(el => {
    const r = el.getBoundingClientRect();
    const target = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return el === target || el.contains(target);
  }), true, 'new-student control must not be covered by a student link');
  await add.click();
  await page.getByRole('dialog', { name: 'הוספת תלמיד/ה' }).waitFor();
  await page.keyboard.press('Escape');
  const report = page.getByRole('link', { name: 'דיווח', exact: true }).first();
  const destination = await report.getAttribute('href');
  await report.click();
  await page.waitForURL(server.baseUrl + destination);
  await page.goto(server.baseUrl + '/app/dashboard');
  await page.getByRole('link', { name: 'תלמיד לדוגמה 0', exact: true }).click();
  await page.getByRole('heading', { level: 1, name: 'תלמיד לדוגמה 0' }).waitFor();
  assert.match(page.url(), /\/app\/students\/navigation-0$/);
  const lessonDate = page.locator('#lessons-list time');
  await lessonDate.waitFor();
  assert.equal(await lessonDate.getAttribute('datetime'), lessonAt);
  assert.equal(await lessonDate.innerText(), formatDateTime(lessonAt));
  await page.screenshot({ path: join(evidence, 'student-390.png') });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const libraryPath = '/app/library?template=math-8&status=ready';
    await page.goto(server.baseUrl + libraryPath);
    await page.locator('a[href*="/lib-navigation/view"]').click();
    const back = page.getByRole('link', { name: 'חזרה לספריית התוכן', exact: true });
    await back.waitFor();
    assert.equal(await back.getAttribute('href'), libraryPath);
    await page.frameLocator('iframe').getByRole('heading', { name: 'מצגת לדוגמה' }).waitFor();
    const header = await page.getByRole('banner').boundingBox();
    const backBounds = await back.boundingBox();
    assert.ok(backBounds.y >= header.y + header.height, 'return button stays below the sticky tutor header');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(evidence, `library-presentation-${width}.png`) });
    await back.click();
    await page.waitForURL(server.baseUrl + libraryPath);
    assert.equal(await page.locator('#library-template').inputValue(), 'math-8');
    assert.equal(await page.locator('#library-status').inputValue(), 'ready');
  }
  assert.deepEqual(errors, []);
  await writeFile(join(evidence, 'navigation.json'), JSON.stringify({ syntheticOnly: true, errors, destination }));
  console.log(JSON.stringify({ evidence, checks: ['unpositioned table rows cannot intercept controls', 'add student opens dialog', 'report opens correct booking', 'roster opens correct student', 'actual lesson date in Israel', 'library presentation and filtered return at mobile and desktop'], errors }));
} finally { await browser.close(); await server.stop(); }
