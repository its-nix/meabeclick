import {handle,inTransaction} from '../db.ts';
import {getNativeLessonJob,type NativeLessonSnapshot} from './jobs.ts';
import {levelUnitTracks} from '../../learning/education-level.ts';

/** Explicit tutor calibration, never inferred from a learner's name or grade. */
export const NORMAL_REVIEW_CONTEXT={kind:'normal-distribution35372',purpose:'review',subject:'mathematics',educationLevel:'high-school',topic:'normal-distribution',track:'3',questionnaire:'35372',notation:'school-normal-s',durationMin:90,readiness:'percentages-and-mean-ready-normal-new',sourceId:'moe-2025a-35372-3'} as const;
export function supportedNativeContext(snapshot:NativeLessonSnapshot&{context?:unknown}):boolean {
 const context=snapshot.context;
 const level=snapshot.level??'',tracks=levelUnitTracks(level);
 if(tracks.some(track=>!track.startsWith('3')))return false;
 const highSchool=tracks.length>0||/(?:תיכון|בגרות|כיתה\s*י(?:\s|[אב"'״]|$))/.test(level);
 return snapshot.durationMin===90&&['מתמטיקה','math','mathematics'].includes((snapshot.subject??'').trim().toLowerCase())&&highSchool&&!!context&&typeof context==='object'&&Object.keys(context).length===Object.keys(NORMAL_REVIEW_CONTEXT).length&&Object.entries(NORMAL_REVIEW_CONTEXT).every(([k,v])=>(context as Record<string,unknown>)[k]===v);
}
export function bindNativeReviewContext(input:{bookingId:number;studentId:number;context:unknown}) {
 return inTransaction(()=>{
  const job=getNativeLessonJob(input.bookingId);
  if(!job||job.studentId!==input.studentId)throw Error('ownership');
  if(!['queued','needs-preparation','failed'].includes(job.state))throw Error('state');
  const snapshot={...job.snapshot,context:input.context};
  if(!supportedNativeContext(snapshot))throw Error('unsupported_context');
  const changed=handle().prepare(`UPDATE native_lesson_jobs SET snapshot=?,state='queued',reason=NULL,error_code=NULL,retry_at=NULL,lease_until=NULL,updated_at=?
   WHERE id=? AND state IN ('queued','needs-preparation','failed') AND EXISTS(SELECT 1 FROM bookings_v2 WHERE id=? AND student_id=? AND status='confirmed')`).run(JSON.stringify(snapshot),new Date().toISOString(),job.id,input.bookingId,input.studentId);
  if(!changed.changes)throw Error('state');
  return getNativeLessonJob(input.bookingId)!;
 });
}
