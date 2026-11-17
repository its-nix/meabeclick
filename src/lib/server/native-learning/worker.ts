import {createHash} from 'node:crypto';
import {nativeWorkspace,type NativeWorkspace} from '../learning-archive.ts';
import {learningService} from '../learning-google.ts';
import {centralDriveApi,centralFileUrl,type CentralAccess} from '../central-drive/api.ts';
import {getStudentById,enrollmentsForStudent} from '../entities.ts';
import {type AuthoredLesson} from './authoring.ts';
import {prepareReviewedNativeLesson} from './preparation-review.ts';
import type {VisualLesson} from '../../learning/deck/model.ts';
import {claimNativeLessonJob,cacheNativePublication,getNativeLessonJob,finishNativeLessonJob,failNativeLessonJob,listNativeLessonJobs,reconcileNativeLessonJobs,type NativeLessonJob} from './jobs.ts';
import {supportedNativeContext,NORMAL_REVIEW_CONTEXT} from './context.ts';
import {nativeDraftRecords,appendNativeDraftRecords,validateNativeDraftFiles,writeNativeGamesFile} from './register.ts';

interface Receipt {version:1;state:'draft';sourceHash:string;reviewFolderId:string;slides:{id:string;url:string;mimeType:string};notesLocation?:'slides';tutorNotes?:{id:string;url:string;mimeType:string};homework:{id:string;url:string;mimeType:string};activities:{id:string;title:string;url:string}[];provenance?:{kind:string;bundleVersion:string;sourceIds:string[];context:Record<string,unknown>;generation?:Omit<AuthoredLesson,'bundle'>}}
interface Options {
 enabled:()=>boolean;workspace:()=>NativeWorkspace|null;access:()=>CentralAccess;
 source:()=>{bundle:VisualLesson;version:string}|null;
 generate?:(job:NativeLessonJob)=>Promise<AuthoredLesson>;
 publish:(input:{bundle:VisualLesson;key:string;activityBaseUrl:string},dependencies:{access:CentralAccess;workspace:NativeWorkspace})=>Promise<Receipt>;
 register:(access:CentralAccess,workspace:NativeWorkspace,job:NativeLessonJob,receipt:Receipt,bundle?:VisualLesson)=>Promise<void>;
 activityBaseUrl:()=>string;
}
export const NATIVE_PREPARATION_REASONS:Record<string,string>={
 unsupported_context:'נדרשת הכנת מורה: טרם נקשרו נושא, רמה, משך, ידע קודם ומקור מאומת שמתאימים לחבילה הנתמכת.',
 missing_brief:'יש להשלים את מטרת השיעור ותיאור הידע הקודם לפני יצירה חדשה.',
 authoring_disabled:'היצירה החדשה ממתינה לבדיקת איכות של חבילת הניסוי. נדרשת הכנת מורה.',
 workspace_unavailable:'מרחב ההוראה החדש עדיין אינו זמין. נדרשת הכנת מורה.',
 source_unavailable:'חבילת המקור המאומתת אינה זמינה. נדרשת הכנת מורה.',
 repeated_source:'לתלמיד/ה כבר הוכנה חבילת מבוא ממקור זה. יש להכין שיעור המשך ולבדוק שימוש חוזר בשאלה.',
};
/** A single serial drain per process. SQLite leases fence competing/restarted workers. */
export function nativeLessonWorker(options:Options){
 let active:Promise<void>|null=null;
 async function run(job:NativeLessonJob){
  const finish=(reason:string)=>finishNativeLessonJob({bookingId:job.bookingId,attempt:job.attempts,state:'needs-preparation',reason});
  const check=()=>{const current=getNativeLessonJob(job.bookingId);if(current?.state!=='preparing'||current.attempts!==job.attempts||!current.leaseUntil||Date.parse(current.leaseUntil)<=Date.now())throw Error('paused');};
  try{
   check();
   if(!supportedNativeContext(job.snapshot)){finish('unsupported_context');return;}
   if(!options.enabled()){finish('authoring_disabled');return;}
   if(options.generate&&(job.snapshot.brief?.readiness!=='tutor-reported'||!job.snapshot.brief.request?.trim()||!job.snapshot.brief.priorKnowledge?.trim()||job.snapshot.brief.missing.length)){finish('missing_brief');return;}
   const workspace=options.workspace();if(!workspace){finish('workspace_unavailable');return;}
   if(listNativeLessonJobs({studentId:job.studentId}).some(previous=>previous.id!==job.id&&previous.state==='review')){finish('repeated_source');return;}
   const rawAccess=options.access(),access={...rawAccess,assertCurrent(){check();rawAccess.assertCurrent();if(!options.enabled()||options.workspace()?.archiveId!==workspace.archiveId)throw Error('paused');}};
   access.assertCurrent();
   const source=options.generate?await options.generate(job):options.source();if(!source){finish('source_unavailable');return;}
   access.assertCurrent();
   const key=`booking-${job.bookingId}-student-${job.studentId}-${createHash('sha256').update(source.version).digest('hex').slice(0,20)}`;
   const pending=(job.bundle as {pendingPublication?:{receipt:Receipt;sourceVersion:string;archiveId:string}}|null)?.pendingPublication;
   if(pending&&(pending.sourceVersion!==source.version||pending.archiveId!==workspace.archiveId))throw Error('conflict');
   const published=pending?.receipt??await options.publish({bundle:source.bundle,key,activityBaseUrl:options.generate?`${options.activityBaseUrl()}/${job.bookingId}`:options.activityBaseUrl()},{access,workspace});
   const receipt={...published,provenance:{kind:options.generate?'fresh-booking-generation':'tutor-selected-calibration',bundleVersion:source.version,sourceIds:[NORMAL_REVIEW_CONTEXT.sourceId],context:{...NORMAL_REVIEW_CONTEXT,readiness:job.snapshot.brief?.readiness==='tutor-reported'?'tutor-reported':NORMAL_REVIEW_CONTEXT.readiness},...(options.generate?{generation:{version:source.version,model:(source as AuthoredLesson).model,rulesHash:(source as AuthoredLesson).rulesHash,contextHash:(source as AuthoredLesson).contextHash,cliVersion:(source as AuthoredLesson).cliVersion,authoringFingerprint:(source as AuthoredLesson).authoringFingerprint,sources:(source as AuthoredLesson).sources,feedbackPolicyHash:(source as AuthoredLesson).feedbackPolicyHash,validation:(source as AuthoredLesson).validation}}:{})}};
   access.assertCurrent();
   if(!pending&&!cacheNativePublication({bookingId:job.bookingId,attempt:job.attempts,publication:{receipt,sourceVersion:source.version,archiveId:workspace.archiveId}}))throw Error('paused');
   await options.register(access,workspace,job,receipt,source.bundle);
   access.assertCurrent();
   finishNativeLessonJob({bookingId:job.bookingId,attempt:job.attempts,state:'review',bundle:{...receipt,studentDelivery:'blocked-owner-review-required'}});
  }catch(e){
   const code=e instanceof Error?(typeof (e as Error&{kind?:unknown}).kind==='string'?String((e as Error&{kind:string}).kind):e.message):'';
   const safe=['authorization','permissions','ownership','privacy','conflict','api_setup','quota','disconnected','disabled','paused','source_limit','native_register_schema','engine-quota','engine-auth','engine-missing','engine-timeout','bad-output','native_authoring_invalid','engine-failed','native_review_revise','native_review_blocked','native_review_invalid','native_review_repair_limit','native_review_failed','native_review_evidence','native_review_input','native_authoring_locked','native_feedback_policy_limit'].includes(code)||/^native_player_[a-z_]+$/.test(code)||code==='native_text_overflow'?code:'native_preparation_failed';
   failNativeLessonJob({bookingId:job.bookingId,attempt:job.attempts,code:safe,retryable:['quota','native_preparation_failed','paused'].includes(safe)});
  }
 }
 function queue(){
  if(active)return;
  active=(async()=>{reconcileNativeLessonJobs();for(let count=0;count<100;count++){const job=claimNativeLessonJob({leaseMs:60*60_000});if(!job)break;await run(job);}})().catch(()=>{/* Durable queue survives a transient local failure. */}).finally(()=>{active=null;});
 }
 return{queue,async settled(){while(active)await active;}};
}
let worker:ReturnType<typeof nativeLessonWorker>|undefined;
export function nativeLearningWorker(){return worker??=nativeLessonWorker({
 enabled:()=>process.env.NATIVE_LESSON_AUTHORING_ENABLED==='true',workspace:nativeWorkspace,access:()=>learningService().syncAccess(),source:()=>null,generate:prepareReviewedNativeLesson,
 activityBaseUrl:()=>new URL('/app/native-review-activities',process.env.SITE_URL).href,
 async publish(input,dependencies){const{publishNativeReviewBundle}=await import('./bundle.ts');return publishNativeReviewBundle(input,dependencies);},
 async register(access,workspace,job,receipt,bundle){
  const student=getStudentById(job.studentId);if(!student)throw Error('ownership');
  const api=centralDriveApi({access,checkpoint:{read:()=>null,write:()=>{}}});
  await api.prepare();
  await validateNativeDraftFiles(api,workspace,receipt,access.config);
  const index=await api.json(`https://www.googleapis.com/drive/v3/files/${workspace.indexId}?fields=id,mimeType,owners(emailAddress),permissions(type),trashed,appProperties`);
  if(index.id!==workspace.indexId||index.mimeType!=='application/vnd.google-apps.spreadsheet'||index.trashed||index.appProperties?.meaCentralScope!==api.scope||!index.owners?.some((o:{emailAddress?:string})=>o.emailAddress?.toLowerCase()===access.config.ownerEmail.toLowerCase()))throw Error('ownership');
  if(!Array.isArray(index.permissions)||index.permissions.some((p:{type?:string})=>!['user','group'].includes(p.type??'')))throw Error('privacy');
  const site=await api.folder('site','02 תלמידים ומעקב',access.config.learningFolderId);
  const students=await api.folder('students','02 תיקי תלמידים',site.id);
  if(students.id!==workspace.studentsId)throw Error('conflict');
  const folder=await api.folder(`student:${student.id}`,student.name,students.id);
  const profile=await api.profile({id:student.id,code:student.code,name:student.name,goals:student.goals,style:student.style,notes:student.notes,progress:student.progress,progress_note:student.progress_note,subjects:enrollmentsForStudent(student.id).map(e=>e.subject).join(', ')},folder.id,workspace.indexId);
  const gamesFile=bundle?await writeNativeGamesFile(api,receipt.reviewFolderId,bundle,job.bookingId):null;
  await appendNativeDraftRecords(api,workspace.indexId,nativeDraftRecords(job,receipt,student.name,{profileUrl:centralFileUrl(profile.file),folderUrl:centralFileUrl(folder)},gamesFile));
 },
});}
export function queueNativeLessonWork(){nativeLearningWorker().queue();}
let timer:ReturnType<typeof setInterval>|undefined;
export function startNativeLessonWorker(){if(timer)return;queueNativeLessonWork();timer=setInterval(queueNativeLessonWork,30_000);timer.unref();}
