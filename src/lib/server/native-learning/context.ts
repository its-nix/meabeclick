import {handle,inTransaction} from '../db.ts';
import {getNativeLessonJob,type NativeLessonSnapshot} from './jobs.ts';
import {preparationBriefForBooking} from './preparation-brief.ts';
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

/** Tutor supplies the missing teaching facts; level and booking identity come from storage. */
export function bindNativePreparation(input:{bookingId:number;studentId:number;request:unknown;priorKnowledge:unknown}){
 const request=typeof input.request==='string'?input.request.trim():'';
 const priorKnowledge=typeof input.priorKnowledge==='string'?input.priorKnowledge.trim():'';
 if(request.length<3||request.length>1500||priorKnowledge.length<3||priorKnowledge.length>1500)throw Error('preparation_fields');
 return inTransaction(()=>{
  const job=getNativeLessonJob(input.bookingId);
  if(!job||job.studentId!==input.studentId)throw Error('ownership');
  if(!['queued','needs-preparation','failed'].includes(job.state))throw Error('state');
  const snapshot={...job.snapshot,context:NORMAL_REVIEW_CONTEXT};
  if(!supportedNativeContext(snapshot))throw Error('unsupported_context');
  const brief=job.snapshot.brief??preparationBriefForBooking(input);
  if(!brief||brief.missing.some(k=>!['topic','readiness'].includes(k)))throw Error('unsupported_context');
  const updated={...snapshot,brief:{...brief,topic:'התפלגות נורמלית',request,priorKnowledge,readiness:'tutor-reported',missing:[]}};
  // A saved generation may already have Drive files or acknowledged Sheets rows.
  // Retry it unchanged; editing it requires a separate versioned replacement.
  if((job.snapshot as any).authored&&(brief.request!==request||brief.priorKnowledge!==priorKnowledge))throw Error('generated_brief_locked');
  const r=handle().prepare(`UPDATE native_lesson_jobs SET snapshot=?,state='queued',reason=NULL,error_code=NULL,retry_at=NULL,lease_until=NULL,updated_at=? WHERE id=? AND state IN ('queued','needs-preparation','failed') AND EXISTS(SELECT 1 FROM bookings_v2 b WHERE b.id=booking_id AND b.student_id=native_lesson_jobs.student_id AND b.status='confirmed')`).run(JSON.stringify(updated),new Date().toISOString(),job.id);
  if(!r.changes)throw Error('state');return getNativeLessonJob(input.bookingId)!;
 });
}
