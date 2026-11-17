import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'native-progress-google-')), 'db.sqlite');
const E = await import('../../src/lib/server/entities.ts');
const S = await import('../../src/lib/server/plans/store.ts');
const J = await import('../../src/lib/server/native-learning/jobs.ts');
const R = await import('../../src/lib/server/native-learning/results.ts');
const EV = await import('../../src/lib/server/plans/evidence.ts');
const A = await import('../../src/lib/server/native-learning/approval-google.ts');
const W = await import('../../src/lib/learning/workspace.ts');
const { handle } = await import('../../src/lib/server/db.ts');

const template = { id: 'demo', version: 1, subject: 'מתמטיקה', track: '5 יח״ל', reviewed: null,
 topics: [{ key: 'calc', title: 'חשבון', branches: [{ key: 'calc.r', title: 'כללי גזירה', skills: [
  { key: 'calc.r.a', title: 'חוקי חזקות', requires: [] }, { key: 'calc.r.b', title: 'כלל המנה', requires: [] }] }] }] };
let seq = 0;
function setup() {
 seq++;
 const account = E.createAccount({ name: `f${seq}`, phone: null, credential: 'x' });
 const student = E.createStudent({ code: `nr${seq}`, name: `s${seq}`, accountId: account.id, credential: 'x' });
 E.upsertEnrollment({ studentId: student.id, subject: 'מתמטיקה', level: 'כיתה יא', teacherId: null });
 const enrollment = E.enrollmentsForStudent(student.id)[0];
 const planId = S.createPlan({ studentId: student.id, enrollmentId: enrollment.id, template, goal: 'ב' });
 const nodes = S.planData(planId).nodes.filter(n => n.kind === 'skill');
 const bookingId = E.reserveBooking({ studentId: student.id, start: `2029-0${(seq % 9) + 1}-01T10:00:00.000Z`, end: `2029-0${(seq % 9) + 1}-01T11:30:00.000Z`, durationMin: 90 });
 J.enqueueNativeLesson({ bookingId, studentId: student.id });
 const bundle = { objectives: [{ id: 'o1', title: 'חוקי חזקות' }, { id: 'o2', title: 'נושא אחר' }] };
 handle().prepare('UPDATE native_lesson_jobs SET bundle=? WHERE booking_id=?').run(JSON.stringify(bundle), bookingId);
 const game = { id: 'g1', kind: 'quiz', rounds: [
  { id: 'r1', objectiveId: 'o1', grading: 'checked' }, { id: 'r2', objectiveId: 'o1', grading: 'checked' },
  { id: 'r3', objectiveId: 'o1', grading: 'tutor-review' }, { id: 'r4', objectiveId: 'o2', grading: 'checked' }] };
 handle().prepare(`INSERT INTO native_games (material_id,release_id,student_id,booking_id,game_id,kind,content_json,source_file_id,source_revision,content_sha256,approved_at)
  VALUES ('m'||?,'rel',?,?,'g1','quiz',?,'f','1','h','2029-01-01T00:00:00Z')`).run(seq, student.id, bookingId, JSON.stringify(game));
 return { student, bookingId, nodes };
}

test('finished game results are appended once to a created Native Progress tab; unmapped and awaiting-review rows are skipped', async () => {
 const c = setup();
 const rec = (roundId, outcome = 'correct', attempts = 1) => R.recordNativeResult({ studentId: c.student.id, bookingId: c.bookingId, gameId: 'g1', roundId, outcome, attempts, seconds: 5 });
 rec('r1'); rec('r2', 'incorrect', 2); rec('r3', 'correct', 1); rec('r4');
 const sheets = []; let calls = 0;
 const api = { scope: 'scope-1', ownerEmail: 'o@example.test', async json(url, init) {
  calls++;
  if (url.includes('?fields=sheets(properties,developerMetadata)')) return { sheets: sheets.map(s => ({ properties: s.properties, developerMetadata: s.developerMetadata })) };
  if (url.includes('/values/')) { const s = sheets[0]; return { values: s ? s.rows : [] }; }
  if (url.endsWith(':batchUpdate')) {
   for (const r of JSON.parse(init.body).requests) {
    if (r.addSheet) sheets.push({ properties: r.addSheet.properties, developerMetadata: [], rows: [] });
    if (r.createDeveloperMetadata) sheets[0].developerMetadata.push(r.createDeveloperMetadata.developerMetadata);
    if (r.appendCells) for (const row of r.appendCells.rows) sheets[0].rows.push(row.values.map(v => v.userEnteredValue.stringValue ?? v.userEnteredValue.boolValue));
   }
   return {};
  }
  throw Error('unexpected ' + url);
 } };
 const sheet = A.googleProgressSheet(api, 'indexSheetAAAA1');
 assert.deepEqual(await A.syncNativeProgress(sheet), { appended: 2 });
 assert.equal(sheets.length, 1); assert.equal(sheets[0].properties.title, 'Native Progress');
 const header = sheets[0].rows[0]; assert.ok(header.some(h => String(h).includes('[evidence_id]')));
 const body = sheets[0].rows.slice(1); assert.equal(body.length, 2);
 assert.ok(body.every(r => /^native-result-\d+$/.test(r[0]) && r[1] === `student-${c.student.id}` && r.includes('game')));
 assert.deepEqual(await A.syncNativeProgress(sheet), { appended: 0 });
 assert.equal(sheets[0].rows.length, 3);
});
