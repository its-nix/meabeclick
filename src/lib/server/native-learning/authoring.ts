import{createHash}from'node:crypto';
import{execFileSync}from'node:child_process';
import{engineBin}from'../lesson/engine.ts';
import manifest from './authoring-manifest.json' with{type:'json'};
import{handle}from'../db.ts';
import{generateVisualLesson}from'../lesson/visual-generation.ts';
import{visualAuthoringRules}from'../../learning/deck/rules.ts';
import{visualLessonProblems,type VisualLesson}from'../../learning/deck/model.ts';
import{officialQuestion}from'../lesson/official-questions.ts';
import{acceptedFeedbackRules}from'../learning-feedback/store.ts';
import{NORMAL_REVIEW_CONTEXT}from'./context.ts';
import{getNativeLessonJob,type NativeLessonJob}from'./jobs.ts';
import type{NativeValidation}from'./validation.ts';
export interface AuthoredLesson{bundle:VisualLesson;version:string;kind?:string;model?:string;rulesHash?:string;contextHash?:string;cliVersion?:string;authoringFingerprint?:string;sources?:Array<{id:string;sha256:string}>;feedbackPolicyHash?:string;validation?:NativeValidation}
export interface NativeRepairFeedback{parentVersion:string;findings:NativeValidation['findings']}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
/** A stale caller may never replace the current authored candidate or its review state. */
export function currentAuthoringJob(job:NativeLessonJob):NativeLessonJob{
 const now=new Date().toISOString();
 if(!handle().prepare(`SELECT 1 FROM native_lesson_jobs j JOIN bookings_v2 b ON b.id=j.booking_id AND b.student_id=j.student_id WHERE j.id=? AND j.booking_id=? AND j.student_id=? AND j.attempts=? AND j.state='preparing' AND j.lease_until>? AND b.status='confirmed'`).get(job.id,job.bookingId,job.studentId,job.attempts,now))throw Error('paused');
 return getNativeLessonJob(job.bookingId)!;
}
function nativeEngineInfo(){
 let cliVersion:string;try{cliVersion=execFileSync(engineBin(),['--version'],{encoding:'utf8',timeout:5000,stdio:['ignore','pipe','ignore']}).trim().slice(0,120);}catch{throw Error('engine-missing');}
 return{model:process.env.NATIVE_LESSON_MODEL??'gpt-5.6-terra',cliVersion};
}
export async function authorNativeLesson(job:NativeLessonJob,generate:typeof generateVisualLesson=generateVisualLesson,engineInfo=nativeEngineInfo,reviewFeedback?:NativeRepairFeedback):Promise<AuthoredLesson>{
 const current=currentAuthoringJob(job),snapshot=current.snapshot as typeof current.snapshot&{authored?:AuthoredLesson;authoringPolicy?:{guidance:string[];hash:string};reviewRepair?:{count:number};validation?:NativeValidation};
 const brief=snapshot.brief;
 if(brief?.readiness!=='tutor-reported'||!brief.request?.trim()||!brief.priorKnowledge?.trim()||brief.missing.length)throw Error('native_brief_required');
 const cached=snapshot.authored;
 if(cached&&!reviewFeedback)return cached;
 if(current.bundle)throw Error('native_authoring_locked');
 if(reviewFeedback&&(!cached||reviewFeedback.parentVersion!==cached.version||snapshot.validation?.status!=='revise'||snapshot.validation.contentHash!==cached.version||JSON.stringify(snapshot.validation.findings)!==JSON.stringify(reviewFeedback.findings)))throw Error('native_review_invalid');
 if(reviewFeedback&&(snapshot.reviewRepair?.count??0)>=1)throw Error('native_review_repair_limit');
 const policy=reviewFeedback?(snapshot.authoringPolicy??{guidance:[],hash:cached?.feedbackPolicyHash??hash('[]')}):acceptedFeedbackRules();
 if(policy.guidance.length>100||JSON.stringify(policy.guidance).length>32000)throw Error('native_feedback_policy_limit');
 const info=engineInfo(),model=reviewFeedback?cached!.model:info.model,cliVersion=info.cliVersion;
 if(!model)throw Error('native_review_invalid');
 if(reviewFeedback){
  // Reserve the single automatic repair before spending a model call. Crash/restart cannot repeat it.
  const now=new Date().toISOString(),lineage={count:1,parentVersion:cached!.version,startedAt:now,findings:reviewFeedback.findings};
  const r=handle().prepare(`UPDATE native_lesson_jobs SET snapshot=json_set(snapshot,'$.authoredParent',json(?),'$.reviewRepair',json(?),'$.reviewParentValidation',json(?),'$.reviewParentValidationBinding',json(?)),updated_at=? WHERE id=? AND state='preparing' AND attempts=? AND lease_until>? AND bundle IS NULL AND json_extract(snapshot,'$.authored.version')=? AND COALESCE(json_extract(snapshot,'$.reviewRepair.count'),0)=0 AND json_extract(snapshot,'$.validation.status')='revise' AND json_extract(snapshot,'$.validation.contentHash')=? AND EXISTS(SELECT 1 FROM bookings_v2 b WHERE b.id=booking_id AND b.student_id=native_lesson_jobs.student_id AND b.status='confirmed')`).run(JSON.stringify(cached),JSON.stringify(lineage),JSON.stringify(snapshot.validation),JSON.stringify((snapshot as any).validationBinding??null),now,job.id,job.attempts,now,cached!.version,cached!.version);
  if(!r.changes)throw Error('paused');
 }
 const context={purpose:'booking' as const,skill:'התפלגות נורמלית',request:brief.request+(reviewFeedback?'\nתקנו את ממצאי הבדיקה העצמאית שבהיסטוריה. שמרו על מטרת השיעור, הרמה והמקור המאומת. הפיקו חבילה מלאה ומתוקנת.':''),track:'3',questionnaire:'35372',durationMin:90,history:[...(brief.observations??[]),...(brief.practice??[]).map(p=>({kind:'practice',...p,mastery:'not-inferred'})),...(brief.previousAssignedSourceIds??[]).map(sourceId=>({kind:'previous-assignment-source',sourceId,use:'not-confirmed'})),...(policy.guidance.length?[{kind:'human-approved-generation-guidance',hash:policy.hash,guidance:policy.guidance}]:[]),...(reviewFeedback?[{kind:'independent-review-required-corrections',parentVersion:cached!.version,parent:cached!.bundle,findings:reviewFeedback.findings}]:[])],notation:'school-normal-s',readiness:brief.priorKnowledge};
 const sourceId=NORMAL_REVIEW_CONTEXT.sourceId;
 const bundle=await generate({context,sourceIds:[sourceId],model});
 const source=officialQuestion(sourceId);const errors=visualLessonProblems(bundle,{durationMin:90,sourceAnswers:{[sourceId]:source!.answers!}});
 if(errors.length)throw Error('native_authoring_invalid');
 const authored={bundle,version:hash(JSON.stringify(bundle)),kind:'fresh-booking-generation',model,cliVersion,authoringFingerprint:manifest.fingerprint,sources:[{id:sourceId,sha256:hash(JSON.stringify(source))}],rulesHash:hash(JSON.stringify({base:visualAuthoringRules(),acceptedFeedback:policy})),contextHash:hash(JSON.stringify(context)),feedbackPolicyHash:policy.hash};
 if(reviewFeedback&&authored.version===cached!.version)throw Error('native_review_revise');
 const now=new Date().toISOString();
 const sql=reviewFeedback?`AND json_extract(snapshot,'$.authored.version')=? AND json_extract(snapshot,'$.reviewRepair.parentVersion')=? AND json_extract(snapshot,'$.reviewRepair.count')=1`:`AND json_extract(snapshot,'$.authored') IS NULL`;
 const result=handle().prepare(`UPDATE native_lesson_jobs SET snapshot=json_set(snapshot,'$.authored',json(?),'$.authoringPolicy',json(?)),updated_at=? WHERE id=? AND state='preparing' AND attempts=? AND lease_until>? AND bundle IS NULL ${sql} AND EXISTS(SELECT 1 FROM bookings_v2 b WHERE b.id=booking_id AND b.student_id=native_lesson_jobs.student_id AND b.status='confirmed')`).run(JSON.stringify(authored),JSON.stringify(policy),now,job.id,job.attempts,now,...(reviewFeedback?[cached!.version,cached!.version]:[]));
 if(!result.changes)throw Error('paused');
 return authored;
}
