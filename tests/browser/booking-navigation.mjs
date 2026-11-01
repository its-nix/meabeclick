// Synthetic local smoke: build first; use the installed Playwright module.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { startServer, login } from '../characterization/harness.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright-core');
const evidenceDir = process.env.EVIDENCE_DIR ?? join(tmpdir(), 'meabeclick-booking-navigation');
await mkdir(evidenceDir, { recursive: true });
const server = await startServer();
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await context.route('**/*', route => new URL(route.request().url()).origin === server.baseUrl ? route.continue() : route.abort());
  const labels = ['יום שני, 2 נובמבר', 'יום שלישי, 3 נובמבר', 'יום רביעי, 4 נובמבר'];
  await context.route('**/api/availability?*', route => route.fulfill({ json: {
    calendarConnected: true, calendarFailures: 0,
    slots: labels.map((dateLabel, i) => ({ dateLabel, timeLabel: '11:00',
      start: `2026-11-0${i + 2}T09:00:00.000Z`, end: `2026-11-0${i + 2}T10:30:00.000Z` })),
  } }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${server.baseUrl}/booking`);
  await page.getByRole('button', { name: /^המשך עם/ }).click();
  await page.locator('.day-tab').first().waitFor();
  assert.deepEqual(await page.locator('.day-tab').allTextContents(), ['שני', 'שלישי', 'רביעי']);
  assert.deepEqual(await page.locator('.day-tab').evaluateAll(tabs => tabs.map(t => t.getAttribute('aria-label'))), labels);
  await page.getByRole('tab', { name: labels[1] }).click();
  assert.equal(await page.locator('.day-label').textContent(), labels[1]);
  const dimensions = [];
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const size = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth }));
    assert.ok(size.page <= size.viewport, `booking overflow at ${width}`);
    dimensions.push(size);
    await page.screenshot({ path: join(evidenceDir, `booking-${width}.png`) });
  }
  const [name, value] = (await login(server.baseUrl)).split('=');
  await context.addCookies([{ name, value, url: server.baseUrl, httpOnly: true, sameSite: 'Lax' }]);
  await page.goto(`${server.baseUrl}/app/dashboard`);
  await page.locator('.nav-menu summary').click();
  const menu = page.getByRole('navigation', { name: 'ניווט לוח הבקרה' });
  assert.deepEqual(await menu.getByRole('link').allTextContents(), ['ספרייה', 'שיווק']);
  assert.equal(await menu.getByRole('button', { name: 'יציאה מהחשבון' }).count(), 1);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `dashboard overflow at ${width}`);
    await page.screenshot({ path: join(evidenceDir, `dashboard-menu-${width}.png`) });
  }
  await menu.getByRole('button', { name: 'יציאה מהחשבון' }).click();
  await page.waitForURL(server.baseUrl + '/');
  const denied = await context.request.get(`${server.baseUrl}/app/dashboard`, { maxRedirects: 0 });
  assert.equal(denied.status(), 302, 'sign-out must still clear the session');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ browser: browser.version(), dimensions, weekdayLabels: 'PASS', menu: 'PASS', logout: 'PASS', errors, evidenceDir }));
} finally {
  await browser.close();
  await server.stop();
}
