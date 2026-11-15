import{createHash}from'node:crypto';
import{mkdtemp,rm}from'node:fs/promises';
import{tmpdir}from'node:os';
import{join}from'node:path';
import{handle}from'../db.ts';
import type{VisualLesson}from'../../learning/deck/model.ts';
import{nativeReviewRules}from'../../learning/deck/review-rules.ts';
import rendererManifest from'./renderer-manifest.json'with{type:'json'};
import{authorNativeLesson,currentAuthoringJob,type AuthoredLesson,type NativeRepairFeedback}from'./authoring.ts';
import type{NativeLessonJob}from'./jobs.ts';
import{reviewNativeCandidate,type NativeValidation,type ReviewImage}from'./validation.ts';
export interface PreparationReviewDependencies{
 generate?:(job:NativeLessonJob,reviewFeedback?:NativeRepairFeedback)=>Promise<AuthoredLesson>;
 render?:(bundle:VisualLesson,directory:string)=>Promise<ReviewImage[]>;
 review?:typeof reviewNativeCandidate;
 rendererHash?:string;reviewRulesHash?:string;
}
interface ValidationBinding{version:1;contentHash:string;evidenceHash:string;rendererHash:string;reviewRulesHash:string;contextHash:string}
const checks=['mathCorrect','studentAnswersHidden','teachingClear','brandConsistent','visualEvidenceReviewed','feedbackAddressed']as const;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const digest=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function validReport(report:NativeValidation,candidate:AuthoredLesson,images?:ReviewImage[]){
 if(!report||report.version!==1||!['pass','revise','blocked'].includes(report.status)||report.contentHash!==candidate.version||report.model!==candidate.model||report.provider!=='openai'||report.session!=='fresh'||![report.contentHash,report.rulesHash,report.evidenceHash].every(digest)||!Array.isArray(report.findings)||!Array.isArray(report.reviewedImages)||new Set(report.reviewedImages).size!==report.reviewedImages.length||!report.checks||checks.some(k=>typeof report.checks[k]!=='boolean'))throw Error('native_review_invalid');
 if(report.status==='pass'&&(checks.some(k=>!report.checks[k])||report.findings.some(f=>f.severity!=='minor')||!report.reviewedImages.length||images&&(images.length!==report.reviewedImages.length||images.some(i=>!report.reviewedImages.includes(i.name)))))throw Error('native_review_invalid');
}
function submission(current:NativeLessonJob,candidate:AuthoredLesson){
 const snapshot=current.snapshot as any,repair=snapshot.reviewRepair;
 const feedback=repair?.parentVersion&&repair.parentVersion!==candidate.version?(repair.findings??[]):[];
 const context={brief:snapshot.brief??null,acceptedGuidance:snapshot.authoringPolicy??null};
 return{context,feedback,contextHash:hash(JSON.stringify({context,feedback}))};
}
function bindingMatches(binding:ValidationBinding|undefined,report:NativeValidation,contextHash:string){return !!binding&&binding.version===1&&binding.contentHash===report.contentHash&&binding.evidenceHash===report.evidenceHash&&binding.reviewRulesHash===report.rulesHash&&binding.contextHash===contextHash&&digest(binding.rendererHash);}
function saveReport(job:NativeLessonJob,candidate:AuthoredLesson,report:NativeValidation,binding:ValidationBinding){
 const now=new Date().toISOString();
 const saved=handle().prepare(`UPDATE native_lesson_jobs SET snapshot=json_set(snapshot,'$.validation',json(?),'$.validationBinding',json(?)),updated_at=? WHERE id=? AND state='preparing' AND attempts=? AND lease_until>? AND json_extract(snapshot,'$.authored.version')=? AND EXISTS(SELECT 1 FROM bookings_v2 b WHERE b.id=booking_id AND b.student_id=native_lesson_jobs.student_id AND b.status='confirmed')`).run(JSON.stringify(report),JSON.stringify(binding),now,job.id,job.attempts,now,candidate.version);
 if(!saved.changes)throw Error('paused');
}
/** Creator -> independent fresh reviewer -> at most one creator repair. No publication happens here. */
export async function prepareReviewedNativeLesson(job:NativeLessonJob,deps:PreparationReviewDependencies={}):Promise<AuthoredLesson>{
 const rendererHash=deps.rendererHash??rendererManifest.rendererHash,reviewRulesHash=deps.reviewRulesHash??hash(nativeReviewRules());
 if(!digest(rendererHash)||!digest(reviewRulesHash))throw Error('native_review_invalid');
 const generate=deps.generate??((current,feedback)=>authorNativeLesson(current,undefined,undefined,feedback));
 let current=currentAuthoringJob(job),candidate=(current.snapshot as any).authored as AuthoredLesson|undefined;
 if(!candidate)candidate=await generate(current);
 for(let round=0;round<2;round++){
  current=currentAuthoringJob(job);
  if((current.snapshot as any).authored?.version!==candidate.version||candidate.version!==hash(JSON.stringify(candidate.bundle))||!candidate.model)throw Error('native_review_invalid');
  let report=(current.snapshot as any).validation as NativeValidation|undefined;
  const binding=(current.snapshot as any).validationBinding as ValidationBinding|undefined,submitted=submission(current,candidate),pending=(current.bundle as any)?.pendingPublication;
  if(pending&&pending.sourceVersion!==candidate.version)throw Error('native_review_invalid');
  if(report?.contentHash!==candidate.version)report=undefined;
  if(report)validReport(report,candidate);
  const bound=report&&bindingMatches(binding,report,submitted.contextHash);
  // An upgrade may re-render an unpublished candidate, but must never approve new visuals for already sealed old files.
  if(pending){if(report?.status==='pass'&&bound)return{...candidate,validation:report};throw Error('native_review_blocked');}
  if(!bound||binding?.rendererHash!==rendererHash||binding.reviewRulesHash!==reviewRulesHash)report=undefined;
  if(!report){
   const directory=await mkdtemp(join(tmpdir(),'mea-preparation-review-'));
   try{
    const render=deps.render??(async(bundle,dir)=>{const{exportNativeBundle}=await import('./bundle.ts');const{renderStudentEvidence}=await import('./player-evidence.ts');const native=await exportNativeBundle({bundle,activityBaseUrl:new URL(`/app/native-review-activities/${job.bookingId}`,process.env.SITE_URL).href},{evidenceDirectory:join(dir,'native')});return[...native.reviewImages,...await renderStudentEvidence(bundle,join(dir,'student'))];});
    const images=await render(candidate.bundle,directory);
    current=currentAuthoringJob(job);
    if(submission(current,candidate).contextHash!==submitted.contextHash)throw Error('paused');
    report=await(deps.review??reviewNativeCandidate)({bundle:candidate.bundle,model:candidate.model,images,context:submitted.context,feedback:submitted.feedback});
    validReport(report,candidate,images);if(report.rulesHash!==reviewRulesHash)throw Error('native_review_invalid');
    if(submission(currentAuthoringJob(job),candidate).contextHash!==submitted.contextHash)throw Error('paused');
    saveReport(job,candidate,report,{version:1,contentHash:candidate.version,evidenceHash:report.evidenceHash,rendererHash,reviewRulesHash,contextHash:submitted.contextHash});
   }catch(e){
    const error=e as {kind?:string;message?:string;meta?:{taskId?:string;state?:string;surface?:string;viewport?:number}};
    const kind=error.kind??error.message??'';
    if(/^native_player_[a-z_]+$/.test(kind)||kind==='native_text_overflow'){
     const current=currentAuthoringJob(job),meta=error.meta??{},diagnostic={kind,contentHash:candidate.version,rendererHash,checkedBy:'deterministic-renderer',target:typeof meta.taskId==='string'?meta.taskId.slice(0,200):'lesson',state:typeof meta.state==='string'?meta.state.slice(0,80):null,viewport:Number.isFinite(meta.viewport)?meta.viewport:null};
     const saved=handle().prepare(`UPDATE native_lesson_jobs SET snapshot=json_set(snapshot,'$.validationDiagnostics',json(?)) WHERE id=? AND state='preparing' AND attempts=? AND lease_until>? AND json_extract(snapshot,'$.authored.version')=?`).run(JSON.stringify(diagnostic),job.id,current.attempts,new Date().toISOString(),candidate.version);
     if(!saved.changes)throw Error('paused');
    }
    throw e;
   }finally{await rm(directory,{recursive:true,force:true});}
  }
  if(report.status==='pass')return{...candidate,validation:report};
  if(report.status==='blocked')throw Error('native_review_blocked');
  current=currentAuthoringJob(job);
  if(((current.snapshot as any).reviewRepair?.count??0)>=1||round===1)throw Error('native_review_revise');
  candidate=await generate(current,{parentVersion:candidate.version,findings:report.findings});
 }
 throw Error('native_review_revise');
}
