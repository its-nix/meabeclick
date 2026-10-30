// Synthetic-only engineering smoke, not independent UX/AT approval.
// Build first. PLAYWRIGHT_MODULE may name an installed playwright-core index.mjs.
// No dependency, credential, source-data, or production configuration changes.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { startServer, login } from '../characterization/harness.mjs';

const moduleName = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(moduleName ? pathToFileURL(moduleName).href : 'playwright-core');
const evidenceDir = process.env.EVIDENCE_DIR ?? join(tmpdir(), 'tutor-metrics-browser');
await mkdir(evidenceDir, { recursive: true });
const server = await startServer();
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const report = { browser: browser.version(), url: `${server.baseUrl}/app/metrics`, syntheticOnly: true, externalRequestsBlocked: true, viewports: [], requests: [], errors: [] };
try {
  const context = await browser.newContext({ viewport: { width: 320, height: 800 }, reducedMotion: 'reduce' });
  await context.route('**/*', route => new URL(route.request().url()).origin === server.baseUrl ? route.continue() : route.abort());
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(report.url);
  assert.match(page.url(), /\/login\?next=/);
  const cookie = await login(server.baseUrl);
  const [name, value] = cookie.split('=');
  await context.addCookies([{ name, value, url: server.baseUrl, httpOnly: true, sameSite: 'Lax' }]);
  page.on('request', request => report.requests.push(new URL(request.url()).pathname));
  await page.goto(report.url);
  await page.getByRole('heading', { level: 1 }).waitFor();
  assert.equal(await page.locator('[data-availability="NOT_AVAILABLE"]').count(), 14);
  assert.equal(await page.locator('main').getAttribute('dir'), 'rtl');
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 800 });
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth }));
    assert.ok(dimensions.page <= dimensions.viewport, `horizontal overflow at ${width}`);
    await page.screenshot({ path: join(evidenceDir, `metrics-${width}.png`) });
    report.viewports.push(dimensions);
    await page.locator('article').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(evidenceDir, `metrics-cards-${width}.png`) });
    await page.evaluate(() => scrollTo(0, 0));
  }
  await page.setViewportSize({ width: 320, height: 800 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '200% text reflow');
  await page.screenshot({ path: join(evidenceDir, 'metrics-320-text200.png') });
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  const summary = page.locator('summary').first();
  await summary.focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('details').first().getAttribute('open'), '');
  await summary.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(evidenceDir, 'metrics-detail.png') });
  const focus = await summary.evaluate(el => ({ outlineStyle: getComputedStyle(el).outlineStyle, outlineWidth: getComputedStyle(el).outlineWidth, height: el.getBoundingClientRect().height }));
  assert.equal(focus.outlineStyle, 'solid');
  assert.ok(focus.height >= 44);
  report.keyboardDisclosure = { pass: true, ...focus };
  report.headings = await page.locator('h1,h2,h3').allTextContents();
  assert.ok(!report.requests.some(path => path.startsWith('/api/')), 'metrics page must not fetch sources');
  assert.deepEqual(report.errors, []);
  // Full navigation with the session removed must recover to login; no client-only lock.
  await context.clearCookies();
  await page.reload();
  assert.match(page.url(), /\/login\?next=/);
  assert.equal(await page.locator('[data-availability]').count(), 0);
  report.sessionRecovery = 'PASS';
  report.manualAT = 'NOT_RUN: independent UX/assistive-technology review remains downstream';
  await writeFile(join(evidenceDir, 'browser-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, evidenceDir }, null, 2));
} finally {
  await browser.close();
  await server.stop();
}
