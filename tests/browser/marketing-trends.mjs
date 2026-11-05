// Synthetic local data only. Build first; CHROME_BIN can select a local Chromium.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright-core';
import { startServer, login } from '../characterization/harness.mjs';
import { israelDay } from '../../src/lib/dates.ts';

const evidenceDir = process.env.EVIDENCE_DIR ?? join(tmpdir(), 'meabeclick-marketing-trends');
await mkdir(evidenceDir, { recursive: true });
const server = await startServer();
let browser;
try {
  browser = await chromium.launch({ ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}), headless: true });
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  await context.route('**/*', route => new URL(route.request().url()).origin === server.baseUrl ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.baseUrl + '/app/marketing');
  assert.match(page.url(), /\/login\?next=/);
  const [name, value] = (await login(server.baseUrl)).split('=');
  await context.addCookies([{ name, value, url: server.baseUrl, httpOnly: true, sameSite: 'Lax' }]);
  await page.goto(server.baseUrl + '/app/marketing');
  await page.getByText('אין ביקורים או הזמנות בטווח הזה.', { exact: true }).waitFor();
  assert.equal(await page.locator('svg[role="img"]').count(), 2);

  const db = new DatabaseSync(server.dbPath, { enableForeignKeyConstraints: false });
  try {
    const event = db.prepare('INSERT INTO marketing_events (at, event, visitor_id) VALUES (?, ?, ?)');
    const payment = db.prepare("INSERT INTO payments (account_id, student_id, date, kind, amount_agorot, status) VALUES (999, 999, ?, 'single', ?, ?)");
    for (let i = 0; i < 7; i++) {
      const at = new Date(Date.now() - i * 86_400_000 - 60_000).toISOString();
      for (let j = 0; j <= i; j++) event.run(at, 'landing_visit', `synthetic-${j}`);
      if (i % 2 === 0) event.run(at, 'lesson_scheduled', null);
      payment.run(israelDay(at), 12000 + i * 1000, i % 2 === 0 ? 'paid' : 'owed');
    }
  } finally { db.close(); }
  await page.reload();
  await page.getByRole('heading', { name: 'מבקרים והזמנות לאורך זמן' }).waitFor();
  assert.ok(await page.locator('.paid-bar').evaluateAll(bars => bars.some(bar => +bar.getAttribute('height') > 0)));
  assert.ok(await page.locator('.visitor-dot').evaluateAll(dots => dots.some(dot => +dot.getAttribute('cy') < 170)));
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `horizontal overflow at ${width}`);
    await page.locator('figure').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(evidenceDir, `activity-${width}.png`) });
    await page.locator('figure').nth(1).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(evidenceDir, `payments-${width}.png`) });
  }
  const daily = page.getByText('הנתונים היומיים בטבלה', { exact: true });
  await daily.focus();
  await page.keyboard.press('Enter');
  const rowCount = await page.locator('.daily-table tbody tr').count();
  assert.ok(rowCount >= 7 && rowCount <= 8);
  await page.getByRole('link', { name: '30 ימים', exact: true }).click();
  await page.waitForURL('**/app/marketing?days=30');
  await daily.click();
  assert.ok(await page.locator('.daily-table tbody tr').count() >= 30);
  await page.getByRole('link', { name: '90 ימים', exact: true }).click();
  await page.waitForURL('**/app/marketing?days=90');
  await daily.click();
  assert.ok(await page.locator('.daily-table tbody tr').count() >= 90);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '200% text reflow');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ evidenceDir, viewports: [320, 390, 1440], charts: 'PASS', emptyState: 'PASS', dayToggle: 'PASS', keyboard: 'PASS', textReflow: 'PASS', errors }));
} finally {
  try { await browser?.close(); } finally { await server.stop(); }
}
