// Run after npm run build. Every record lives in this harness's disposable ledger.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { startServer, login } from '../characterization/harness.mjs';

const server = await startServer();
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : chromium.executablePath()), headless: true });
const evidence = process.env.EVIDENCE_DIR ?? join(tmpdir(), 'meabeclick-tutor-payments');
await mkdir(evidence, { recursive: true });
const report = { syntheticOnly: true, errors: [], viewports: [] };

try {
  const cookie = await login(server.baseUrl);
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
  async function post(path, body) {
    const response = await fetch(server.baseUrl + path, { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal(response.status, 200, `${path}: ${await response.clone().text()}`);
    return response.json();
  }
  async function ledger(code) {
    const response = await fetch(`${server.baseUrl}/api/payments?student=${code}`, { headers });
    assert.equal(response.status, 200);
    return (await response.json()).charges;
  }
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const [name, ...value] = cookie.split('=');
  await context.addCookies([{ name, value: value.join('='), url: server.baseUrl }]);
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));

  for (const width of [390, 1440]) {
    const code = `payment-ui-${width}`;
    await post('/api/students', { code, name: `תלמיד תשלומים לדוגמה ${width}`, subject: 'מתמטיקה', email: `${code}@example.test` });
    const fixture = [
      { date: '2026-11-01', status: 'owed' },
      { date: '2026-11-02', status: 'owed' },
      { date: '2026-11-03', status: 'paid' },
      { date: '2026-11-05', status: 'void' },
      { date: '2099-01-01', status: 'owed' },
    ];
    for (const charge of fixture) {
      const { id } = await post('/api/payments', { studentCode: code, date: charge.date, kind: 'single', amountAgorot: 11111, paid: charge.status === 'paid', note: 'בדיקת ממשק סינתטית' });
      charge.id = id;
      if (charge.status === 'void') await post('/api/payments/mark', { ids: [id], status: 'void' });
    }
    const url = `${server.baseUrl}/app/students/${code}?tab=payments`;
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const table = page.getByRole('table', { name: 'חיובים ותשלומים', exact: true });
    const ready = async () => {
      await table.waitFor();
      await page.waitForFunction(() => document.querySelector('fieldset.ledger')?.disabled === false);
    };
    await page.goto(url);
    await ready();
    assert.deepEqual(await table.getByRole('columnheader').allTextContents(), ['בחירה', 'תאריך', 'סוג', 'סכום', 'מצב', 'פעולות']);
    for (const heading of await table.getByRole('columnheader').all()) {
      assert.equal(await heading.isVisible(), true, `table heading remains visible at ${width}`);
      assert.equal(await heading.evaluate(el => getComputedStyle(el).display), 'table-cell');
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `page fits ${width}px viewport`);
    const region = page.getByRole('region', { name: 'טבלת חיובים ותשלומים — ניתן לגלול אופקית', exact: true });
    assert.equal(await region.getAttribute('tabindex'), '0', 'horizontal table is keyboard focusable');
    const overflow = await region.evaluate(el => ({ width: el.clientWidth, contents: el.scrollWidth }));
    if (width === 390) assert.ok(overflow.contents > overflow.width, 'mobile keeps the table in its own scroll container');
    const checkbox = table.getByRole('checkbox').first();
    const geometry = await checkbox.evaluate(el => {
      const box = el.getBoundingClientRect(), label = el.closest('label').getBoundingClientRect();
      return { boxWidth: box.width, boxHeight: box.height, targetWidth: label.width, targetHeight: label.height };
    });
    assert.equal(geometry.boxWidth, 18);
    assert.equal(geometry.boxHeight, 18);
    assert.ok(geometry.targetWidth >= 44 && geometry.targetHeight >= 44);
    await checkbox.locator('..').click({ position: { x: 3, y: 22 } });
    assert.equal(await checkbox.isChecked(), true, 'clicking the label outside the visible box selects the charge');
    await checkbox.uncheck();
    const dates = () => table.locator('tbody tr td:nth-child(2)').allTextContents();
    assert.deepEqual(await dates(), ['01/01/2099', '05/11/2026', '03/11/2026', '02/11/2026', '01/11/2026']);
    const ordering = page.getByLabel('סדר תאריכים');
    await ordering.selectOption('oldest');
    assert.deepEqual(await dates(), ['01/11/2026', '02/11/2026', '03/11/2026', '05/11/2026', '01/01/2099']);
    assert.equal(await table.getByRole('columnheader', { name: 'תאריך', exact: true }).getAttribute('aria-sort'), 'ascending');
    await ordering.selectOption('newest');
    const filter = page.getByLabel('הצגת תשלומים');
    await filter.selectOption('paid');
    assert.deepEqual(await dates(), ['03/11/2026']);
    await filter.selectOption('owed');
    assert.deepEqual(await dates(), ['01/01/2099', '02/11/2026', '01/11/2026'], 'unpaid includes future charges, excluding void rows');
    await filter.selectOption('all');
    const row = date => table.locator('tbody tr').filter({ hasText: date });
    assert.equal(await row('05/11/2026').getByRole('button').count(), 0, 'void records have no row actions');
    await region.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(evidence, `payments-${width}.png`) });
    const actionsHeading = table.getByRole('columnheader', { name: 'פעולות', exact: true });
    await actionsHeading.scrollIntoViewIfNeeded();
    const actionBounds = await actionsHeading.boundingBox(), regionBounds = await region.boundingBox();
    assert.ok(actionBounds.x >= regionBounds.x && actionBounds.x + actionBounds.width <= regionBounds.x + regionBounds.width, 'the actions column can be brought fully into the scroll region');
    if (width === 390) await page.screenshot({ path: join(evidence, 'payments-actions-390.png') });

    const singleUpdate = page.waitForResponse(response => response.url().endsWith('/api/payments/mark') && response.request().method() === 'POST');
    await row('01/11/2026').getByRole('button', { name: 'סמן כשולם', exact: true }).click();
    assert.equal((await singleUpdate).status(), 200);
    await ready();
    assert.equal((await ledger(code)).find(charge => charge.id === fixture[0].id).status, 'paid');
    await page.reload();
    await ready();
    assert.equal(await row('01/11/2026').getByRole('button', { name: 'סמן כלא שולם', exact: true }).count(), 1, 'row update survives reload');

    await row('02/11/2026').getByRole('checkbox').check();
    await row('03/11/2026').getByRole('checkbox').check();
    await filter.selectOption('paid');
    const selection = page.locator('.selection-summary');
    assert.match(await selection.textContent(), /נבחרו 2 חיובים.*מתוכם 1 מוסתרים בסינון/s);
    assert.equal(await table.getByRole('checkbox', { checked: true }).count(), 1);
    await selection.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(evidence, `payments-hidden-selection-${width}.png`) });
    const bulkUpdate = page.waitForResponse(response => response.url().endsWith('/api/payments/mark') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'סימון הנבחרים כשולם', exact: true }).click();
    const bulkResponse = await bulkUpdate;
    assert.equal(bulkResponse.status(), 200);
    assert.deepEqual(bulkResponse.request().postDataJSON(), { ids: [fixture[1].id, fixture[2].id], status: 'paid' }, 'bulk update includes exactly the explicitly selected visible and hidden charges');
    await ready();
    assert.match(await selection.textContent(), /נבחרו 0 חיובים/);
    assert.equal(await page.getByRole('button', { name: 'סימון הנבחרים כשולם', exact: true }).isDisabled(), true);
    const expected = new Map(fixture.map(charge => [charge.id, charge.status]));
    expected.set(fixture[0].id, 'paid');
    expected.set(fixture[1].id, 'paid');
    assert.deepEqual(new Map((await ledger(code)).map(charge => [charge.id, charge.status])), expected, 'only chosen charges changed; future owed and void records remain intact');
    await page.reload();
    await ready();
    assert.equal(await row('02/11/2026').getByRole('button', { name: 'סמן כלא שולם', exact: true }).count(), 1, 'bulk update survives reload');
    report.viewports.push({ width, geometry, overflow, checks: ['semantic headers', 'compact checkbox and large label', 'both date orders', 'paid/unpaid filters', 'void row actions absent', 'single update persisted', 'hidden selection included in exact bulk payload', 'bulk persisted without changing other charges'] });
  }
  assert.deepEqual(report.errors, []);
  await writeFile(join(evidence, 'payments.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ evidence, ...report }));
} finally {
  await browser.close();
  await server.stop();
}
