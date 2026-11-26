import {nativeStudentFolder} from '../native-learning/homework-placement.ts';
import {getStudentById} from '../entities.ts';
/** Google is the review surface; SQLite leases and immutable proposals make retries safe. */
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {mkdtemp,rm,readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nativeWorkspace,type NativeWorkspace} from '../learning-archive.ts';
import {learningService} from '../learning-google.ts';
import {centralDriveApi,centralFileUrl,type CentralAccess} from '../central-drive/api.ts';
import {listNativeLessonJobs,getNativeLessonJob} from '../native-learning/jobs.ts';
import {nativeActivitySource} from '../native-learning/activities.ts';
import {reviewNativeCandidate,type NativeValidation,type ReviewImage} from '../native-learning/validation.ts';
import type {VisualLesson} from '../../learning/deck/model.ts';
import * as S from './store.ts';
import * as G from './google.ts';
import {proposeFeedbackFix,checkedFeedbackProposal} from './proposal.ts';

export interface FeedbackSource {fileId:string;title:string;mimeType:string;kind:S.FeedbackArtifact['kind'];parentId:string;bookingId:number|null;version:string;model:string;bundle:VisualLesson}
interface Services {
 enabled:()=>boolean;assertCurrent:()=>void;sources:()=>Promise<FeedbackSource[]>;
 comments:(source:FeedbackSource)=>Promise<S.FeedbackComment[]>;read:(source:FeedbackSource)=>Promise<G.FeedbackSnapshot>;
 sheet:(artifacts:G.FeedbackArtifactRow[],items:G.FeedbackItemRow[])=>Promise<{commands:G.FeedbackSheetCommand[]}>;
 ack:(command:G.FeedbackSheetCommand)=>Promise<void>;
 propose:typeof proposeFeedbackFix;review:typeof reviewNativeCandidate;
 evidence:(source:FeedbackSource,snapshot:G.FeedbackSnapshot,directory:string,targetIds?:string[])=>Promise<ReviewImage[]>;
 apply:(snapshot:G.FeedbackSnapshot,patches:G.FeedbackPatch[])=>Promise<G.FeedbackSnapshot>;
 reply:(source:FeedbackSource,comment:S.FeedbackComment,run:S.FeedbackRun,text:string,resolve:boolean,phase:string)=>Promise<unknown>;
}
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const safeCode=(e:unknown)=>{const c=(e as {kind?:unknown;code?:unknown;message?:unknown})?.kind??(e as {code?:unknown})?.code??(e as Error)?.message;return typeof c==='string'&&/^(?:engine-[a-z-]+|native_review_[a-z_]+|feedback_[a-z_]+|paused|conflict|privacy|ownership|permissions|authorization|quota|api_setup|source_limit|google_response|disabled|disconnected)$/.test(c)?c:'feedback_failed';};
const modelName=()=>process.env.NATIVE_LESSON_MODEL??'gpt-5.6-terra';
const approvalToken=(run:S.FeedbackRun)=>run.id+'.'+run.attempts;
function latest(fileId:string){return S.listFeedbackReviews(fileId)[0]??null;}
const humanError=(code:string)=>code==='api_setup'?'יש להפעיל את ממשקי Google הנדרשים.':code==='feedback_stale_approval'?'האישור התייחס לבדיקה קודמת. יש לעיין בהצעה המעודכנת ולבחור אישור מחדש.':code==='feedback_conflict'?'הקובץ השתנה במהלך הבדיקה. יש להגיש את הגרסה המעודכנת לבדיקה.':code==='engine-quota'?'מכסת המנוע נוצלה. הבקשה נשמרה לניסיון נוסף.':code==='feedback_validation'?'הבודק ביקש תיקונים נוספים; השינוי טרם אושר.':'הטיפול לא הושלם. הבקשה נשמרה לבדיקה נוספת.';
function verificationText(run:S.FeedbackRun|null){if(!run)return '';const final=run.result as any,validation=final?.validation??run.validation,outcome=final?.finalOutcome??validation?.status;return[(outcome==='pass'?'עבר בדיקה עצמאית':outcome==='blocked'||outcome==='revise'?'נדרשים תיקונים':'טרם אומת'),...(run.errorCode?[humanError(run.errorCode)]:[]),...(validation?.findings??[]).map((f:any)=>[f.issue,f.requestedChange].filter(Boolean).join(' — '))].join('\n');}
const commentSignature=(c:S.FeedbackComment)=>hash([c.content,c.quotedText??'',c.location??'',c.author??'',(c.replies??[]).filter(r=>!r.agent).map(r=>({id:r.id,content:r.content,author:r.author??'',deleted:!!r.deleted})).sort((a,b)=>a.id.localeCompare(b.id))]);
function rows(sources:FeedbackSource[],errors:Map<string,string>=new Map()){
 const artifacts:G.FeedbackArtifactRow[]=sources.map(source=>{const artifact=S.getFeedbackArtifact(source.fileId)!,run=latest(source.fileId);return{fileId:source.fileId,title:source.title,url:centralFileUrl({id:source.fileId,name:source.title,mimeType:source.mimeType}),kind:source.kind,sourceVersion:source.version,state:errors.has(source.fileId)&&errors.get(source.fileId)!=='feedback_stale_approval'?'blocked':artifact.state,summary:[errors.has(source.fileId)?humanError(errors.get(source.fileId)!):run?.errorCode?humanError(run.errorCode):'',run?.proposal?.summary??''].filter(Boolean).join(' · '),runId:run?approvalToken(run):'',updatedAt:artifact.updatedAt};});
 for(const policy of S.listFeedbackPolicies()){const run=S.getFeedbackReview(policy.runId),source=run&&(sources.find(s=>s.fileId===run.fileId)??S.getFeedbackArtifact(run.fileId));if(run&&source)artifacts.push({fileId:'policy:'+run.id,title:'כלל לשיעורים עתידיים · '+source.title,url:centralFileUrl({id:source.fileId,name:source.title,mimeType:source.mimeType}),kind:'policy',sourceVersion:run.sourceVersion,state:policy.revokedAt?'revoked':'accepted',summary:policy.guidance,runId:approvalToken(run),updatedAt:run.updatedAt});}
 const items=sources.flatMap(source=>{const run=latest(source.fileId);return S.listFeedbackComments(source.fileId).filter(c=>!c.deleted).map(c=>({id:source.fileId+':'+c.id,fileId:source.fileId,location:c.quotedText??c.location??'כל הקובץ',content:c.content,state:c.resolved?'resolved':run?.state??'collecting',proposal:run?.proposal?[run.proposal.summary,...run.proposal.patches.map(p=>`${p.targetId}: ${p.oldText} → ${p.newText}`),...(run.proposal.policySuggestion?[`הצעה נפרדת לכללי יצירה עתידיים: ${run.proposal.policySuggestion}`]:[])].join('\n'):'',verification:verificationText(run)}));});
 return{artifacts,items};
}
export function feedbackWorkflow(services:Services){
 let active:Promise<void>|null=null;let cursor=0;
 const enabled=()=>{services.assertCurrent();if(!services.enabled())throw Error('disabled');};
 function fence(run:S.FeedbackRun,state:'working'|'applying'){
  enabled();const current=S.getFeedbackReview(run.id),artifact=S.getFeedbackArtifact(run.fileId);
  if(!current||current.state!==state||current.attempts!==run.attempts||!current.leaseUntil||Date.parse(current.leaseUntil)<=Date.now()||artifact?.feedbackHash!==run.feedbackHash||artifact.sourceVersion!==run.sourceVersion||artifact.state==='cancelled')throw Error('paused');
 }
 async function refresh(source:FeedbackSource){enabled();S.ingestFeedbackComments(source.fileId,await services.comments(source));enabled();}
 async function notify(source:FeedbackSource,run:S.FeedbackRun,text:string,resolve=false,customPhase?:string){
  const phase=customPhase??(resolve?'accepted-':'proposal-')+run.attempts,delivery=S.claimFeedbackNotification(run.id,phase);if(!delivery)return;
  const live=new Map((await services.comments(source)).map(c=>[c.id,c]));
  let currentVersion=true;const accepted=run.result as {revision?:string;contentHash?:string}|null;if(resolve&&accepted?.revision){const now=await services.read(source);currentVersion=now.revision===accepted.revision&&now.contentHash===accepted.contentHash;}
  const currentRun=latest(source.fileId)?.id===run.id;
  text=text.slice(0,5400);
  for(const original of run.comments.filter(c=>!c.deleted&&!c.resolved)){const comment=live.get(original.id);if(!comment||comment.deleted)continue;enabled();const unchanged=commentSignature(comment)===commentSignature(original)&&currentVersion&&currentRun;await services.reply(source,comment,run,unchanged?text:text+' נוספו הערות מאז הבדיקה; השרשור נשאר פתוח לבדיקה נוספת.',resolve&&!comment.resolved&&unchanged,phase);}
  S.finishFeedbackNotification(run.id,phase,delivery.attempt);
 }
 async function validate(source:FeedbackSource,snapshot:G.FeedbackSnapshot,proposal:S.FeedbackProposal,comments:S.FeedbackComment[],stage:string){
  const dir=await mkdtemp(join(tmpdir(),'mea-feedback-review-'));
  try{
   const images=await services.evidence(source,snapshot,dir,proposal.patches.map(p=>p.targetId));enabled();
   return await services.review({bundle:source.bundle,model:source.model,images,feedback:comments,context:{stage,nativeSnapshot:snapshot,proposedPatches:proposal.patches,policySuggestion:proposal.policySuggestion??null,scope:source.kind==='sheet'?'future-guidance-only; comment-quotes-not-current-sheet-values; image-is-feedback-context-not-sheet-layout; no-sheet-data-edits':'wording-only-no-quantity-or-diagram-changes'}});
  }finally{await rm(dir,{recursive:true,force:true});}
 }
 async function apply(source:FeedbackSource,run:S.FeedbackRun,command?:G.FeedbackSheetCommand){
  let current=run;let proof:Record<string,unknown>|null=null;
  try{
   await refresh(source);
   current=S.beginFeedbackApply({id:run.id,sourceRevision:run.sourceRevision,contentHash:run.contentHash,leaseMs:30*60_000})!;
   if(!current){if(command&&run.state==='accepted')await services.ack(command);return;}
   if(command)await services.ack(command);
   fence(current,'applying');const proposal=current.proposal!,snapshot=proposal.sourceSnapshot as G.FeedbackSnapshot;
   if(!snapshot||snapshot.fileId!==source.fileId||snapshot.revision!==current.sourceRevision||snapshot.contentHash!==current.contentHash)throw Error('feedback_conflict');
   checkedFeedbackProposal({scope:proposal.scope,patches:proposal.patches,summary:proposal.summary,policySuggestion:proposal.policySuggestion},snapshot);
   const after=proposal.patches.length?await services.apply(snapshot,proposal.patches):await services.read(source);
   fence(current,'applying');
   proof={stage:'applied-native-feedback',revision:after.revision,contentHash:after.contentHash,finalOutcome:'unverified',validation:null};
   const validation=await validate(source,after,proposal,current.comments,'applied-native-feedback');proof={...proof,validation,finalOutcome:validation.status};
   S.recordFeedbackEvidence({id:current.id,attempt:current.attempts,result:proof});
   await refresh(source);const verified=await services.read(source);if(verified.revision!==after.revision||verified.contentHash!==after.contentHash)throw Error('feedback_conflict');fence(current,'applying');
   if(validation.status!=='pass')throw Error('feedback_validation');
   const accepted=S.finishFeedbackApply({id:current.id,attempt:current.attempts,result:{revision:after.revision,contentHash:after.contentHash,validation,editorialParent:current.sourceVersion,policyActive:false,unchangedSheetData:source.kind==='sheet'}});
   if(!accepted)throw Error('paused');
   try{await notify(source,accepted,proposal.patches.length?'השינוי שאושר הוחל ונבדק בידי סוכן בודק חדש. הערות המציג והקישור נשמרו.':'הצעת ההנחיה נבדקה ונשמרה. לא שונו נתוני הקובץ. הפעלת ההנחיה בשיעורים עתידיים דורשת אישור נפרד בגיליון.',proposal.patches.length>0,'accepted-'+accepted.attempts);}catch{/* Delivery retries never downgrade successful native validation. */}
  }catch(e){if(current){if(proof)S.recordFeedbackEvidence({id:current.id,attempt:current.attempts,result:{...proof,finalOutcome:'blocked',errorCode:safeCode(e)}});S.failFeedbackReview({id:current.id,attempt:current.attempts,code:safeCode(e)});}}
 }
 async function cycle(){
  if(!services.enabled())return;enabled();const sources=await services.sources();
  if(sources.length>10000)throw Error('source_limit');const errors=new Map<string,string>();
  for(const source of sources){enabled();S.registerFeedbackArtifact({fileId:source.fileId,title:source.title,mimeType:source.mimeType,kind:source.kind,bookingId:source.bookingId,sourceVersion:source.version});}
  const window=sources.length?Array.from({length:Math.min(50,sources.length)},(_,i)=>sources[(cursor+i)%sources.length]):[];cursor=sources.length?(cursor+window.length)%sources.length:0;
  for(const source of window)try{await refresh(source);}catch(e){errors.set(source.fileId,safeCode(e));}
  const view=rows(sources,errors),control=await services.sheet(view.artifacts,view.items);enabled();
  for(const command of control.commands){
   const policy=/^policy:([1-9]\d*)$/.exec(command.fileId);
   if(policy){const run=S.getFeedbackReview(Number(policy[1]));if(command.command==='revoke-policy'&&run&&command.reviewToken===approvalToken(run)&&S.getFeedbackArtifact(run.fileId)){S.revokeFeedbackPolicy(run.id);await services.ack(command);}continue;}
   const source=sources.find(s=>s.fileId===command.fileId);if(!source)continue;
   try{
    enabled();const run=latest(source.fileId);
    if(command.command!=='ready'&&(!run||command.reviewToken!==approvalToken(run)))throw Error('feedback_stale_approval');
    if(command.command==='ready'){
     const snapshot=await services.read(source);await refresh(source);S.queueFeedbackReview(source.fileId,snapshot.revision,snapshot.contentHash,{retry:true});await services.ack(command);
    }else if(command.command==='changes'){
     if(run)S.rejectFeedbackReview(run.id);await services.ack(command);
    }else if(command.command==='accept'){
     if(!run)continue;await apply(source,run,command);
    }else if(command.command==='accept-policy'){
     if(!run)continue;S.approveFeedbackPolicy(run.id);await services.ack(command);await notify(source,run,'ההנחיה אושרה בנפרד ונוספה לכללי היצירה של שיעורים חדשים. חומרים קיימים ונתוני תלמידים לא הוחלפו.',true,'policy');
    }else if(command.command==='revoke-policy'){
     if(run)S.revokeFeedbackPolicy(run.id);await services.ack(command);
    }
   }catch(e){errors.set(source.fileId,safeCode(e));if(safeCode(e)==='feedback_stale_approval')await services.ack(command);/* A stale acceptance is rejected; the refreshed proposal needs a new human action. */}
  }
  // Resume a crashed, already human-accepted application; provider failures require an explicit retry.
  for(const pending of S.listFeedbackReviews().filter(r=>r.state==='applying'&&r.leaseUntil&&Date.parse(r.leaseUntil)<=Date.now()&&r.attempts<4)){
   const source=sources.find(s=>s.fileId===pending.fileId);if(source)await apply(source,pending);
  }
  for(let count=0;count<5;count++){
   enabled();const run=S.claimFeedbackReview({leaseMs:30*60_000});if(!run)break;
   const source=sources.find(s=>s.fileId===run.fileId);
   if(!source){S.failFeedbackReview({id:run.id,attempt:run.attempts,code:'feedback_source_unavailable'});continue;}
   try{
    const snapshot=await services.read(source);fence(run,'working');
    if(snapshot.revision!==run.sourceRevision||snapshot.contentHash!==run.contentHash)throw Error('feedback_conflict');
    const proposal=await services.propose({snapshot,comments:run.comments,model:source.model});fence(run,'working');
    if(proposal.scope==='generator-change'||!proposal.patches.length&&!proposal.policySuggestion){S.completeFeedbackReview({id:run.id,attempt:run.attempts,proposal:{...proposal,sourceSnapshot:snapshot},validation:{status:'blocked',kind:'requires-generator-change',findings:[{severity:'major',target:source.fileId,issue:proposal.summary,requestedChange:'נדרש שינוי במחולל או בעיצוב ולא תיקון טקסט אוטומטי.'}]}});continue;}
    const validation=await validate(source,snapshot,proposal,run.comments,'proposal');
    await refresh(source);const verified=await services.read(source);if(verified.revision!==snapshot.revision||verified.contentHash!==snapshot.contentHash)throw Error('feedback_conflict');fence(run,'working');
    const done=S.completeFeedbackReview({id:run.id,attempt:run.attempts,proposal:{...proposal,sourceSnapshot:snapshot},validation:validation as unknown as Record<string,unknown>});
    if(done)await notify(source,done,validation.status==='pass'?`הצעה נבדקה בידי סוכן חדש וממתינה לאישור בגיליון. ${proposal.summary}`:`הבודק ביקש תיקון נוסף; הקובץ לא שונה. ${proposal.summary}`);
   }catch(e){const code=safeCode(e);S.failFeedbackReview({id:run.id,attempt:run.attempts,code});if(['engine-auth','engine-quota','engine-missing'].includes(code))break;}
  }
  // Delivery retries use their original phase and historical proposal, never another model call.
  for(const delivery of S.listPendingFeedbackNotifications(50)){
   const run=S.getFeedbackReview(delivery.runId),source=run&&sources.find(s=>s.fileId===run.fileId);if(!run)continue;if(!source){const artifact=S.getFeedbackArtifact(run.fileId);if(artifact?.bookingId!=null&&getNativeLessonJob(artifact.bookingId)?.state==='cancelled'){const obsolete=S.claimFeedbackNotification(run.id,delivery.phase);if(obsolete)S.finishFeedbackNotification(run.id,delivery.phase,obsolete.attempt);}continue;}
   const policy=delivery.phase==='policy',accepted=delivery.phase.startsWith('accepted-'),proposalAttempt=/^proposal-([0-9]+)$/.exec(delivery.phase);
   if(proposalAttempt&&Number(proposalAttempt[1])!==run.attempts){const obsolete=S.claimFeedbackNotification(run.id,delivery.phase);if(obsolete)S.finishFeedbackNotification(run.id,delivery.phase,obsolete.attempt);continue;}
   if(policy&&(run.state!=='accepted'||S.listFeedbackPolicies().find(p=>p.runId===run.id)?.revokedAt)||!policy&&!accepted&&!['awaiting-review','blocked'].includes(run.state)||accepted&&run.state!=='accepted'){const obsolete=S.claimFeedbackNotification(run.id,delivery.phase);if(obsolete)S.finishFeedbackNotification(run.id,delivery.phase,obsolete.attempt);continue;}
   try{await notify(source,run,policy?'ההנחיה אושרה בנפרד לשיעורים עתידיים.':accepted?'השינוי שאושר הוחל ואומת בידי סוכן חדש.':`הצעה מאומתת ממתינה לאישור בגיליון. ${run.proposal?.summary??''}`,policy||accepted&&Boolean(run.proposal?.patches.length),delivery.phase);}catch{/* Retain the delivery claim for bounded retry after lease expiry. */}
  }
  const after=rows(sources,errors);await services.sheet(after.artifacts,after.items);
 }
 return{queue(){if(active)return;active=cycle().catch(()=>{/* Persisted work and human commands survive a temporary Google failure. */}).finally(()=>{active=null;});},async settled(){while(active)await active;}};
}

interface SampleRegistration {version:1;receipt:{reviewFolderId:string;slides:{id:string};homework:{id:string}};source:{bundle:VisualLesson;version:string;model?:string}}
const samplePath=()=>join(process.env.DATA_DIR??'./data','learning-feedback','sample.json');
async function registeredSources(workspace:NativeWorkspace,api?:ReturnType<typeof centralDriveApi>):Promise<FeedbackSource[]>{
 const sources:FeedbackSource[]=[];
 for(const job of listNativeLessonJobs().filter(j=>j.state==='review')){
  const authored=(job.snapshot as any).authored,receipt=job.bundle as any;if(!authored?.bundle||!receipt?.reviewFolderId)continue;
  for(const [kind,file]of [['slides',receipt.slides],['homework',receipt.homework]] as const)if(file?.id)sources.push({fileId:file.id,title:kind==='slides'?'מצגת למורה':'שיעורי בית',mimeType:kind==='slides'?G.FEEDBACK_SLIDES:G.FEEDBACK_DOC,kind,parentId:receipt.reviewFolderId,bookingId:job.bookingId,version:authored.version,model:authored.model??modelName(),bundle:authored.bundle});
 }
 let sample:SampleRegistration|null=null;try{const text=await readFile(samplePath(),'utf8');if(text.length>2_000_000)throw Error('source_limit');sample=JSON.parse(text);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 if(sample?.version===1)for(const[kind,file]of [['slides',sample.receipt.slides],['homework',sample.receipt.homework]] as const)sources.push({fileId:file.id,title:kind==='slides'?'נורמלית · מצגת לבדיקה':'נורמלית · שיעורי בית לבדיקה',mimeType:kind==='slides'?G.FEEDBACK_SLIDES:G.FEEDBACK_DOC,kind,parentId:sample.receipt.reviewFolderId,bookingId:null,version:sample.source.version,model:sample.source.model??modelName(),bundle:sample.source.bundle});
 if(api){const reference=nativeActivitySource('sample');if(reference){const meta=await api.json(`https://www.googleapis.com/drive/v3/files/${workspace.indexId}?fields=id,parents,mimeType`);if(meta.id!==workspace.indexId||meta.mimeType!==G.FEEDBACK_SHEET||meta.parents?.length!==1)throw Error('conflict');sources.push({fileId:workspace.indexId,title:'רישום ההוראה · הערות לשיפור התהליך',mimeType:G.FEEDBACK_SHEET,kind:'sheet',parentId:meta.parents[0],bookingId:null,version:hash(['feedback-index',workspace.indexId]),model:modelName(),bundle:reference.bundle});}}
 return sources;
}
let bootstrap:Promise<SampleRegistration>|null=null;
export function bootstrapFeedbackSample(){return bootstrap??=(createFeedbackSample().finally(()=>{bootstrap=null;}));}
async function createFeedbackSample(){
 const workspace=nativeWorkspace();if(!workspace)throw Error('workspace_unavailable');
 try{return JSON.parse(await readFile(samplePath(),'utf8')) as SampleRegistration;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const source=nativeActivitySource('sample');if(!source)throw Error('source_unavailable');
 const access=learningService().syncAccess();const{publishNativeReviewBundle}=await import('../native-learning/bundle.ts');
 const receipt=await publishNativeReviewBundle({bundle:source.bundle,key:'feedback-sample-'+source.version,title:'נורמלית · משוב',activityBaseUrl:new URL('/app/native-review-activities/sample',process.env.SITE_URL).href},{access,workspace});
 const registration:SampleRegistration={version:1,receipt,source:{bundle:source.bundle,version:source.version,model:source.model}};
 await mkdir(join(process.env.DATA_DIR??'./data','learning-feedback'),{recursive:true,mode:0o700});const temp=samplePath()+'.tmp';await writeFile(temp,JSON.stringify(registration),{mode:0o600});await rename(temp,samplePath());return registration;
}
let singleton:ReturnType<typeof feedbackWorkflow>|undefined;
export function learningFeedbackWorker(){
 if(singleton)return singleton;
 let api:ReturnType<typeof centralDriveApi>,access:CentralAccess,workspace:NativeWorkspace;
 const verify=async(source:FeedbackSource)=>{
  access.assertCurrent();
  const job=source.bookingId===null?null:getNativeLessonJob(source.bookingId);
  if(source.bookingId!==null&&job?.state!=='review')throw Error('paused');
  let parent=source.parentId;
  if(source.kind==='sheet'){
   let child=parent,found=false;
   for(let depth=0;depth<8;depth++){
    if(child===access.config.learningFolderId){found=true;break;}
    const meta=await api.json(`https://www.googleapis.com/drive/v3/files/${child}?fields=id,parents`);
    if(meta.parents?.length!==1)throw Error('conflict');
    await api.privateFolder(child,meta.parents[0]);
    child=meta.parents[0];
   }
   if(!found)throw Error('conflict');
  }else{
   await api.privateFolder(workspace.workspaceId,access.config.learningFolderId);
   await api.privateFolder(workspace.reviewId,workspace.workspaceId);
   await api.privateFolder(parent,workspace.reviewId);
   if(source.kind==='homework'&&job){
    const meta=await api.json(`https://www.googleapis.com/drive/v3/files/${source.fileId}?fields=id,parents`);
    if(meta.parents?.length!==1)throw Error('conflict');
    if(meta.parents[0]!==parent){
     const student=getStudentById(job.studentId);
     if(!student)throw Error('ownership');
     const folder=await nativeStudentFolder(api,access.config.learningFolderId,workspace,student,true);
     if(meta.parents[0]!==folder.id)throw Error('conflict');
     parent=folder.id;
    }
   }
  }
  await G.verifyFeedbackFile(api,source.fileId,parent,access.config.ownerEmail);
 };
 singleton=feedbackWorkflow({
  enabled:()=>process.env.LEARNING_FEEDBACK_ENABLED==='true',assertCurrent(){access?.assertCurrent();if(workspace&&nativeWorkspace()?.archiveId!==workspace.archiveId)throw Error('paused');},
  async sources(){workspace=nativeWorkspace()!;if(!workspace)throw Error('workspace_unavailable');access=learningService().syncAccess();api=centralDriveApi({access,checkpoint:{read:()=>null,write:()=>{}}});await api.prepare();const sources=await registeredSources(workspace,api);const index=sources.find(s=>s.fileId===workspace.indexId&&s.kind==='sheet');if(!index)throw Error('conflict');await verify(index);return sources;},
  async comments(source){await verify(source);return G.listFeedbackComments(api,source.fileId);},async read(source){await verify(source);if(source.kind==='sheet'){const comments=await G.listFeedbackComments(api,source.fileId),targets=comments.filter(c=>!c.deleted&&!c.resolved&&c.quotedText).map(c=>({id:'comment-quote:'+c.id,text:c.quotedText!,kind:'cell' as const,editable:false}));const version=hash(targets);return{fileId:source.fileId,mimeType:source.mimeType,revision:version,contentHash:version,targets};}return G.readFeedbackSnapshot(api,source.fileId,source.mimeType);},
  sheet:(artifacts,items)=>G.syncFeedbackSheet(api,workspace.indexId,artifacts,items),ack:command=>G.ackFeedbackCommand(api,workspace.indexId,command),
  propose:proposeFeedbackFix,review:reviewNativeCandidate,evidence:async(source,snapshot,dir,targetIds)=>{await verify(source);if(source.kind==='sheet'){const text='Human-quoted feedback context; NOT a rendered Sheet. No spreadsheet data may be edited.\n'+snapshot.targets.map(t=>t.text).join('\n');const png=await sharp({text:{text:text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),font:'Heebo 24',fontfile:join(process.cwd(),'static/learning-assets/native-fonts/Heebo.ttf'),width:1200,rgba:true}}).png().toBuffer();const file=join(dir,'quoted-feedback-context.png');await writeFile(file,png,{mode:0o600});return[{name:'quoted-feedback-context-not-sheet-render.png',path:file,sha256:createHash('sha256').update(png).digest('hex')}];}return G.feedbackVisualEvidence(api,snapshot,dir,targetIds);},
  async apply(snapshot,patches){const source=(await registeredSources(workspace,api)).find(s=>s.fileId===snapshot.fileId);if(!source)throw Error('conflict');await verify(source);return G.applyFeedbackPatches(api,snapshot,patches);},
  async reply(source,comment,run,text,resolve,phase){await verify(source);return G.appendReplyOnce(api,source.fileId,comment.id,String(run.id)+'.'+phase,text,{resolve});},
 });return singleton;
}
let timer:ReturnType<typeof setInterval>|undefined;
export function startLearningFeedbackWorker(){if(timer)return;learningFeedbackWorker().queue();timer=setInterval(()=>learningFeedbackWorker().queue(),5*60_000);timer.unref();}
