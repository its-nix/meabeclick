import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'native-jobs-')), 'db.sqlite');
const E = await import('../../src/lib/server/entities.ts');
const { handle } = await import('../../src/lib/server/db.ts');
const J = await import('../../src/lib/server/native-learning/jobs.ts');
const account = E.createAccount({name:'Synthetic',credential:'test'});
const student = E.createStudent({code:'native-test',name:'Same name',accountId:account.id,credential:'test'});
const second = E.createStudent({code:'native-other',name:'Same name',accountId:account.id,credential:'test'});
function booking(day = 1) {
 return E.reserveBooking({studentId:student.id,start:`2028-06-${String(day).padStart(2,'0')}T10:00:00.000Z`,end:`2028-06-${String(day).padStart(2,'0')}T11:30:00.000Z`,durationMin:90});
}
test('enqueue is durable, replay-safe and scoped by authoritative booking ownership', () => {
 const bookingId=booking();
 const job=J.enqueueNativeLesson({bookingId,studentId:student.id});
 assert.equal(job.state,'queued');
 assert.equal(job.studentId,student.id);
 assert.equal(job.snapshot.durationMin,90);
 assert.equal(J.enqueueNativeLesson({bookingId,studentId:student.id}).id,job.id);
 assert.deepEqual(J.getNativeLessonJob(bookingId),job);
 assert.throws(()=>J.enqueueNativeLesson({bookingId,studentId:second.id}),/ownership/);
 assert.equal(handle().prepare('SELECT count(*) AS n FROM native_lesson_jobs').get().n,1);
});
test('claim leases prevent duplicate work and expired claims fence out a previous worker', () => {
 const bookingId=booking(2); J.enqueueNativeLesson({bookingId,studentId:student.id});
 const first=J.claimNativeLessonJob({bookingId});
 assert.equal(first.state,'preparing'); assert.equal(first.attempts,1);
 assert.equal(J.claimNativeLessonJob({bookingId}),null);
 handle().prepare("UPDATE native_lesson_jobs SET lease_until='2000-01-01T00:00:00.000Z' WHERE booking_id=?").run(bookingId);
 const recovered=J.claimNativeLessonJob({bookingId});
 assert.equal(recovered.attempts,2);
 assert.equal(J.finishNativeLessonJob({bookingId,attempt:1,state:'review',bundle:{slidesId:'stale'}}),null);
 assert.equal(J.finishNativeLessonJob({bookingId,attempt:2,state:'review',bundle:{slidesId:'synthetic'}}).bundle.slidesId,'synthetic');
 assert.equal(J.claimNativeLessonJob({bookingId}),null);
});
test('retryable errors survive restart with backoff and bounded attempts', () => {
 const bookingId=booking(3); J.enqueueNativeLesson({bookingId,studentId:student.id});
 for(let attempt=1;attempt<=3;attempt++) {
  const job=J.claimNativeLessonJob({bookingId}); assert.equal(job.attempts,attempt);
  const failed=J.failNativeLessonJob({bookingId,attempt,code:'drive-unavailable',retryable:true});
  assert.equal(failed.state,'failed');
  assert.equal(J.claimNativeLessonJob({bookingId}),null);
  if(attempt<3) {
   assert.ok(failed.retryAt);
   handle().prepare("UPDATE native_lesson_jobs SET retry_at='2000-01-01T00:00:00.000Z' WHERE booking_id=?").run(bookingId);
  } else assert.equal(failed.retryAt,null);
 }
});
test('cancellation immediately suppresses completion and future claims', () => {
 const bookingId=booking(4); J.enqueueNativeLesson({bookingId,studentId:student.id});
 const job=J.claimNativeLessonJob({bookingId}); E.cancelBooking(bookingId);
 assert.equal(J.getNativeLessonJob(bookingId).state,'cancelled');
 assert.equal(J.finishNativeLessonJob({bookingId,attempt:job.attempts,state:'review',bundle:{slidesId:'forbidden'}}),null);
 assert.equal(J.claimNativeLessonJob({bookingId}),null);
 assert.equal(J.enqueueNativeLesson({bookingId,studentId:student.id}).state,'cancelled');
});
test('optional preparation storage failure never fails or cancels the booking', () => {
 const bookingId=booking(5);
 handle().exec('ALTER TABLE native_lesson_jobs RENAME TO native_lesson_jobs_unavailable');
 try { assert.equal(J.enqueueNativeLessonForBooking({bookingId,studentId:student.id}),null); }
 finally { handle().exec('ALTER TABLE native_lesson_jobs_unavailable RENAME TO native_lesson_jobs'); }
 assert.equal(handle().prepare('SELECT status FROM bookings_v2 WHERE id=?').get(bookingId).status,'confirmed');
});

test('a fresh process recovers queued jobs from the same durable database', () => {
 const bookingId=booking(6); J.enqueueNativeLesson({bookingId,studentId:student.id});
 const result=spawnSync(process.execPath,['--input-type=module','-e',`
  import {claimNativeLessonJob} from './src/lib/server/native-learning/jobs.ts';
  const job=claimNativeLessonJob({bookingId:${bookingId}});
  if(job?.state!=='preparing' || job.attempts!==1) process.exit(1);
 `],{cwd:process.cwd(),env:process.env,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 assert.equal(J.getNativeLessonJob(bookingId).state,'preparing');
});
test('teacher job listing preserves student identity when names collide', () => {
 const bookingId=booking(7); J.enqueueNativeLesson({bookingId,studentId:student.id});
 assert.ok(J.listNativeLessonJobs({studentId:student.id}).some(job=>job.bookingId===bookingId));
 assert.deepEqual(J.listNativeLessonJobs({studentId:second.id}),[]);
});
test('reconciliation recovers a confirmed booking missed by enqueue without duplicating jobs', () => {
 const bookingId=booking(8);
 J.reconcileNativeLessonJobs();
 assert.equal(J.getNativeLessonJob(bookingId).state,'queued');
 assert.equal(J.reconcileNativeLessonJobs(),0);
});
test('restart reconciliation includes upcoming bookings and post-activation recovery but excludes pre-activation past history', () => {
 const db=handle();
 const activation=db.prepare('SELECT applied_at FROM schema_version WHERE version=40').get().applied_at;
 const oldId=E.reserveBooking({studentId:student.id,start:'2030-03-01T10:00:00.000Z',end:'2030-03-01T11:30:00.000Z',durationMin:90});
 const missedId=E.reserveBooking({studentId:student.id,start:'2020-03-01T10:00:00.000Z',end:'2020-03-01T11:30:00.000Z',durationMin:90});
 const historicalId=E.reserveBooking({studentId:student.id,start:'2020-03-02T10:00:00.000Z',end:'2020-03-02T11:30:00.000Z',durationMin:90});
 db.prepare('UPDATE bookings_v2 SET at=? WHERE id=?').run(new Date(Date.parse(activation)-1000).toISOString(),historicalId);
 db.prepare('UPDATE bookings_v2 SET at=? WHERE id=?').run(new Date(Date.parse(activation)-1000).toISOString(),oldId);
 db.prepare('UPDATE bookings_v2 SET at=? WHERE id=?').run(new Date(Date.parse(activation)+1000).toISOString(),missedId);
 db.exec('ALTER TABLE native_lesson_jobs RENAME TO native_lesson_jobs_unavailable');
 try { assert.equal(J.enqueueNativeLessonForBooking({bookingId:missedId,studentId:student.id}),null); }
 finally { db.exec('ALTER TABLE native_lesson_jobs_unavailable RENAME TO native_lesson_jobs'); }
 const restart=spawnSync(process.execPath,['--input-type=module','-e',`
  import {reconcileNativeLessonJobs} from './src/lib/server/native-learning/jobs.ts';
  reconcileNativeLessonJobs();
 `],{cwd:process.cwd(),env:process.env,encoding:'utf8'});
 assert.equal(restart.status,0,restart.stderr);
 assert.equal(J.getNativeLessonJob(missedId)?.state,'queued');
 assert.equal(J.getNativeLessonJob(oldId)?.state,'queued');
 assert.equal(J.getNativeLessonJob(historicalId),null);
});
test('only one active worker may prepare a student across different booking jobs', () => {
 const learner=E.createStudent({code:'native-concurrency',name:'Synthetic concurrency',accountId:account.id,credential:'test'});
 const firstId=E.reserveBooking({studentId:learner.id,start:'2033-03-01T10:00:00.000Z',end:'2033-03-01T11:30:00.000Z',durationMin:90});
 const secondId=E.reserveBooking({studentId:learner.id,start:'2033-03-02T10:00:00.000Z',end:'2033-03-02T11:30:00.000Z',durationMin:90});
 for(const bookingId of [firstId,secondId]) J.enqueueNativeLesson({bookingId,studentId:learner.id});
 const first=J.claimNativeLessonJob({bookingId:firstId}); assert.ok(first);
 assert.equal(J.claimNativeLessonJob({bookingId:secondId}),null);
 handle().prepare("UPDATE native_lesson_jobs SET lease_until='2000-01-01T00:00:00.000Z' WHERE booking_id=?").run(firstId);
 assert.ok(J.claimNativeLessonJob({bookingId:secondId}));
});
test('reconciliation compares offset booking starts as instants at the upcoming boundary', (t) => {
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2036-04-15T11:30:00.000Z')});
 const db=handle();
 // 12:30 +02 is 10:30 UTC: already started, although its wall time sorts later.
 const pastId=E.reserveBooking({studentId:student.id,start:'2036-04-15T12:30:00.000+02:00',end:'2036-04-15T13:00:00.000+02:00',durationMin:30});
 // 10:30 -02 is 12:30 UTC: upcoming, although its wall time sorts earlier.
 const futureId=E.reserveBooking({studentId:student.id,start:'2036-04-15T10:30:00.000-02:00',end:'2036-04-15T11:00:00.000-02:00',durationMin:30});
 assert.ok(pastId); assert.ok(futureId);
 for(const id of [pastId,futureId]) db.prepare('UPDATE bookings_v2 SET at=? WHERE id=?').run('2000-01-01T00:00:00.000Z',id);
 J.reconcileNativeLessonJobs();
 assert.equal(J.getNativeLessonJob(pastId),null,'a pre-activation booking already started in UTC is historical');
 assert.equal(J.getNativeLessonJob(futureId)?.state,'queued','an upcoming booking is eligible regardless of its offset');
});
