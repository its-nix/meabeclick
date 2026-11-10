import { test, expect } from './fixtures.mjs';

const profilePath = qa => `/app/students/${qa.learner.code}`;
const studentPath = qa => `/app/student?s=${qa.learner.code}`;
const parentPath = qa => `/app/parent?s=${qa.learner.code}`;
async function homework(qa, task = 'פתרו שלושה תרגילים') {
  const response = await qa.request(`/api/students/${qa.learner.code}/activity`, {
    method: 'POST', json: { kind: 'homework', task, date: '2026-11-05' },
  });
  expect(response.status).toBe(200);
}

test('roles-smoke: anonymous guards and three authenticated dashboards', async ({ qa }) => {
  const anonymous = await qa.page('anonymous');
  await anonymous.goto('/app/dashboard');
  await expect(anonymous).toHaveURL(/\/login/);
  for (const [role, path, heading] of [
    ['tutor', '/app/dashboard', null], ['parent', parentPath(qa), 'תלמיד בדיקה qa'], ['student', studentPath(qa), 'היום שלי'],
  ]) {
    const page = await qa.page(role);
    const response = await page.goto(path);
    expect(response.status()).toBe(200);
    await expect(page.getByRole('heading', heading ? { name: heading, exact: true } : { level: 1 }).first()).toBeVisible();
    await qa.evidence(page, role);
    await page.getByRole('button', { name: role === 'tutor' ? 'יציאה מהחשבון' : 'יציאה', exact: true }).click();
    await expect(page).toHaveURL(qa.browserUrl + '/');
    await page.waitForLoadState('load');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.goto(path);
    await expect(page).toHaveURL(role === 'tutor' ? /\/login/ : /\/portal/);
  }
});

test('public-booking: plan keyboard navigation and availability failure recovery', async ({ qa }) => {
  const page = await qa.page('anonymous');
  await page.goto('/booking');
  const options = page.getByRole('radio');
  await options.first().click();
  await page.keyboard.press('ArrowLeft');
  await expect(options.nth(1)).toBeFocused();
  let failed = false;
  await page.route('**/api/availability?**', route => {
    if (!failed) { failed = true; return route.fulfill({ status: 503, json: { error: 'synthetic outage' } }); }
    return route.continue();
  });
  await page.getByRole('button', { name: /^המשך עם/ }).click();
  await expect(page.getByRole('button', { name: /ניסיון נוסף|נסו שוב/ })).toBeVisible();
  await page.getByRole('button', { name: /ניסיון נוסף|נסו שוב/ }).click();
  await expect(page.locator('.slot').first()).toBeVisible();
  await page.locator('.slot').first().click();
  await expect(page.locator('#inp-name')).toBeVisible();
  await qa.evidence(page, 'booking-details');
  for (const path of ['/privacy', '/terms']) {
    expect((await page.goto(path)).status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
});

test('tutor-create: failed create preserves draft and retry persists one student', async ({ qa }) => {
  const page = await qa.page('tutor');
  await page.goto('/app/dashboard');
  await page.getByRole('button', { name: /תלמיד חדש|תלמיד\/ה חדש\/ה/ }).click();
  const dialog = page.getByRole('dialog', { name: 'הוספת תלמיד/ה' });
  await dialog.locator('#ns-name').fill('תלמיד רגרסיה');
  let failed = false;
  await page.route('**/api/students', route => {
    if (route.request().method() === 'POST' && !failed) {
      failed = true; return route.fulfill({ status: 503, json: { error: 'כשל בדיקה זמני' } });
    }
    return route.continue();
  });
  await dialog.getByRole('button', { name: 'הוספת תלמיד/ה', exact: true }).click();
  await expect(dialog.getByText('כשל בדיקה זמני')).toBeVisible();
  await expect(dialog.locator('#ns-name')).toHaveValue('תלמיד רגרסיה');
  await dialog.getByRole('button', { name: 'הוספת תלמיד/ה', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(page.locator('.roster-table').getByRole('link', { name: 'תלמיד רגרסיה', exact: true })).toBeVisible();
  expect(qa.row('SELECT count(*) n FROM students_v2 WHERE name=?', 'תלמיד רגרסיה').n).toBe(1);
  await qa.evidence(page, 'student-created');
});

test('tutor-profile: failed save retains draft then retry survives reload', async ({ qa }) => {
  const page = await qa.page('tutor');
  await page.goto(profilePath(qa) + '?tab=profile');
  const goals = page.locator(`[id="pf-goals-${qa.learner.code}"]`);
  await expect(goals).toBeVisible();
  let failed = false;
  await page.route(`**/api/students/${qa.learner.code}`, route => {
    if (route.request().method() === 'PATCH' && !failed) {
      failed = true; return route.fulfill({ status: 503, json: { error: 'כשל שמירה זמני' } });
    }
    return route.continue();
  });
  await goals.fill('שליטה בפרבולות');
  await goals.press('Tab');
  await expect(page.getByRole('button', { name: 'ניסיון שמירה נוסף', exact: true })).toBeVisible();
  await expect(goals).toHaveValue('שליטה בפרבולות');
  const saved = page.waitForResponse(response => response.url().endsWith(`/api/students/${qa.learner.code}`) && response.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'ניסיון שמירה נוסף', exact: true }).click();
  expect((await saved).status()).toBe(200);
  // Reading SQLite before the response can contend with the app's write.
  expect(qa.row('SELECT goals FROM students_v2 WHERE code=?', qa.learner.code).goals).toBe('שליטה בפרבולות');
  await page.reload();
  await expect(goals).toHaveValue('שליטה בפרבולות');
  await qa.evidence(page, 'profile-saved');
});

test('homework-publish: teacher assignment reaches student and parent after reload', async ({ qa }) => {
  const page = await qa.page('tutor');
  await page.goto(profilePath(qa) + '?tab=homework');
  await page.getByRole('button', { name: '+ הוסף שיעור בית', exact: true }).click();
  await page.locator(`[id="hf-task-${qa.learner.code}"]`).fill('תרגיל רגרסיה חדש');
  await page.locator('.sc-panel.active').getByRole('button', { name: 'שמור', exact: true }).click();
  await expect(page.locator('.hw-task').getByText('תרגיל רגרסיה חדש', { exact: true })).toBeVisible();
  for (const [role, path] of [['student', studentPath(qa) + '&v=hw'], ['parent', parentPath(qa) + '&v=progress']]) {
    const family = await qa.page(role);
    await family.goto(path);
    await expect(family.getByText('תרגיל רגרסיה חדש', { exact: true })).toBeVisible();
    await family.reload();
    await expect(family.getByText('תרגיל רגרסיה חדש', { exact: true })).toBeVisible();
    await qa.evidence(family, role + '-assignment');
  }
});

test('homework-submit: submission persists, reaches teacher and can be undone', async ({ qa }) => {
  await homework(qa);
  const page = await qa.page('student');
  await page.goto(studentPath(qa) + '&v=hw');
  const task = page.locator('.homework-card button[aria-pressed]').first();
  await expect(task).toHaveAttribute('aria-pressed', 'false');
  await task.click();
  await expect(task).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(task).toHaveAttribute('aria-pressed', 'true');
  const teacher = await qa.page('tutor');
  await teacher.goto(profilePath(qa) + '?tab=homework');
  await expect(teacher.getByRole('checkbox', { name: 'סימון הגשה: פתרו שלושה תרגילים', exact: true })).toBeChecked();
  await task.click();
  await expect(task).toHaveAttribute('aria-pressed', 'false');
  await teacher.reload();
  await expect(teacher.getByRole('checkbox', { name: 'סימון הגשה: פתרו שלושה תרגילים', exact: true })).not.toBeChecked();
  await qa.evidence(page, 'submission-undone');
});

test('parent-history: siblings, tab, reload and browser back preserve identity', async ({ qa }) => {
  const page = await qa.page('parent');
  await page.goto(parentPath(qa));
  await expect(page.getByRole('heading', { name: 'תלמיד בדיקה qa', exact: true })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'ניווט ראשי', exact: true });
  await nav.getByRole('button', { name: 'תשלומים', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'תשלומים', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'תשלומים', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'בחירת תלמיד/ה', exact: true }).selectOption(qa.sibling);
  await expect(page.getByRole('heading', { name: 'אחות בדיקה', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'תלמיד בדיקה qa', exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'אחות בדיקה', exact: true })).toBeVisible();
  await qa.evidence(page, 'sibling-forward');
});

test('permissions: student cannot read sibling, parent money or tutor data', async ({ qa }) => {
  for (const path of [
    `/api/portal/${qa.sibling}`, `/api/portal/${qa.outsider}`, `/api/portal/${qa.learner.code}?kind=parent`,
    '/api/students', `/api/payments?student=${qa.learner.code}`,
  ]) {
    const r = await qa.request(path, { cookie: qa.cookies.student });
    expect([401, 403], path).toContain(r.status);
  }
  const page = await qa.page('student');
  await page.goto('/app/parent');
  await expect(page).toHaveURL(/\/app\/student/);
  await expect(page.getByRole('heading', { name: 'היום שלי', exact: true })).toBeVisible();
  await page.goto(`/app/student?s=${qa.sibling}`);
  await expect(page.getByRole('heading', { name: 'אחות בדיקה', exact: true })).toHaveCount(0);
  // Session invalidation intentionally interrupts the next request, not a
  // CSS preload still belonging to the preceding navigation (WebKit).
  await page.waitForLoadState('networkidle');
  await page.context().clearCookies();
  await page.reload();
  await expect(page).toHaveURL(/\/portal/);
  await qa.evidence(page, 'expired-session');
});

test('invitations: WhatsApp link previews safely and redeems only once', async ({ qa }) => {
  const parent = await qa.page('parent');
  await parent.goto(parentPath(qa));
  await parent.getByRole('button', { name: 'הזמנה בוואטסאפ', exact: true }).click();
  const share = parent.getByRole('link', { name: 'שליחה בוואטסאפ', exact: true });
  await expect(share).toBeVisible();
  const text = new URL(await share.getAttribute('href')).searchParams.get('text');
  const invitation = text.match(/http[^\s]+\/enter#[^\s]+/)[0];
  await parent.goto(invitation);
  await expect(parent.getByRole('link', { name: 'צפייה בלוח התלמיד/ה', exact: true })).toBeVisible();
  const child = await qa.page('anonymous');
  await child.goto(invitation);
  await child.getByRole('button', { name: 'כניסה לדף האישי', exact: true }).click();
  await expect(child).toHaveURL(/\/app\/student/);
  await expect(child.getByRole('heading', { name: 'היום שלי', exact: true })).toBeVisible();
  const replay = await qa.page('anonymous');
  await replay.goto(invitation);
  await expect(replay.getByRole('alert')).toContainText('לא תקף');
  await qa.evidence(replay, 'replayed-invitation');
});

test('payments: teacher marks debt paid and parent balance follows persisted data', async ({ qa }) => {
  expect((await qa.request('/api/payments', { method: 'POST', json: {
    studentCode: qa.learner.code, date: '2026-01-02', amountAgorot: 12000, kind: 'single', paid: false,
  } })).status).toBe(200);
  const balance = async () => (await (await qa.request(`/api/portal/${qa.learner.code}?kind=parent`, { cookie: qa.cookies.parent })).json()).balance.dueAgorot;
  expect(await balance()).toBe(12000);
  const parent = await qa.page('parent');
  await parent.goto(parentPath(qa) + '&v=payments');
  await expect(parent.locator('.pay-sum-card.pending .psc-amount')).toHaveText('₪120');
  await expect(parent.locator('.pay-sum-card.paid .psc-amount')).toHaveText('₪0');
  const tutor = await qa.page('tutor');
  await tutor.goto(profilePath(qa) + '?tab=payments');
  await tutor.locator('.payments-table tbody tr').filter({ hasText: '2026' }).getByRole('button', { name: 'סמן כשולם', exact: true }).click();
  await expect.poll(balance).toBe(0);
  await tutor.reload();
  await expect(tutor.getByRole('button', { name: 'סמן כלא שולם', exact: true })).toBeVisible();
  await parent.reload();
  await expect(parent.getByRole('heading', { name: 'תשלומים', exact: true })).toBeVisible();
  await expect(parent.locator('.pay-sum-card.pending .psc-amount')).toHaveText('₪0');
  await expect(parent.locator('.pay-sum-card.paid .psc-amount')).toHaveText('₪120');
  await qa.evidence(parent, 'parent-paid');
});

test('learning: wrong answer, correction and reload preserve independent progress', async ({ qa }) => {
  const page = await qa.page('student');
  await page.goto(`/app/learn/${qa.learner.slug}`);
  await expect(page.locator('[data-save-status]')).toContainText('נשמרת בדף האישי');
  await page.locator('[data-scene-link]').nth(5).click();
  await page.locator('[data-number-answer]').fill('100');
  await page.locator('[data-scene="independent"] [data-submit]').click();
  await expect(page.locator('[data-scene="independent"] [data-feedback]')).toHaveAttribute('data-kind', 'retry');
  await page.locator('[data-number-answer]').fill('4');
  await page.locator('[data-scene="independent"] [data-submit]').click();
  await expect(page.locator('[data-scene="independent"] [data-feedback]')).toHaveAttribute('data-kind', 'success');
  await expect.poll(async () => (await (await qa.request(`/api/learning/${qa.learner.slug}`, { cookie: qa.cookies.student })).json()).progress.independent?.solved).toBe(true);
  await page.reload();
  await expect(page.locator('[data-scene-link]').nth(5)).toHaveClass(/is-complete/);
  await qa.evidence(page, 'progress-reloaded');
});

test('workspace: library empty search recovers and tutor sections remain reachable', async ({ qa }) => {
  const page = await qa.page('tutor');
  await page.goto('/app/library');
  await page.locator('#library-search').fill('no-such-synthetic-skill');
  await expect(page.getByText('לא נמצאו חומרים שמתאימים למסננים.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'הצגת כל החומרים', exact: true }).click();
  await expect(page.locator('#library-search')).toHaveValue('');
  await qa.evidence(page, 'library-reset');
  for (const path of ['/app/marketing', '/app/metrics']) {
    expect((await page.goto(path)).status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  }
});
