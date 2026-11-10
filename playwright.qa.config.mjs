import { defineConfig } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { validatePlan } from './scripts/pr-qa/plan.mjs';
import { JOURNEY_IDS } from './scripts/pr-qa/catalog.mjs';

const directory = resolve(process.env.PR_QA_DIR ?? '.qa-results');
const plan = process.env.PR_QA_PLAN
  ? validatePlan(JSON.parse(readFileSync(process.env.PR_QA_PLAN, 'utf8')), execFileSync('git', ['rev-parse', 'HEAD']).toString().trim())
  : { journeys: JOURNEY_IDS };
const chrome = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chromium = { browserName: 'chromium', launchOptions: existsSync(chrome) ? { executablePath: chrome } : {} };
export default defineConfig({
  testDir: './tests/qa', testMatch: '**/*.spec.mjs',
  fullyParallel: true, workers: process.env.CI ? 2 : 2,
  retries: 0, forbidOnly: !!process.env.CI, timeout: 45_000,
  expect: { timeout: 8_000 },
  grep: new RegExp(`(?:^|\\s)(?:${plan.journeys.join('|')}):`),
  outputDir: `${directory}/test-results`,
  reporter: [['list'], ['json', { outputFile: `${directory}/results.json` }], ['html', { outputFolder: `${directory}/html`, open: 'never' }]],
  projects: [
    { name: 'chromium-phone', use: { ...chromium, viewport: { width: 390, height: 844 } } },
    { name: 'chromium-desktop', use: { ...chromium, viewport: { width: 1440, height: 1000 } } },
    ...(process.env.CI || process.env.QA_WEBKIT ? [{ name: 'webkit-phone', use: { browserName: 'webkit', viewport: { width: 390, height: 844 } } }] : []),
  ],
});
