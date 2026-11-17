import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { startServer } from '../characterization/harness.mjs';

/* Public sample quiz at /sample-game: 390px RTL, no login, server-graded.
   (Replaces the browser test of the retired /learn/parabolas page.) */
const evidence = process.env.EVIDENCE_DIR ?? join(tmpdir(), 'meabeclick-sample-game-evidence');
await mkdir(evidence, { recursive: true });
const server = await startServer();
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : chromium.executablePath()), headless: true });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${server.baseUrl}/sample-game`);
  assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
  const round = page.locator('[data-task]').first();
  await round.locator('[data-choice]').nth(1).click();
  await round.locator('[data-task-action="attempt"]').click();
  await round.locator('[data-task-feedback]').filter({ hasText: /\S/ }).waitFor();
  await round.locator('[data-choice]').nth(0).click();
  await round.locator('[data-task-action="attempt"]').click();
  await page.screenshot({ path: join(evidence, 'sample-390.png'), fullPage: true });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `overflow ${width}`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); await server.stop(); }
