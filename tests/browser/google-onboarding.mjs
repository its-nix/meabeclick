// Synthetic families only. Fake Google signs real JWTs; the app verifies its JWKS.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright-core';
import { startServer, login } from '../characterization/harness.mjs';

const evidence = process.env.EVIDENCE_DIR ?? join(tmpdir(), 'meabeclick-google-onboarding');
await mkdir(evidence, { recursive: true });
const server = await startServer({ fakeGoogle: true, env: {
  GOOGLE_LOGIN_CLIENT_ID: 'browser-login-client', GOOGLE_LOGIN_CLIENT_SECRET: 'synthetic-secret', GOOGLE_TUTOR_EMAILS: 'tutor@gmail.com',
} });
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : chromium.executablePath()), headless: true });
const errors = [];
const contexts = [];
async function contextFor(profile, viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  contexts.push(context);
  context.setDefaultTimeout(12_000);
  context.setDefaultNavigationTimeout(12_000);
  await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: `@font-face{font-family:Heebo;src:url('${server.baseUrl}/learning-assets/heebo-hebrew.woff2') format('woff2');font-weight:100 900;}` }));
  // Redirected requests aren't independently routable in Playwright. Fetch the
  // real start endpoint once, preserve its cookie, and stand in for Google's return.
  await context.route('**/auth/google/start', async route => {
    const response = await route.fetch({ maxRedirects: 0 });
    if (response.status() !== 303) { await route.fulfill({ response }); return; }
    const provider = new URL(response.headers().location);
    assert.equal(provider.origin, 'https://accounts.google.com');
    const code = 'login.' + Buffer.from(JSON.stringify({ nonce: provider.searchParams.get('nonce'), ...profile })).toString('base64url');
    const destination = server.baseUrl + '/auth/google/callback?' + new URLSearchParams({ state: provider.searchParams.get('state'), code });
    await route.fulfill({ response, headers: { ...response.headers(), location: destination } });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));

  return { context, page };
}
async function capture(page, name) {
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} has horizontal overflow`);
  await page.screenshot({ path: join(evidence, name + '.png'), fullPage: true });
}
try {
  const tutor = await login(server.baseUrl);
  const response = await fetch(server.baseUrl + '/api/students', { method: 'POST', headers: { Cookie: tutor, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'browser-child', name: 'נועה לדוגמה', email: 'parent@gmail.com', phone: '0501234567', level: 'כיתה ח', subject: 'מתמטיקה' }) });
  assert.equal(response.status, 200);
  const parent = await contextFor({ subject: 'browser-parent', email: 'parent@gmail.com' });
  await parent.page.goto(server.baseUrl + '/portal');
  await capture(parent.page, 'portal-390');
  await parent.page.getByRole('button', { name: 'המשך עם Google', exact: true }).click();
  await parent.page.waitForURL(/\/app\/parent/);
  await parent.page.getByRole('button', { name: 'הזמנה בוואטסאפ', exact: true }).waitFor();
  const inviteButton = await parent.page.getByRole('button', { name: 'הזמנה בוואטסאפ', exact: true }).boundingBox();
  assert.ok(inviteButton.y + inviteButton.height < 844, 'invitation is visible on the first phone screen');
  await capture(parent.page, 'parent-before-invite-390');
  await parent.page.getByRole('button', { name: 'הזמנה בוואטסאפ', exact: true }).click();
  const share = parent.page.getByRole('link', { name: 'שליחה בוואטסאפ', exact: true });
  await share.waitFor();
  const message = new URL(await share.getAttribute('href')).searchParams.get('text');
  const invitation = message.match(/http:\/\/[^\s]+/)[0];
  await capture(parent.page, 'parent-invitation-ready-390');

  // The parent can safely open the invitation without consuming it or losing parent access.
  await parent.page.goto(invitation);
  await parent.page.getByRole('link', { name: 'צפייה בלוח התלמיד/ה', exact: true }).waitFor();
  await capture(parent.page, 'parent-preview-390');
  assert.equal((await parent.context.cookies()).find(c => c.name === 'maab_family') !== undefined, true);
  await parent.page.getByRole('link', { name: 'צפייה בלוח התלמיד/ה', exact: true }).click();
  await parent.page.waitForURL(/\/app\/student/);
  await parent.page.goto(server.baseUrl + '/app/parent');
  await parent.page.getByRole('heading', { name: 'נועה לדוגמה', exact: true }).waitFor();

  const child = await contextFor({ subject: 'browser-child-google', email: 'child@gmail.com' });
  await child.page.goto(invitation);
  await child.page.getByRole('button', { name: 'חיבור וכניסה עם Google', exact: true }).waitFor();
  await capture(child.page, 'child-invitation-390');
  await child.page.getByRole('button', { name: 'חיבור וכניסה עם Google', exact: true }).click();
  await child.page.waitForURL(/\/app\/student\?s=browser-child/);
  await child.page.getByRole('heading', { name: 'היום שלי', exact: true }).waitFor();
  await capture(child.page, 'child-connected-390');
  assert.equal(await child.page.getByRole('button', { name: 'חיבור חשבון Google', exact: true }).count(), 0);
  await child.page.goto(server.baseUrl + '/app/parent');
  await child.page.waitForURL(/\/app\/student/);
  // A second browser now needs only Google, with no parent involvement.
  const returning = await contextFor({ subject: 'browser-child-google', email: 'child@gmail.com' });
  await returning.page.goto(server.baseUrl + '/portal');
  await returning.page.getByRole('button', { name: 'המשך עם Google', exact: true }).click();
  await returning.page.waitForURL(/\/app\/student\?s=browser-child/);

  const independent = await contextFor({ subject: 'browser-independent', email: 'independent@gmail.com', name: 'רון לדוגמה' });
  await independent.page.goto(server.baseUrl + '/portal');
  await independent.page.getByRole('button', { name: 'המשך עם Google', exact: true }).click();
  await independent.page.waitForURL(/\/onboarding$/);
  await independent.page.getByRole('radio', { name: 'אני לומד/ת', exact: true }).check();
  assert.equal(await independent.page.locator('#learner-name').inputValue(), 'רון לדוגמה');
  await independent.page.locator('#learner-level').selectOption({ label: 'כיתה יא' });
  await capture(independent.page, 'independent-setup-390');
  await independent.page.getByRole('button', { name: 'פתיחת הדף האישי', exact: true }).click();
  await independent.page.waitForURL(/\/app\/student/);
  await independent.page.getByRole('heading', { name: 'היום שלי', exact: true }).waitFor();

  const newParent = await contextFor({ subject: 'browser-new-parent', email: 'newparent@gmail.com' });
  await newParent.page.goto(server.baseUrl + '/portal');
  await newParent.page.getByRole('button', { name: 'המשך עם Google', exact: true }).click();
  await newParent.page.waitForURL(/\/onboarding$/);
  await newParent.page.getByRole('radio', { name: 'לילד/ה שלי', exact: true }).check();
  await newParent.page.locator('#learner-name').fill('ילד חדש לדוגמה');
  await newParent.page.locator('#learner-level').selectOption({ label: 'כיתה ט' });
  await newParent.page.getByRole('button', { name: 'פתיחת הדף האישי', exact: true }).click();
  await newParent.page.waitForURL(/\/app\/parent/);
  await newParent.page.getByRole('button', { name: 'הזמנה בוואטסאפ', exact: true }).waitFor();
  await capture(newParent.page, 'new-parent-390');

  const booking = await contextFor({ subject: 'browser-parent', email: 'parent@gmail.com' });
  await booking.context.route('**/api/availability?*', route => route.fulfill({ json: {
    calendarConnected: true, calendarFailures: 0, slots: [{ dateLabel: 'יום ראשון, 5 דצמבר', timeLabel: '11:00',
      start: '2027-12-05T09:00:00.000Z', end: '2027-12-05T10:30:00.000Z' }],
  } }));
  await booking.page.goto(server.baseUrl + '/booking');
  await booking.page.getByRole('button', { name: /^המשך עם/ }).click();
  await booking.page.locator('button.slot').first().click();
  await booking.page.getByRole('button', { name: /הילד\/ה שלי/ }).click();
  await booking.page.locator('#inp-name').fill('נועה לדוגמה');
  await booking.page.locator('#inp-level').selectOption({ label: 'כיתה ח' });
  await booking.page.locator('#inp-request').fill('לשמור את בקשת השיעור במהלך הכניסה');
  await Promise.all([
    booking.page.waitForURL(/\/booking\?resume=1/, { waitUntil: 'commit' }),
    booking.page.getByRole('button', { name: 'המשך עם Google', exact: true }).click(),
  ]);
  await booking.page.waitForFunction(() => !new URL(location.href).searchParams.has('resume') && sessionStorage.getItem('maab-booking-google-draft') === null);
  await booking.page.getByRole('dialog').waitFor();
  assert.equal(await booking.page.locator('#inp-request').inputValue(), 'לשמור את בקשת השיעור במהלך הכניסה');
  assert.match(await booking.page.locator('.sheet-when').innerText(), /11:00/);
  assert.equal(await booking.page.evaluate(() => sessionStorage.getItem('maab-booking-google-draft')), null);
  await capture(booking.page, 'booking-resumed-390');

  for (const width of [320, 1440]) {
    const signedOut = await contextFor({ subject: 'not-used' }, { width, height: 900 });
    await signedOut.page.goto(server.baseUrl + '/portal');
    await capture(signedOut.page, `portal-${width}`);
    await parent.page.setViewportSize({ width, height: 900 });
    await parent.page.goto(server.baseUrl + '/app/parent');
    await parent.page.getByRole('button', { name: 'הזמנה בוואטסאפ', exact: true }).waitFor();
    await capture(parent.page, `parent-${width}`);
  }
  assert.deepEqual(errors, []);
  const db = new DatabaseSync(server.dbPath);
  try {
    assert.equal(db.prepare('SELECT count(*) AS n FROM students_v2').get().n, 3, 'one invited child, one independent learner, one new parent child');
  } finally { db.close(); }
  await writeFile(join(evidence, 'report.json'), JSON.stringify({ syntheticOnly: true, errors, journeys: ['parent Google', 'WhatsApp invitation', 'safe parent preview', 'child Google', 'returning child', 'independent signup', 'new parent signup', 'booking draft preserved'], widths: [320,390,1440] }, null, 2));
  console.log(JSON.stringify({ evidence, errors, passed: true }));
} catch (error) {
  for (const [i, context] of contexts.entries()) for (const page of context.pages()) {
    console.log('failed page', i, page.url(), (await page.locator('body').innerText()).slice(0,800));
    await page.screenshot({ path: join(evidence, `failure-${i}.png`), fullPage: true }).catch(() => {});
  }
  throw error;
} finally { await browser.close(); await server.stop(); }
