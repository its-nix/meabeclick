// tests/unit/report-records-coverage.test.mjs
//
// Filing a report is how the system learns what was actually TAUGHT.
//
// Migration 011 added `covered` events — "this was taught, regardless of
// how it went" — and the plan page already renders «נלמד, טרם נבדק» from
// them. But nothing on the main path wrote one: addCoveredEvent was
// reachable only from the plan's own events API, a separate manual action
// the tutor has no reason to take after filing a report.
//
// So the fact the whole design rests on was never recorded. Todoist
// id:6hRhqRvfX7VHgh9q step 1 — "produce suggestions only from material
// actually taught" — is unreachable without it: the plan knows what was
// PLANNED, and only a report knows what happened.
//
// A report entry is the tutor saying she assessed that skill in that
// lesson, which means she taught or practised it. That is exactly what
// `covered` records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'report-cov-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const S = await import('../../src/lib/server/plans/store.ts');
const R = await import('../../src/lib/server/reports/store.ts');
const V = await import('../../src/lib/server/plans/view.ts');
const { handle } = await import('../../src/lib/server/db.ts');

const template = {
  id: 'demo', version: 1, subject: 'מתמטיקה', track: '5 יח״ל', reviewed: null,
  topics: [{
    key: 'calc', title: 'חשבון',
    branches: [{
      key: 'calc.r', title: 'כללי גזירה',
      skills: [
        { key: 'calc.r.a', title: 'חוקי חזקות', requires: [] },
        { key: 'calc.r.b', title: 'כלל המנה', requires: [] },
      ],
    }],
  }],
};

let seq = 0;
function fresh() {
  seq += 1;
  const account = E.createAccount({ name: `מ ${seq}`, phone: null, credential: 'x' });
  const student = E.createStudent({ code: `kid${seq}`, name: `ת ${seq}`, accountId: account.id, credential: 'x' });
  E.upsertEnrollment({ studentId: student.id, subject: 'מתמטיקה', level: 'כיתה יא', teacherId: null });
  const enrollment = E.enrollmentsForStudent(student.id)[0];
  const planId = S.createPlan({ studentId: student.id, enrollmentId: enrollment.id, template, goal: 'ב' });
  const nodes = S.planData(planId).nodes.filter(n => n.kind === 'skill');
  const past = new Date(Date.now() - 3 * 3600e3).toISOString();
  const b = handle().prepare(
    `INSERT INTO bookings_v2 (student_id, enrollment_id, start, "end", duration, at, status)
     VALUES (?, ?, ?, ?, 45, ?, 'confirmed')`
  ).run(student.id, enrollment.id, past, past, past);
  return { student, planId, nodes, bookingId: Number(b.lastInsertRowid) };
}

const coveredEvents = (planId, nodeId) =>
  S.planData(planId).events.filter(e => e.type === 'covered' && e.node_id === nodeId);

test('filing a report records that each reported skill was taught', () => {
  const { planId, nodes, bookingId } = fresh();
  R.fileReport({ bookingId, note: 'עברנו חזקות', entries: [{ nodeId: nodes[0].id, status: 'guided' }] });

  assert.equal(coveredEvents(planId, nodes[0].id).length, 1);
  assert.equal(coveredEvents(planId, nodes[1].id).length, 0, 'only what was reported');
});

test('coverage does not move the skill', () => {
  // The entire reason coverage is its own event type: a lesson that went
  // badly must not be recordable as progress.
  const { planId, nodes, bookingId } = fresh();
  R.fileReport({ bookingId, note: null, entries: [{ nodeId: nodes[0].id, status: 'started' }] });
  const { events } = S.planData(planId);
  assert.equal(V.currentStatus(events, nodes[0].id), 'started');
});

test('the covered event carries the report it came from', () => {
  const { planId, nodes, bookingId } = fresh();
  const reportId = R.fileReport({ bookingId, note: null, entries: [{ nodeId: nodes[0].id, status: 'guided' }] });
  assert.equal(coveredEvents(planId, nodes[0].id)[0].report_id, reportId,
    'so a correction can tell its own coverage apart from another lesson’s');
});

test('correcting a report does not record a second teaching', () => {
  // Re-filing is the SAME lesson. The status history appends — that is the
  // point of a correction — but the child was not taught it twice, and a
  // second covered row would say she was.
  const { planId, nodes, bookingId } = fresh();
  R.fileReport({ bookingId, note: null, entries: [{ nodeId: nodes[0].id, status: 'started' }] });
  R.fileReport({ bookingId, note: 'תיקון', entries: [{ nodeId: nodes[0].id, status: 'guided' }] });
  assert.equal(coveredEvents(planId, nodes[0].id).length, 1);
});

test('a note-only report records no coverage', () => {
  const { planId, nodes, bookingId } = fresh();
  R.fileReport({ bookingId, note: 'התלמידה לא הגיעה', entries: [] });
  assert.equal(coveredEvents(planId, nodes[0].id).length, 0);
  assert.equal(coveredEvents(planId, nodes[1].id).length, 0);
});

test('the plan shows a taught-but-unassessed skill as taught', () => {
  const { planId, nodes, bookingId } = fresh();
  R.fileReport({ bookingId, note: null, entries: [{ nodeId: nodes[0].id, status: 'started' }] });
  const { nodes: n, prereqs, events } = S.planData(planId);
  const skills = V.buildTree(n, prereqs, events, null).flatMap(t => t.branches).flatMap(b => b.skills);
  assert.ok(skills.find(s => s.id === nodes[0].id).coveredAt, 'coveredAt must now be set');
});

test('explicit zero coverage is recorded independently from a skill judgment', () => {
  const { planId, nodes, bookingId } = fresh();
  const reportId = R.fileReport({
    bookingId, note: null, entries: [{ nodeId: nodes[0].id, status: 'guided' }],
    expectedFiling: 0, coverage: { source: 'manual', topics: [] },
  });

  assert.deepEqual(R.coverageHistory(reportId).map(filing => filing.coverage), [
    { source: 'manual', topics: [] },
  ]);
  assert.equal(V.currentStatus(S.planData(planId).events, nodes[0].id), 'guided');
  assert.equal(coveredEvents(planId, nodes[0].id).length, 0);
});

test('explicit manual corrections keep the prior coverage and reject a stale form', () => {
  const { bookingId } = fresh();
  const input = { bookingId, entries: [] };
  const reportId = R.fileReport({ ...input, note: 'first', expectedFiling: 0,
    coverage: { source: 'manual', topics: [{ title: 'חזקות', covered: true, comment: 'פרטי' }] },
  });
  const [initial] = R.coverageHistory(reportId);
  R.fileReport({ ...input, note: 'correction', expectedFiling: initial.id,
    coverage: { source: 'manual', topics: [{ title: 'חזקות', covered: false, comment: null }] },
  });
  assert.throws(() => R.fileReport({ ...input, note: 'stale', expectedFiling: initial.id,
    coverage: { source: 'manual', topics: [] },
  }), { name: 'ReportConflict' });
  assert.throws(() => R.fileReport({ ...input, note: 'legacy request' }), { name: 'ReportConflict' });
  assert.equal(R.reportForBooking(bookingId).note, 'correction');
  assert.deepEqual(R.coverageHistory(reportId).map(filing => filing.coverage.topics[0].covered), [true, false]);
});

test('manual coverage and re-filing preserve earlier objective records', () => {
  const { bookingId } = fresh();
  const input = { bookingId, entries: [] };
  const reportId = R.fileReport({ ...input, note: 'earlier report' });
  const existing = R.notesForReport(reportId)[0];
  const legacy = JSON.stringify({ lessonSlug: 'archived-lesson', materialVersion: 2, objectiveIds: ['obj-1'] });
  handle().prepare('UPDATE lesson_report_notes SET teaching_coverage = ? WHERE id = ?').run(legacy, existing.id);

  R.fileReport({ ...input, note: 'manual correction', expectedFiling: existing.id,
    coverage: { source: 'manual', topics: [] },
  });
  assert.equal(handle().prepare('SELECT teaching_coverage FROM lesson_report_notes WHERE id = ?').get(existing.id).teaching_coverage, legacy);
  assert.deepEqual(R.notesForReport(reportId).map(row => row.note), ['earlier report', 'manual correction']);
});

const { createHash } = await import('node:crypto');

function nativeDraft(lesson) {
  const booking = R.bookingForReport(lesson.bookingId);
  const bundle = { objectives: [{ id: 'exponents', title: 'חזקות' }] };
  const version = createHash('sha256').update(JSON.stringify(bundle)).digest('hex');
  const snapshot = { bookingId: booking.id, studentId: booking.student_id,
    enrollmentId: booking.enrollment_id, start: booking.start, authored: { version, bundle } };
  const receipt = { version: 1, state: 'draft', sourceHash: 'a'.repeat(64),
    reviewFolderId: 'synthetic-review-folder', slides: { id: 'synthetic-slide-file' },
    homework: { id: 'synthetic-homework-doc' }, notesLocation: 'slides',
    provenance: { bundleVersion: version } };
  handle().prepare(`INSERT INTO native_lesson_jobs
    (booking_id, student_id, state, snapshot, bundle, created_at, updated_at)
    VALUES (?, ?, 'review', ?, ?, ?, ?)`).run(booking.id, booking.student_id,
      JSON.stringify(snapshot), JSON.stringify(receipt), booking.start, booking.start);
  return { booking, receipt };
}

function driveFor(receipt) {
  return {
    scope: 'synthetic-scope', ownerEmail: 'tutor@example.test', version: '5', public: false,
    async json(url) {
      assert.equal(new URL(url).pathname, '/drive/v3/files/' + receipt.slides.id);
      return { id: receipt.slides.id, version: this.version, name: 'מצגת לשיעור',
        modifiedTime: '2026-07-01T10:00:00Z', mimeType: 'application/vnd.google-apps.presentation',
        parents: [receipt.reviewFolderId], owners: [{ emailAddress: this.ownerEmail }],
        permissions: [{ type: this.public ? 'anyone' : 'user' }], trashed: false,
        appProperties: { meaCentralScope: this.scope } };
    },
  };
}

function nativeCoverage(token, selection = 'current') {
  return { source: 'native', token, selection, confirmed: true,
    topics: [{ objectiveId: 'exponents', covered: false, comment: null }] };
}

test('a tutor confirms the live Drive version and can correct its coverage after Drive changes', async () => {
  const { nativeReportSource } = await import('../../src/lib/server/reports/native-source.ts');
  const lesson = fresh();
  const { booking, receipt } = nativeDraft(lesson);
  const drive = driveFor(receipt);
  const first = await nativeReportSource(booking, drive);
  const input = { bookingId: booking.id, note: null, entries: [] };

  assert.throws(() => R.fileReport(input), { name: 'ReportConflict' });
  assert.throws(() => R.fileReport({ ...input, expectedFiling: 0, verifiedNative: first,
    coverage: { ...nativeCoverage(first.token), confirmed: false },
  }), { name: 'ReportConflict' });
  const reportId = R.fileReport({ ...input, expectedFiling: 0, verifiedNative: first,
    coverage: nativeCoverage(first.token),
  });
  const [initial] = R.coverageHistory(reportId);
  assert.equal(initial.coverage.bundle.slides.version, '5');
  assert.equal(initial.coverage.bundle.sourceHash, receipt.sourceHash);
  assert.equal(initial.coverage.bundle.homeworkId, receipt.homework.id);
  assert.deepEqual(initial.coverage.topics, [{ objectiveId: 'exponents', title: 'חזקות', covered: false, comment: null }]);

  drive.version = '6';
  const next = await nativeReportSource(booking, drive);
  assert.throws(() => R.fileReport({ ...input, expectedFiling: initial.id, verifiedNative: next,
    coverage: nativeCoverage(first.token),
  }), { name: 'ReportConflict' });
  R.fileReport({ ...input, expectedFiling: initial.id, coverage: nativeCoverage(first.token, 'saved') });
  const corrected = R.coverageHistory(reportId).at(-1);
  assert.equal(corrected.coverage.bundle.slides.version, '5');
  R.fileReport({ ...input, expectedFiling: corrected.id, verifiedNative: next, coverage: nativeCoverage(next.token) });
  assert.deepEqual(R.coverageHistory(reportId).map(f => f.coverage.bundle.slides.version), ['5', '5', '6']);
});

test('a foreign bundle, replaced receipt, or public Drive file cannot be filed as taught', async () => {
  const { nativeReportSource } = await import('../../src/lib/server/reports/native-source.ts');
  const a = nativeDraft(fresh());
  const b = nativeDraft(fresh());
  const drive = driveFor(a.receipt);
  const verifiedNative = await nativeReportSource(a.booking, drive);
  const input = { note: null, entries: [], expectedFiling: 0, verifiedNative, coverage: nativeCoverage(verifiedNative.token) };
  assert.throws(() => R.fileReport({ ...input, bookingId: b.booking.id }), { name: 'ReportConflict' });

  assert.throws(() => R.fileReport({ ...input, bookingId: a.booking.id,
    coverage: { ...input.coverage, topics: [{ objectiveId: 'foreign-goal', covered: true, comment: null }] },
  }), /objective/);
  handle().prepare("UPDATE native_lesson_jobs SET bundle=json_set(bundle,'$.homework.id','replacement-homework') WHERE booking_id=?").run(a.booking.id);
  assert.throws(() => R.fileReport({ ...input, bookingId: a.booking.id }), { name: 'ReportConflict' });
  assert.equal(R.reportForBooking(a.booking.id), null);
  assert.equal(R.reportForBooking(b.booking.id), null);

  drive.public = true;
  await assert.rejects(nativeReportSource(a.booking, drive), { name: 'ReportConflict' });
  R.fileReport({ bookingId: a.booking.id, note: null, entries: [], expectedFiling: 0,
    coverage: { source: 'manual', topics: [] },
  });
  assert.equal(R.coverageHistory(R.reportForBooking(a.booking.id).id)[0].coverage.source, 'manual');
});
