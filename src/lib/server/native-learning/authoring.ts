import{createHash}from'node:crypto';
import{execFileSync}from'node:child_process';
import{engineBin}from'../lesson/engine.ts';
import manifest from './authoring-manifest.json' with{type:'json'};
import{handle}from'../db.ts';
import{generateVisualLesson}from'../lesson/visual-generation.ts';
import{visualAuthoringRules}from'../../learning/deck/rules.ts';
import{visualLessonProblems,type VisualLesson}from'../../learning/deck/model.ts';
import{officialQuestion}from'../lesson/official-questions.ts';
import{NORMAL_REVIEW_CONTEXT}from'./context.ts';
import type{NativeLessonJob}from'./jobs.ts';
export interface AuthoredLesson{bundle:VisualLesson;version:string;kind?:string;model?:string;rulesHash?:string;contextHash?:string;cliVersion?:string;authoringFingerprint?:string;sources?:Array<{id:string;sha256:string}>}
function nativeEngineInfo(){
 let cliVersion:string;try{cliVersion=execFileSync(engineBin(),['--version'],{encoding:'utf8',timeout:5000,stdio:['ignore','pipe','ignore']}).trim().slice(0,120);}catch{throw Error('engine-missing');}
 return{model:process.env.NATIVE_LESSON_MODEL??'gpt-5.6-terra',cliVersion};
}
export async function authorNativeLesson(job:NativeLessonJob,generate:typeof generateVisualLesson=generateVisualLesson,engineInfo=nativeEngineInfo):Promise<AuthoredLesson>{
 const brief=job.snapshot.brief;
 if(brief?.readiness!=='tutor-reported'||!brief.request?.trim()||!brief.priorKnowledge?.trim()||brief.missing.length)throw Error('native_brief_required');
 const cached=(job.snapshot as any).authored as AuthoredLesson|undefined;
 if(cached)return cached;
 const {model,cliVersion}=engineInfo();
 const context={purpose:'booking' as const,skill:'התפלגות נורמלית',request:brief.request,track:'3',questionnaire:'35372',durationMin:90,history:[...(brief?.observations??[]),...(brief?.practice??[]).map(p=>({kind:'practice',...p,mastery:'not-inferred'})),...(brief.previousAssignedSourceIds??[]).map(sourceId=>({kind:'previous-assignment-source',sourceId,use:'not-confirmed'}))],notation:'school-normal-s',readiness:brief.priorKnowledge};
 const sourceId=NORMAL_REVIEW_CONTEXT.sourceId;
 const bundle=await generate({context,sourceIds:[sourceId],model});
 const source=officialQuestion(sourceId);const errors=visualLessonProblems(bundle,{durationMin:90,sourceAnswers:{[sourceId]:source!.answers!}});
 if(errors.length)throw Error('native_authoring_invalid');
 const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
 const authored={bundle,version:hash(JSON.stringify(bundle)),kind:'fresh-booking-generation',model,cliVersion,authoringFingerprint:manifest.fingerprint,sources:[{id:sourceId,sha256:hash(JSON.stringify(source))}],rulesHash:hash(visualAuthoringRules()),contextHash:hash(JSON.stringify(context))};
 const now=new Date().toISOString();
 const result=handle().prepare(`UPDATE native_lesson_jobs SET snapshot=?,updated_at=? WHERE id=? AND state='preparing' AND attempts=? AND lease_until>? AND EXISTS(SELECT 1 FROM bookings_v2 b WHERE b.id=booking_id AND b.student_id=native_lesson_jobs.student_id AND b.status='confirmed')`).run(JSON.stringify({...job.snapshot,authored}),now,job.id,job.attempts,now);
 if(!result.changes)throw Error('paused');
 return authored;
}
