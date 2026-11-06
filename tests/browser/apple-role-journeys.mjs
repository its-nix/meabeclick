import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHmac } from 'node:crypto';
import { seedLearning } from '../characterization/learning-fixture.mjs';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright-core';
import { startServer, login, familySession } from '../characterization/harness.mjs';

const baseline = process.env.BASELINE === '1';
const evidence = process.env.EVIDENCE_DIR ?? join(tmpdir(), `meabeclick-apple-${baseline ? 'before' : 'after'}`);
await mkdir(evidence, { recursive: true });
const server = await startServer({ env: { GOOGLE_WEB_CLIENT_ID: 'synthetic-client.example', GOOGLE_WEB_CLIENT_SECRET: 'synthetic-secret' } });
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : chromium.executablePath()), headless: true });
const report = { syntheticOnly: true, baseline, pages: [], errors: [], contrast: [] };
const book = async (name, day, cookie) => {
  const response = await fetch(server.baseUrl + '/api/book', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify({ name, email: 'apple-ui@example.test', phone: '0501234567', subject: 'מתמטיקה', level: 'כיתה ט', durationMin: 90, mode: 'online', start: `2028-01-${day}T08:00:00.000Z`, end: `2028-01-${day}T09:30:00.000Z` }) });
  assert.equal(response.status, 200); return response.json();
};
const portal = {
  name: 'נועה לדוגמה', emoji: '🎓', subject: 'מתמטיקה', level: 'כיתה ט', tutor: 'מורה לדוגמה', updated: '2026-11-06',
  nextLesson: { date: '2028-01-10', time: '10:00', type: 'כפול' },
  progress: { kind: 'skills', done: 3, total: 8, percent: 38, note: 'נועה פותרת משוואות בביטחון. נמשיך לתרגל העברת אגפים ופתרון בעיות מילוליות.', seen: { understood: [{ title: 'פתרון משוואה בצעד אחד', label: 'הובן בשיעור' }], covered: ['משוואות בשני צעדים'] } },
  balance: { dueAgorot: 21500, paidAgorot: 43000, upcomingAgorot: 21500, owedAgorot: 43000 },
  charges: [{ id: 1, date: '2026-11-04', kind: 'double', amount_agorot: 21500, status: 'owed' }, { id: 2, date: '2026-10-28', kind: 'double', amount_agorot: 21500, status: 'paid' }],
  lessons: [{ date: '2026-11-04', topic: 'משוואות בשני צעדים', summary: 'תרגלנו פתרון משוואות ובדיקה באמצעות הצבה.', upcoming: false }, { date: '2026-10-28', topic: 'משוואות בצעד אחד', summary: 'למדנו לבודד את הנעלם.', upcoming: false }],
  homework: [{ id: 101, task: 'פתרו את המשוואה x + 7 = 12 ובדקו את התשובה.', assigned: '2026-11-04', due: '2028-01-09', submitted: false, graded: false }, { id: 102, task: 'פתרו 3x = 18.', assigned: '2026-10-28', submitted: true, graded: true, grade: 'ok' }],
  learning: [{ slug: 'parabolas', title: 'מגלים פרבולות', url: '/learn/parabolas', solved: 2, total: 6 }], learningPreparation: [{ slug: 'preparation-example', title: 'לקראת השיעור הבא', url: '/learn/preparation-example', solved: 0, total: 3 }], games: [],
};
try {
  const first = await book('נועה לדוגמה', '10');
  const parent = await familySession(first.portal.link);
  const second = await book('איתי לדוגמה', '11', parent);
  const admin = await login(server.baseUrl);
  const plan = await fetch(server.baseUrl + '/api/plans', { method: 'POST', headers: { Cookie: admin, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: first.portal.code, subject: 'מתמטיקה', templateId: 'math-5u', goal: 'חיזוק הביטחון במתמטיקה' }) });
  assert.ok(plan.ok, await plan.text());
  const share = await (await fetch(server.baseUrl + '/api/student-link', { method: 'POST', headers: { Cookie: parent, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: first.portal.code }) })).json();
  const student = await familySession(share.link);
  const db = new DatabaseSync(server.dbPath);
  const studentRow = db.prepare('SELECT s.id, e.id AS enrollment FROM students_v2 s JOIN enrollments e ON e.student_id=s.id WHERE s.code=?').get(first.portal.code);
  const start = new Date(Date.now() - 86400000).toISOString();
  db.prepare('INSERT INTO bookings_v2 (student_id,enrollment_id,start,"end",duration,at,status) VALUES (?,?,?,?,90,?,\'confirmed\')').run(studentRow.id, studentRow.enrollment, start, new Date(Date.parse(start) + 5400000).toISOString(), start);
  db.prepare("INSERT OR REPLACE INTO engine_status (engine,kind,at) VALUES ('codex','engine-auth',?)").run(new Date().toISOString());
  const pastBooking = db.prepare('SELECT id FROM bookings_v2 ORDER BY id DESC LIMIT 1').get().id;
  await book('תלמיד נוסף לבדיקה', '12');
  const pending = db.prepare('SELECT id,expires_at FROM pending_bookings ORDER BY id DESC LIMIT 1').get();
  const payload = `p.${pending.id}.${Date.parse(pending.expires_at)}`;
  const confirmationToken = payload + '.' + createHmac('sha256', 'test-secret-not-a-real-one').update(payload).digest('base64url');
  db.close();
  const learning = await seedLearning(server, 'ui');
  const setup = await (await fetch(server.baseUrl + '/api/teachers/1/setup-link', { method: 'POST', headers: { Cookie: admin } })).json();
  const setupPath = new URL(setup.link).pathname;
  const gamesHtml = await (await fetch(server.baseUrl + '/app/games', { headers: { Cookie: admin } })).text();
  const gamePaths = [...new Set([...gamesHtml.matchAll(/href="([^" ]*\/app\/play\/[^" ]+)"/g)].map(match => match[1].replaceAll('&amp;', '&')))];
  for (const [role, cookie] of [['public', null], ['tutor', admin], ['parent', parent], ['student', student]]) {
    for (const appearance of baseline ? ['light'] : ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', colorScheme: appearance });
    await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: `@font-face{font-family:Heebo;src:url('${server.baseUrl}/learning-assets/heebo-hebrew.woff2') format('woff2');font-weight:100 900;font-display:swap;}@font-face{font-family:Heebo;src:url('${server.baseUrl}/learning-assets/heebo-latin.woff2') format('woff2');font-weight:100 900;unicode-range:U+0000-00FF;font-display:swap;}` }));
    if (cookie) { const [name, ...parts] = cookie.split('='); await context.addCookies([{ name, value: parts.join('='), url: server.baseUrl, httpOnly: true, sameSite: 'Lax' }]); }
    let portalMode = 'normal';
    let releasePortal;
    let portalGate = Promise.resolve();
    if (role === 'parent' || role === 'student') await context.route(`**/api/portal/${first.portal.code}*`, async route => {
      if (portalMode === 'pending') await portalGate;
      if (portalMode === 'failed') return route.fulfill({ status: 503, json: { error: 'synthetic failure' } });
      const content = portalMode === 'empty' ? { ...portal, lessons: [], homework: [], learning: [], learningPreparation: [], games: [], progress: { kind: 'none', done: 0, total: 0, percent: 0 } } : portal;
      return route.fulfill({ json: content });
    });
    const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message));
    const paths = role === 'public' ? ['/', '/booking', '/portal', '/login', '/privacy', '/terms', '/enter', '/not-a-page', `/confirm-booking?t=${encodeURIComponent(confirmationToken)}`, '/confirm-booking?t=invalid', setupPath, setupPath + '?e=denied', '/app/tutor-setup/invalid', '/app/tutor-setup/done', '/learn/parabolas'] : role === 'tutor' ? ['/app/dashboard', '/app/library', '/app/marketing', '/app/metrics', '/app/games', `/app/students/${first.portal.code}`, `/app/plan/${first.portal.code}`, `/app/plan/${second.portal.code}`, `/app/report/${pastBooking}`, `/app/lessons/${learning.slug}/edit`, `/app/lessons/${learning.slug}/experience`, `/app/lessons/${learning.slug}/presenter`, ...gamePaths] : role === 'parent' ? ['/app/parent', `/app/parent?s=${first.portal.code}`] : [`/app/student?s=${first.portal.code}`, `/app/student?s=${first.portal.code}&v=hw`, `/app/student?s=${first.portal.code}&v=games`, `/app/student?s=${first.portal.code}&v=ask`];
    for (const width of baseline ? [390, 1440, 320] : [390, 768, 1440, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      for (const path of paths) {
        await page.goto(server.baseUrl + path); await page.evaluate(() => document.fonts.ready);
        if (role === 'student') await page.locator('#app').waitFor();
        if (role === 'parent' && path.includes('?')) await page.locator('.student-header').waitFor();
        const geometry = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth, headings: [...document.querySelectorAll('h1,h2')].map(e => e.textContent) }));
        report.pages.push({ role, appearance, path, width, ...geometry });
        if (!baseline) {
          const issues = await page.evaluate(() => {
            const parse = color => { const n = color.match(/[\d.]+/g)?.map(Number); return n && n.length >= 3 ? [n[0], n[1], n[2], n[3] ?? 1] : null; };
            const mix = (front, back) => front.slice(0, 3).map((c, i) => c * front[3] + back[i] * (1 - front[3]));
            const light = rgb => rgb.map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((n, c, i) => n + c * [.2126, .7152, .0722][i], 0);
            const background = element => {
              const layers = []; let current = element;
              while (current) { const style = getComputedStyle(current); if (style.backgroundImage !== 'none') return null; layers.push(parse(style.backgroundColor)); current = current.parentElement; }
              return layers.reverse().reduce((bg, layer) => layer ? mix(layer, bg) : bg, matchMedia('(prefers-color-scheme: dark)').matches ? [17, 17, 19] : [255, 255, 255]);
            };
            const failures = [];
            for (const el of document.body.querySelectorAll('*')) {
              if (el.closest('svg, [aria-hidden="true"], [inert]') || ![...el.childNodes].some(node => node.nodeType === 3 && node.textContent.trim()) || !el.getClientRects().length) continue;
              const style = getComputedStyle(el);
              if (style.visibility === 'hidden' || +style.opacity < .95 || el.closest(':disabled')) continue;
              const bg = background(el), fg = parse(style.color); if (!bg || !fg) continue;
              const values = [light(mix(fg, bg)), light(bg)].sort((a, b) => b - a);
              const ratio = (values[0] + .05) / (values[1] + .05);
              const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && +style.fontWeight >= 700);
              if (ratio < (large ? 3 : 4.5) - .05) failures.push({ text: el.textContent.trim().slice(0, 75), tag: el.tagName, class: el.className, ratio: Math.round(ratio * 100) / 100, color: style.color, background: bg });
            }
            return failures.slice(0, 12);
          });
          if (issues.length) report.contrast.push({ role, appearance, path, width, issues });
        }
        if (!baseline) assert.ok(geometry.width <= geometry.viewport, `${role} ${path} overflow at ${width}`);
        const key = role + '-' + (path.split('?')[0].replaceAll('/', '-').slice(1) || 'landing') + (path.includes('v=') ? '-' + path.split('v=')[1] : path.includes('?') ? '-selected' : '');
        await page.screenshot({ path: join(evidence, `${key}-${appearance}-${width}.png`), fullPage: false });
      }
    }
    if (!baseline) {
      await page.setViewportSize({ width: 390, height: 844 });
      if (role === 'public') {
        await page.goto(server.baseUrl + '/');
        const trigger = page.getByRole('button', { name: 'הכירו את ניקול', exact: true });
        await trigger.focus(); await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog'); await dialog.waitFor();
        const bounds = await dialog.boundingBox(); assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 390);
        await page.screenshot({ path: join(evidence, `tutor-bio-${appearance}.png`) });
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
        assert.equal(await trigger.evaluate(el => document.activeElement === el), true);
      }
      if (role === 'tutor') {
        await page.goto(server.baseUrl + '/app/dashboard');
        await page.getByRole('searchbox', { name: 'חיפוש תלמידים' }).fill('נועה');
        assert.equal(await page.locator('.roster-table tbody tr').count(), 1);
        await page.getByRole('searchbox', { name: 'חיפוש תלמידים' }).fill('אין תלמיד כזה');
        await page.getByText('לא נמצאו תלמידים בחיפוש הזה.', { exact: true }).waitFor();
        await page.goto(server.baseUrl + `/app/plan/${first.portal.code}`);
        const activities = page.getByRole('button', { name: 'משחקים ותרגולים עבור מתמטיקה', exact: true });
        await activities.click();
        const drawer = page.getByRole('complementary', { name: 'פעילויות עבור מתמטיקה', exact: true });
        await drawer.waitFor();
        assert.equal(await drawer.evaluate(el => document.activeElement === el), true, 'the phone activity drawer receives focus');
        const drawerBounds = await drawer.boundingBox();
        const navBounds = await page.getByRole('navigation', { name: 'ניווט ראשי', exact: true }).boundingBox();
        await page.screenshot({ path: join(evidence, `plan-activities-${appearance}.png`) });
        assert.ok(drawerBounds.y >= 64 && drawerBounds.y + drawerBounds.height <= navBounds.y, `the activity drawer stays between the header and phone navigation: ${JSON.stringify({ drawerBounds, navBounds })}`);
        await page.getByRole('button', { name: 'סגירת חלונית', exact: true }).click();
        assert.equal(await activities.evaluate(el => document.activeElement === el), true, 'closing the drawer restores focus');
      }
      if (role === 'parent') {
        await page.goto(server.baseUrl + `/app/parent?s=${first.portal.code}`); await page.locator('.student-header').waitFor();
        const nav = page.getByRole('navigation', { name: 'ניווט ראשי', exact: true });
        await nav.getByRole('button', { name: 'למידה', exact: true }).click();
        await page.getByRole('heading', { name: 'יומן שיעורים', exact: true }).waitFor();
        await nav.getByRole('button', { name: 'תשלומים', exact: true }).click();
        await page.getByRole('heading', { name: 'תשלומים', exact: true }).waitFor();
        await page.reload(); await page.locator('.student-header').waitFor();
        assert.equal(await page.getByRole('heading', { name: 'תשלומים', exact: true }).isVisible(), true);
        await page.screenshot({ path: join(evidence, `parent-payments-${appearance}.png`) });
        await nav.getByRole('button', { name: 'סקירה', exact: true }).click();
        await page.getByRole('heading', { name: 'השיעור הבא', exact: true }).waitFor();
      }
      if (role === 'student') {
        await page.goto(server.baseUrl + `/app/student?s=${first.portal.code}`); await page.locator('#app').waitFor();
        await page.getByText('לקראת השיעור', { exact: true }).click();
        assert.equal(await page.getByRole('link', { name: 'לקראת השיעור הבא', exact: false }).isVisible(), true, 'a single preparation link remains reachable alongside current practice');
        const nextAction = page.getByRole('link', { name: 'המשך תרגול', exact: false });
        assert.ok((await nextAction.boundingBox()).y < 600, 'the next learning action is visible on a phone');
        const nav = page.getByRole('navigation', { name: 'ניווט ראשי', exact: true });
        await nav.getByRole('button', { name: 'שיעורי בית', exact: true }).click();
        await page.getByRole('heading', { name: 'שיעורי הבית שלי', exact: true }).waitFor();
        await nav.getByRole('button', { name: 'משחקים', exact: true }).click();
        await page.goBack();
        await page.getByRole('heading', { name: 'שיעורי הבית שלי', exact: true }).waitFor();
      }
      if (role === 'student' || role === 'parent') {
        const destination = role === 'parent' ? `/app/parent?s=${first.portal.code}` : `/app/student?s=${first.portal.code}`;
        portalMode = 'failed'; await page.goto(server.baseUrl + destination);
        await page.getByText(role === 'parent' ? 'לא הצלחנו לטעון את הדף. נסו לרענן.' : 'לא הצלחתי לטעון את הדף.', { exact: false }).waitFor();
        assert.equal(await page.getByRole('navigation', { name: 'ניווט ראשי', exact: true }).isVisible(), true, 'navigation survives a failed load');
        assert.equal(await page.getByRole('button', { name: 'יציאה', exact: true }).isVisible(), true, 'account actions survive a failed load');
        await page.screenshot({ path: join(evidence, `${role}-failed-${appearance}.png`) });
        portalMode = 'normal'; await page.getByRole('button', { name: 'נסו שוב', exact: true }).click();
        await page.getByRole('heading', { level: 1 }).waitFor();
        portalMode = 'empty'; await page.reload();
        await page.getByText(role === 'parent' ? 'הכל מוכן, נועה לדוגמה רשום/ה' : 'הכל מוכן לשיעור הראשון', { exact: true }).waitFor();
        await page.screenshot({ path: join(evidence, `${role}-empty-${appearance}.png`) });
        portalMode = 'pending'; portalGate = new Promise(resolve => { releasePortal = resolve; }); await page.reload();
        await page.getByText('טוען…', { exact: true }).waitFor();
        assert.equal(await page.getByRole('navigation', { name: 'ניווט ראשי', exact: true }).isVisible(), true);
        portalMode = 'normal'; releasePortal();
        await page.getByRole('heading', { level: 1 }).waitFor();
      }
      if (role === 'student' || role === 'parent' || role === 'tutor') {
        const zoomPath = role === 'tutor' ? '/app/dashboard' : role === 'parent' ? `/app/parent?s=${first.portal.code}` : `/app/student?s=${first.portal.code}&v=hw`;
        await page.goto(server.baseUrl + zoomPath); await page.getByRole('heading', { level: 1 }).waitFor();
        await page.setViewportSize({ width: 320, height: 800 });
        await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
        await page.waitForFunction(() => {
          const nav = document.querySelector('.bottom-nav');
          return nav && Math.abs(parseFloat(document.body.style.getPropertyValue('--bottom-nav-height')) - nav.getBoundingClientRect().height) < 1;
        });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const lastNavItem = page.getByRole('navigation', { name: 'ניווט ראשי', exact: true }).locator('button,a').last();
        assert.equal(await lastNavItem.evaluate(el => {
          const bounds = el.getBoundingClientRect();
          return document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)?.closest('.bottom-nav') === el.closest('.bottom-nav');
        }), true, `${role} navigation remains reachable with enlarged text`);
        await page.screenshot({ path: join(evidence, `${role}-text200-${appearance}.png`) });
        const zoomGeometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, overflow: [...document.querySelectorAll('body *')].filter(el => { const r = el.getBoundingClientRect(); return r.width && (r.left < -1 || r.right > innerWidth + 1); }).slice(0, 12).map(el => ({ tag: el.tagName, class: el.className, text: el.textContent.slice(0,80), box: el.getBoundingClientRect().toJSON() })) }));
        assert.ok(zoomGeometry.scrollWidth <= zoomGeometry.width, `${role} 200% text reflow: ${JSON.stringify(zoomGeometry)}`);
        if (role === 'parent') {
          const switcher = await page.getByRole('combobox', { name: 'בחירת תלמיד/ה', exact: true }).boundingBox();
          assert.ok(switcher.width >= 128, 'the parent child switcher retains readable space with enlarged text');
        }
        await page.screenshot({ path: join(evidence, `${role}-text200-${appearance}.png`) });
        await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
      }
      if (role === 'student' || role === 'parent') {
        await page.route('**/api/family', route => route.fulfill({ status: 503 }));
        await page.getByRole('button', { name: 'יציאה', exact: true }).click();
        await page.getByRole('alert').filter({ hasText: 'לא הצלחנו לצאת' }).waitFor();
        assert.match(page.url(), /\/app\//, 'failed logout keeps the current session screen visible');
      }
    }
    await context.close();
    }
  }
  await writeFile(join(evidence, 'report.json'), JSON.stringify(report, null, 2));
  assert.deepEqual(report.errors, []);
  assert.equal(report.contrast.length, 0, `text contrast failures: ${JSON.stringify(report.contrast.slice(0, 3))}`);
  console.log(JSON.stringify({ evidence, syntheticOnly: true, baseline, pages: report.pages.length, errors: report.errors, contrastPages: report.contrast.length }));
} finally { await browser.close(); await server.stop(); }
