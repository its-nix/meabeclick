import { handle } from '../db.ts';

export type NativeLessonState = 'queued' | 'preparing' | 'needs-preparation' | 'review' | 'failed' | 'cancelled';
export interface NativeLessonSnapshot {
 bookingId: number; studentId: number; enrollmentId: number | null; teacherId: number | null;
 subject: string | null; level: string | null; start: string; durationMin: number | null;
}
export interface NativeLessonJob {
 id: number; bookingId: number; studentId: number; state: NativeLessonState;
 snapshot: NativeLessonSnapshot; attempts: number; leaseUntil: string | null;
 retryAt: string | null; errorCode: string | null; reason: string | null;
 bundle: unknown | null; createdAt: string; updatedAt: string;
}
function decode(row: Record<string, unknown> | undefined): NativeLessonJob | null {
 if (!row) return null;
 return {id:Number(row.id), bookingId:Number(row.booking_id),studentId:Number(row.student_id),
 state:row.state as NativeLessonState,snapshot:JSON.parse(String(row.snapshot)),attempts:Number(row.attempts),
 leaseUntil:row.lease_until as string|null,retryAt:row.retry_at as string|null,errorCode:row.error_code as string|null,
 reason:row.reason as string|null,bundle:row.bundle ? JSON.parse(String(row.bundle)):null,
 createdAt:String(row.created_at),updatedAt:String(row.updated_at)};
}
export function getNativeLessonJob(bookingId: number): NativeLessonJob | null {
 return decode(handle().prepare('SELECT * FROM native_lesson_jobs WHERE booking_id=?').get(bookingId));
}
export function enqueueNativeLesson(input: {bookingId: number; studentId: number}): NativeLessonJob {
 const db=handle();
 const row=db.prepare(`SELECT b.id,b.student_id,b.enrollment_id,b.teacher_id,b.start,b.duration,b.status,e.subject,e.level
 FROM bookings_v2 b LEFT JOIN enrollments e ON e.id=b.enrollment_id AND e.student_id=b.student_id
 WHERE b.id=? AND b.student_id=?`).get(input.bookingId,input.studentId);
 if (!row) throw new Error('native lesson booking ownership mismatch');
 const snapshot: NativeLessonSnapshot={bookingId:input.bookingId,studentId:input.studentId,
 enrollmentId:row.enrollment_id as number|null,teacherId:row.teacher_id as number|null,
 subject:row.subject as string|null ?? null,level:row.level as string|null ?? null,
 start:String(row.start),durationMin:row.duration as number|null};
 const now=new Date().toISOString();
 db.prepare(`INSERT INTO native_lesson_jobs (booking_id,student_id,state,snapshot,created_at,updated_at)
 VALUES (?,?,?,?,?,?) ON CONFLICT(booking_id) DO NOTHING`).run(input.bookingId,input.studentId,
 row.status==='confirmed'?'queued':'cancelled',JSON.stringify(snapshot),now,now);
 return getNativeLessonJob(input.bookingId)!;
}
/** One atomic UPDATE claims the next item, including a lease lost on restart. */
export function claimNativeLessonJob(input: {bookingId?: number; leaseMs?: number} = {}): NativeLessonJob | null {
 const now=new Date().toISOString();
 const leaseMs=input.leaseMs ?? 10*60_000;
 if (!Number.isFinite(leaseMs) || leaseMs<=0) throw new Error('invalid native lesson lease');
 return decode(handle().prepare(`UPDATE native_lesson_jobs SET state='preparing',attempts=attempts+1,
 lease_until=?,retry_at=NULL,updated_at=? WHERE id=(
 SELECT j.id FROM native_lesson_jobs j JOIN bookings_v2 b ON b.id=j.booking_id AND b.student_id=j.student_id
 WHERE b.status='confirmed' AND (? IS NULL OR j.booking_id=?)
 AND NOT EXISTS (SELECT 1 FROM native_lesson_jobs active
 WHERE active.student_id=j.student_id AND active.id<>j.id
 AND active.state='preparing' AND active.lease_until>?)
 AND (j.state='queued' OR (j.state='failed' AND j.retry_at IS NOT NULL AND j.retry_at<=?)
 OR (j.state='preparing' AND j.lease_until<=?)) ORDER BY j.id LIMIT 1) RETURNING *`)
 .get(new Date(Date.now()+leaseMs).toISOString(),now,input.bookingId??null,input.bookingId??null,now,now,now));
}
/** Only the current unexpired worker may store a review draft. Never releases to a student. */
export function finishNativeLessonJob(input: {
 bookingId:number; attempt:number; state:'review'|'needs-preparation'; bundle?:unknown; reason?:string;
}): NativeLessonJob | null {
 const now=new Date().toISOString();
 return decode(handle().prepare(`UPDATE native_lesson_jobs SET state=?,bundle=?,reason=?,error_code=NULL,
 lease_until=NULL,retry_at=NULL,updated_at=? WHERE booking_id=? AND attempts=? AND state='preparing'
 AND lease_until>? AND EXISTS (SELECT 1 FROM bookings_v2 b WHERE b.id=booking_id AND b.student_id=native_lesson_jobs.student_id AND b.status='confirmed') RETURNING *`)
 .get(input.state,input.bundle==null?null:JSON.stringify(input.bundle),input.reason??null,now,input.bookingId,input.attempt,now));
}
/** Persist a safe error code, not upstream bodies that might contain private source material. */
export function failNativeLessonJob(input: {bookingId:number;attempt:number;code:string;retryable?:boolean}): NativeLessonJob | null {
 if (!/^[a-z0-9_-]{1,80}$/.test(input.code)) throw new Error('invalid native lesson error code');
 const now=new Date().toISOString();
 const retryAt=input.retryable && input.attempt<3 ? new Date(Date.now()+60_000*2**(input.attempt-1)).toISOString():null;
 return decode(handle().prepare(`UPDATE native_lesson_jobs SET state='failed',error_code=?,retry_at=?,lease_until=NULL,
 updated_at=? WHERE booking_id=? AND attempts=? AND state='preparing' AND lease_until>?
 AND EXISTS (SELECT 1 FROM bookings_v2 b WHERE b.id=booking_id AND b.student_id=native_lesson_jobs.student_id AND b.status='confirmed') RETURNING *`)
 .get(input.code,retryAt,now,input.bookingId,input.attempt,now));
}
export function listNativeLessonJobs(input: {studentId?: number} = {}): NativeLessonJob[] {
 return handle().prepare(`SELECT * FROM native_lesson_jobs WHERE (? IS NULL OR student_id=?) ORDER BY id DESC`)
 .all(input.studentId??null,input.studentId??null).map(row=>decode(row)!);
}
/** Booking has already succeeded. Preparation failure must never roll it back. */
export function enqueueNativeLessonForBooking(input: {bookingId:number;studentId:number}): NativeLessonJob | null {
 try { return enqueueNativeLesson(input); }
 catch { return null; }
}
/** Recover missed enqueues, including lessons already started. Migration 040 records
 * the activation boundary atomically; booking `at` is its server-written creation
 * time. Include every upcoming confirmed lesson regardless of booking age, plus
 * post-activation bookings whose start passed before recovery. Exclude only
 * pre-activation past history. All recovered jobs still need explicit tutor context. */
export function reconcileNativeLessonJobs(): number {
 const rows=handle().prepare(`SELECT b.id,b.student_id FROM bookings_v2 b
 LEFT JOIN native_lesson_jobs j ON j.booking_id=b.id
 WHERE b.status='confirmed'
 AND (julianday(b.start) >= julianday(?) OR b.at >= (SELECT applied_at FROM schema_version WHERE version=40))
 AND j.id IS NULL ORDER BY b.id`).all(new Date().toISOString());
 let recovered=0;
 for (const row of rows) {
  if (enqueueNativeLessonForBooking({bookingId:Number(row.id),studentId:Number(row.student_id)})) recovered++;
 }
 return recovered;
}
