// Filing a report is the one write in the product that records a judgement
// about a child from outside the plan page, so these pin who may do it and
// what a malformed one does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, login, familySession } from './harness.mjs';

const book = (baseUrl, over = {}) => fetch(`${baseUrl}/api/book`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'יובל כהן', subject: 'מתמטיקה', level: 'כיתה יא',
    phone: '0501234567', email: 'orit@example.com', durationMin: 90,
    start: '2027-03-15T10:00:00+02:00', end: '2027-03-15T11:30:00+02:00',
    ...over,
  }),
}).then(r => r.json());

const post = (url, body, cookie) => fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  body: JSON.stringify(body),
});

/** A child's own session, which is what /app/student serves — a parent's
 *  account-level session is redirected to /app/parent instead. Mirrors
 *  sign-out.test.mjs's studentSession helper. */
async function studentSession(baseUrl, parentCookie, code) {
  const share = await (await fetch(`${baseUrl}/api/student-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: parentCookie },
    body: JSON.stringify({ code }),
  })).json();
  return familySession(share.link);
}

/** Books a lesson IN THE PAST (so it is reportable), creates a plan, and
 *  returns the ids the tests need. The booking API refuses a past slot, so
 *  the row is aged with a direct UPDATE through the test's own DB path. */
async function pastLesson(baseUrl, dbPath) {
  const booked = await book(baseUrl);
  const cookie = await login(baseUrl);
  const created = await (await post(`${baseUrl}/api/plans`, {
    code: booked.portal.code, subject: 'מתמטיקה', templateId: 'math-5u', goal: 'בגרות',
  }, cookie)).json();

  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbPath);
  db.prepare(`UPDATE bookings_v2 SET start = '2026-01-05T10:00:00.000Z', "end" = '2026-01-05T11:30:00.000Z'`).run();
  const bookingId = Number(db.prepare(`SELECT id FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get().id);
  db.close();

  const skill = created.tree[0].branches[0].skills[0];
  return { booked, cookie, bookingId, skill, planId: created.plan.id };
}

/** Books a lesson in the past with NO enrollment on it at all — migration
 *  006's shape for a student with more than one subject, where the booking
 *  cannot be resolved to one enrollment. */
async function pastLessonWithNoEnrollment(baseUrl, dbPath) {
  const booked = await book(baseUrl);
  const cookie = await login(baseUrl);

  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbPath);
  db.prepare(`UPDATE bookings_v2 SET start = '2026-01-05T10:00:00.000Z', "end" = '2026-01-05T11:30:00.000Z', enrollment_id = NULL`).run();
  const bookingId = Number(db.prepare(`SELECT id FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get().id);
  db.close();

  return { booked, cookie, bookingId };
}

test('the tutor files a report and the plan moves', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const { cookie, bookingId, skill } = await pastLesson(baseUrl, dbPath);
    const res = await post(`${baseUrl}/api/reports`, {
      bookingId, note: 'נתקעה בשברים', entries: [{ nodeId: skill.id, status: 'guided' }],
    }, cookie);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.report.note, 'נתקעה בשברים');
    assert.equal(body.tree[0].branches[0].skills[0].status, 'guided');
    const written = body.events.filter(e => e.type === 'status');
    assert.equal(written.length, 1);
    assert.equal(written[0].source, 'report');
  } finally { await stop(); }
});

test('a note-only report is accepted', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const { cookie, bookingId } = await pastLesson(baseUrl, dbPath);
    const res = await post(`${baseUrl}/api/reports`, { bookingId, note: 'שיחה בלבד', entries: [] }, cookie);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).report.note, 'שיחה בלבד');
  } finally { await stop(); }
});

test('a note-only report on an enrollment-less booking succeeds (item 1)', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const { cookie, bookingId } = await pastLessonWithNoEnrollment(baseUrl, dbPath);
    const res = await post(`${baseUrl}/api/reports`, { bookingId, note: 'שיחה בלבד', entries: [] }, cookie);
    assert.equal(res.status, 200, 'a note-only report must land, not 500');
    assert.equal((await res.json()).report.note, 'שיחה בלבד');
  } finally { await stop(); }
});

test('the same enrollment-less booking with an entry is a 400, never a 500', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const { cookie, bookingId } = await pastLessonWithNoEnrollment(baseUrl, dbPath);
    const res = await post(`${baseUrl}/api/reports`, {
      bookingId, note: null, entries: [{ nodeId: 1, status: 'guided' }],
    }, cookie);
    assert.equal(res.status, 400, 'no plan exists to validate the entry against');
    const body = await res.json();
    assert.doesNotMatch(JSON.stringify(body), new RegExp(String(bookingId)), 'the booking id must not leak into the response');
  } finally { await stop(); }
});

test('a lesson that has not happened yet cannot be reported', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const booked = await book(baseUrl);
    const cookie = await login(baseUrl);
    await post(`${baseUrl}/api/plans`, {
      code: booked.portal.code, subject: 'מתמטיקה', templateId: 'math-5u', goal: 'בגרות',
    }, cookie);
    // The booking is in 2027 and was never aged.
    const res = await post(`${baseUrl}/api/reports`, { bookingId: 1, note: 'מוקדם מדי', entries: [] }, cookie);
    assert.equal(res.status, 400);
  } finally { await stop(); }
});

test('a lesson recorded with a non-UTC offset end can be reported once it has passed', async () => {
  // /api/book stores start/end with the client's original offset, not
  // normalized to UTC. A naive string comparison against `new
  // Date().toISOString()` (always "Z") reads an offset-formatted end as
  // still in the future whenever its digits happen to sort later — exactly
  // what a true instant a couple of hours ago, expressed in +03:00, does.
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const booked = await book(baseUrl);
    const cookie = await login(baseUrl);
    await post(`${baseUrl}/api/plans`, {
      code: booked.portal.code, subject: 'מתמטיקה', templateId: 'math-5u', goal: 'בגרות',
    }, cookie);

    const offsetIso = (d, offsetHours = 3) =>
      `${new Date(d.getTime() + offsetHours * 3600 * 1000).toISOString().replace('Z', '')}+${String(offsetHours).padStart(2, '0')}:00`;
    const trueEnd = new Date(Date.now() - 2 * 60 * 60 * 1000);   // 2h ago, truly
    const trueStart = new Date(trueEnd.getTime() - 90 * 60 * 1000);

    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    db.prepare(`UPDATE bookings_v2 SET start = ?, "end" = ?`).run(offsetIso(trueStart), offsetIso(trueEnd));
    const bookingId = Number(db.prepare(`SELECT id FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get().id);
    db.close();

    const res = await post(`${baseUrl}/api/reports`, { bookingId, note: 'הסתיים לפני שעתיים', entries: [] }, cookie);
    assert.equal(res.status, 200, 'a lesson that truly ended must not read as still in progress');
  } finally { await stop(); }
});

test('malformed entries are refused, and nothing is written', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const { cookie, bookingId, skill } = await pastLesson(baseUrl, dbPath);
    const url = `${baseUrl}/api/reports`;

    assert.equal((await post(url, { bookingId, entries: [{ nodeId: skill.id, status: 'mastered' }] }, cookie)).status, 400);
    assert.equal((await post(url, { bookingId, entries: [{ nodeId: skill.id }] }, cookie)).status, 400, 'a ticked skill with no status');
    assert.equal((await post(url, { bookingId, note: 'x'.repeat(2001), entries: [] }, cookie)).status, 400);
    assert.equal((await post(url, { bookingId: 999999, entries: [] }, cookie)).status, 404);
    assert.equal((await post(url, { bookingId, entries: [{ nodeId: 999999, status: 'guided' }] }, cookie)).status, 404);

    // After every refusal, the lesson is still unreported.
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM lesson_reports`).get().n, 0);
    db.close();
  } finally { await stop(); }
});

test("a node from another student's plan is refused", async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const mine = await pastLesson(baseUrl, dbPath);
    const theirs = await book(baseUrl, {
      name: 'דנה לוי', email: 'dana@example.com',
      start: '2027-03-17T10:00:00+02:00', end: '2027-03-17T11:30:00+02:00',
    });
    const other = await (await post(`${baseUrl}/api/plans`, {
      code: theirs.portal.code, subject: 'מתמטיקה', templateId: 'math-4u', goal: 'בגרות',
    }, mine.cookie)).json();
    const foreign = other.tree[0].branches[0].skills[0];

    const res = await post(`${baseUrl}/api/reports`, {
      bookingId: mine.bookingId, entries: [{ nodeId: foreign.id, status: 'guided' }],
    }, mine.cookie);
    assert.equal(res.status, 404, "one lesson's report may not move another student's plan");
  } finally { await stop(); }
});

test('filing is tutor-only', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const { booked, bookingId, cookie } = await pastLesson(baseUrl, dbPath);
    const family = await familySession(booked.portal.link);
    for (const who of [undefined, family]) {
      assert.equal((await post(`${baseUrl}/api/reports`, { bookingId, entries: [] }, who)).status, 401);
    }
    assert.equal((await post(`${baseUrl}/api/reports`, { bookingId, entries: [] }, cookie)).status, 200);
  } finally { await stop(); }
});

test('no report reaches the family', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const { booked, bookingId, cookie } = await pastLesson(baseUrl, dbPath);
    const family = await familySession(booked.portal.link);
    const filed = await post(`${baseUrl}/api/reports`, {
      bookingId, note: 'הערה פנימית', entries: [], expectedFiling: 0,
      coverage: { source: 'manual', topics: [
        { title: 'PRIVATE-REPORT-TOPIC', covered: true, comment: 'PRIVATE-REPORT-COMMENT' },
      ] },
    }, cookie);
    assert.equal(filed.status, 200);
    const student = await studentSession(baseUrl, family, booked.portal.code);

    for (const { url, session } of [
      { url: `${baseUrl}/api/portal/${booked.portal.code}?kind=parent`, session: family },
      { url: `${baseUrl}/api/portal/${booked.portal.code}?kind=student`, session: family },
      { url: `${baseUrl}/app/parent`, session: family },
      { url: `${baseUrl}/app/student?s=${booked.portal.code}`, session: student },
    ]) {
      const text = await (await fetch(url, { headers: { Cookie: session } })).text();
      assert.doesNotMatch(text, /הערה פנימית|PRIVATE-REPORT-(TOPIC|COMMENT)/, `${url} leaked private report data`);
    }
  } finally { await stop(); }
});

test('manual coverage re-filing rejects stale forms and keeps coverage tutor-only', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const { cookie, bookingId } = await pastLesson(baseUrl, dbPath);
    const url = `${baseUrl}/api/reports`;
    const report = { bookingId, expectedFiling: 0, entries: [],
      coverage: { source: 'manual', topics: [
        { title: 'חזקות', covered: false, comment: 'PRIVATE-COVERAGE-EXAMPLE' },
      ] },
    };
    assert.equal((await post(url, report, cookie)).status, 200);
    assert.equal((await post(url, report, cookie)).status, 409);
    assert.equal((await post(url, report)).status, 401);
    const pageUrl = `${baseUrl}/app/report/${bookingId}`;
    const tutor = await fetch(pageUrl, { headers: { Cookie: cookie } });
    assert.match(await tutor.text(), /PRIVATE-COVERAGE-EXAMPLE/);
    const publicPage = await fetch(pageUrl, { redirect: 'manual' });
    assert.equal(publicPage.status, 302);
    assert.doesNotMatch(await publicPage.text(), /PRIVATE-COVERAGE-EXAMPLE/);
  } finally { await stop(); }
});

test('filing a native report rechecks the displayed Drive version and preserves the filed version', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'report-drive-'));
  const workspacePath = join(dir, 'workspace.json');
  const slidesPath = join(dir, 'slides.json');
  const workspace = { version: 1, ownerEmail: 'owner@example.test', projectFolderId: 'project12345',
    learningFolderId: 'learning12345', spreadsheetId: 'spreadsheet12345', templatesFolderId: 'templates12345',
    libraryFolderId: 'library12345', studentsFolderId: 'students12345', reviewFolderId: 'review12345',
    studentProfileTemplateId: 'profile12345', lessonBriefTemplateId: 'brief12345' };
  const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  await writeFile(workspacePath, JSON.stringify(workspace));
  const { baseUrl, dbPath, stop } = await startServer({ fakeGoogle: true, env: {
    LEARNING_GOOGLE_CLIENT_ID: 'synthetic-learning-client', LEARNING_GOOGLE_CLIENT_SECRET: 'synthetic-learning-secret',
    LEARNING_GOOGLE_WORKSPACE_FILE: workspacePath, LEARNING_GOOGLE_TOKEN_KEY: 'ab'.repeat(32),
    FAKE_REPORT_SLIDES_FILE: slidesPath,
  } });
  try {
    const { bookingId, cookie, booked } = await pastLesson(baseUrl, dbPath);
    const connect = await fetch(baseUrl + '/app/library/connection?/connect', {
      method: 'POST', redirect: 'manual', headers: { Cookie: cookie, Origin: baseUrl, Accept: 'text/html' },
      body: new URLSearchParams(),
    });
    const state = new URL(connect.headers.get('location')).searchParams.get('state');
    const browser = connect.headers.getSetCookie()[0].split(';')[0];
    const complete = await fetch(baseUrl + '/auth/google/callback?' + new URLSearchParams({
      state, code: 'learning.synthetic-code', picked_file_ids: workspace.learningFolderId,
    }), { redirect: 'manual', headers: { Cookie: cookie + '; ' + browser } });
    assert.equal(complete.headers.get('location'), '/app/library/connection');

    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    try {
      const booking = db.prepare('SELECT * FROM bookings_v2 WHERE id=?').get(bookingId);
      const bundle = { objectives: [{ id: 'exponents', title: 'חזקות' }] };
      const version = sha(bundle);
      const receipt = { version: 1, state: 'draft', sourceHash: '9'.repeat(64),
        reviewFolderId: 'report-synthetic-folder', slides: { id: 'report-synthetic-slides' },
        homework: { id: 'report-synthetic-homework' }, notesLocation: 'slides',
        provenance: { bundleVersion: version } };
      const snapshot = { bookingId, studentId: booking.student_id, enrollmentId: booking.enrollment_id,
        start: booking.start, authored: { version, bundle } };
      db.prepare(`UPDATE native_lesson_jobs SET state='review', snapshot=?, bundle=?, approved_release_id=?
        WHERE booking_id=?`).run(JSON.stringify(snapshot), JSON.stringify(receipt), 'student-game-only', bookingId);
      const binding = sha([db.prepare('SELECT id FROM native_lesson_jobs WHERE booking_id=?').get(bookingId).id,
        bookingId, booking.student_id, booking.enrollment_id, booking.start, receipt]);
      const meta = { id: receipt.slides.id, name: 'מצגת בדיקה', modifiedTime: '2026-07-01T10:00:00Z',
        mimeType: 'application/vnd.google-apps.presentation', parents: [receipt.reviewFolderId],
        owners: [{ emailAddress: workspace.ownerEmail }], permissions: [{ type: 'user' }], trashed: false,
        appProperties: { meaCentralScope: sha(['meabeclick-central-v1', workspace.ownerEmail, workspace.learningFolderId]) } };
      const setVersion = version => writeFile(slidesPath, JSON.stringify({ ...meta, version }));
      const pagePath = baseUrl + '/app/report/' + bookingId;
      const url = baseUrl + '/api/reports';
      const body = { bookingId, expectedFiling: 0, entries: [], coverage: {
        source: 'native', selection: 'current', confirmed: true,
        token: sha([binding, '5']), topics: [{ objectiveId: 'exponents', covered: false, comment: 'PRIVATE-PIN-COMMENT' }],
      } };
      await setVersion('5');
      const reportPage = await fetch(pagePath, { headers: { Cookie: cookie } });
      const html = await reportPage.text();
      assert.equal(reportPage.status, 200);
      assert.match(html, /הגרסה הנוכחית של המצגת/);
      assert.ok(html.includes(body.coverage.token));
      assert.ok(!html.includes(receipt.homework.id));
      const family = await familySession(booked.portal.link);
      assert.equal((await post(url, body, family)).status, 401);
      assert.equal((await post(url, { ...body, coverage: { ...body.coverage, confirmed: false } }, cookie)).status, 409);
      await setVersion('6');
      assert.equal((await post(url, body, cookie)).status, 409);
      assert.equal((await post(url, { ...body, coverage: { ...body.coverage, token: 'student-game-only' } }, cookie)).status, 409);
      assert.equal(db.prepare('SELECT count(*) AS count FROM lesson_reports').get().count, 0);

      db.prepare('UPDATE native_lesson_jobs SET approved_release_id=NULL WHERE booking_id=?').run(bookingId);
      body.coverage.token = sha([binding, '6']);
      assert.equal((await post(url, body, cookie)).status, 200);
      const first = db.prepare('SELECT * FROM lesson_report_notes').get();
      assert.equal(JSON.parse(first.teaching_coverage).coverage.bundle.slides.version, '6');

      await setVersion('7');
      const correction = { ...body, expectedFiling: first.id,
        coverage: { ...body.coverage, selection: 'saved', confirmed: false } };
      assert.equal((await post(url, correction, cookie)).status, 200);
      assert.deepEqual(db.prepare('SELECT teaching_coverage FROM lesson_report_notes ORDER BY id').all()
        .map(row => JSON.parse(row.teaching_coverage).coverage.bundle.slides.version), ['6', '6']);
      const familyView = await fetch(baseUrl + '/app/parent', { headers: { Cookie: family } });
      assert.doesNotMatch(await familyView.text(), /PRIVATE-PIN-COMMENT|report-synthetic-slides/);
    } finally { db.close(); }
  } finally {
    await stop();
    await rm(dir, { recursive: true, force: true });
  }
});
