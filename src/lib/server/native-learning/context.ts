import {handle,inTransaction} from '../db.ts';
import {getNativeLessonJob,type NativeLessonJob} from './jobs.ts';
import {preparationBriefForBooking} from './preparation-brief.ts';

const OPEN_STATES=['queued','needs-preparation','failed'];
/** Subject, level and duration come from the confirmed booking; only the lesson goal and prior knowledge are tutor input. */
export function nativePreparationOpen(job:Pick<NativeLessonJob,'state'|'snapshot'>):boolean{
 const brief=job.snapshot.brief;
 return OPEN_STATES.includes(job.state)&&!!brief&&brief.missing.every(k=>['topic','readiness'].includes(k));
}

/** Tutor supplies the missing teaching facts; level and booking identity come from storage. */
export function bindNativePreparation(input:{bookingId:number;studentId:number;request:unknown;priorKnowledge:unknown}){
 const request=typeof input.request==='string'?input.request.trim():'';
 const priorKnowledge=typeof input.priorKnowledge==='string'?input.priorKnowledge.trim():'';
 if(request.length<3||request.length>1500||priorKnowledge.length<3||priorKnowledge.length>1500)throw Error('preparation_fields');
 return inTransaction(()=>{
  const job=getNativeLessonJob(input.bookingId);
  if(!job||job.studentId!==input.studentId)throw Error('ownership');
  if(!OPEN_STATES.includes(job.state))throw Error('state');
  const brief=job.snapshot.brief??preparationBriefForBooking(input);
  if(brief.missing.some(k=>!['topic','readiness'].includes(k)))throw Error('incomplete_booking');
  const updated={...job.snapshot,brief:{...brief,topic:request.slice(0,160),request,priorKnowledge,readiness:'tutor-reported',missing:[]}};
  // A saved generation may already have Drive files or acknowledged Sheets rows.
  // Retry it unchanged; editing it requires a separate versioned replacement.
  if((job.snapshot as any).authored&&(brief.request!==request||brief.priorKnowledge!==priorKnowledge))throw Error('generated_brief_locked');
  const r=handle().prepare(`UPDATE native_lesson_jobs SET snapshot=?,state='queued',reason=NULL,error_code=NULL,retry_at=NULL,lease_until=NULL,updated_at=? WHERE id=? AND state IN ('queued','needs-preparation','failed') AND EXISTS(SELECT 1 FROM bookings_v2 b WHERE b.id=booking_id AND b.student_id=native_lesson_jobs.student_id AND b.status='confirmed')`).run(JSON.stringify(updated),new Date().toISOString(),job.id);
  if(!r.changes)throw Error('state');return getNativeLessonJob(input.bookingId)!;
 });
}
