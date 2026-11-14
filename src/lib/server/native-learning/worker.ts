import {createHash} from 'node:crypto';
import {nativeWorkspace,type NativeWorkspace} from '../learning-archive.ts';
import {learningService} from '../learning-google.ts';
import {centralDriveApi,type CentralAccess} from '../central-drive/api.ts';
import {getStudentById} from '../entities.ts';
import {getPilot} from '../visual-pilot.ts';
import type {VisualLesson} from '../../learning/deck/model.ts';
import {claimNativeLessonJob,getNativeLessonJob,finishNativeLessonJob,failNativeLessonJob,listNativeLessonJobs,reconcileNativeLessonJobs,type NativeLessonJob} from './jobs.ts';
import {supportedNativeContext,NORMAL_REVIEW_CONTEXT} from './context.ts';
import {nativeDraftRecords,appendNativeDraftRecords} from './register.ts';

interface Receipt {version:1;state:'draft';sourceHash:string;reviewFolderId:string;slides:{id:string;url:string;mimeType:string};tutorNotes:{id:string;url:string;mimeType:string};homework:{id:string;url:string;mimeType:string};activities:{id:string;title:string;url:string}[];provenance?:{kind:string;bundleVersion:string;sourceIds:string[];context:typeof NORMAL_REVIEW_CONTEXT}}
interface Options {
 enabled:()=>boolean;workspace:()=>NativeWorkspace|null;access:()=>CentralAccess;
 source:()=>{bundle:VisualLesson;version:string}|null;
 publish:(input:{bundle:VisualLesson;key:string;activityBaseUrl:string},dependencies:{access:CentralAccess;workspace:NativeWorkspace})=>Promise<Receipt>;
 register:(access:CentralAccess,workspace:NativeWorkspace,job:NativeLessonJob,receipt:Receipt)=>Promise<void>;
 activityBaseUrl:()=>string;
}
export const NATIVE_PREPARATION_REASONS:Record<string,string>={
 unsupported_context:'נדרשת הכנת מורה: טרם נקשרו נושא, רמה, משך, ידע קודם ומקור מאומת שמתאימים לחבילה הנתמכת.',
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
   const workspace=options.workspace();if(!workspace){finish('workspace_unavailable');return;}
   if(listNativeLessonJobs({studentId:job.studentId}).some(previous=>previous.id!==job.id&&previous.state==='review')){finish('repeated_source');return;}
   const source=options.source();if(!source){finish('source_unavailable');return;}
   const rawAccess=options.access(),access={...rawAccess,assertCurrent(){check();rawAccess.assertCurrent();if(!options.enabled()||options.workspace()?.archiveId!==workspace.archiveId)throw Error('paused');}};
   access.assertCurrent();
   const key=`booking-${job.bookingId}-student-${job.studentId}-${createHash('sha256').update(source.version).digest('hex').slice(0,20)}`;
   const published=await options.publish({bundle:source.bundle,key,activityBaseUrl:options.activityBaseUrl()},{access,workspace});
   const receipt={...published,provenance:{kind:'tutor-selected-calibration',bundleVersion:source.version,sourceIds:[NORMAL_REVIEW_CONTEXT.sourceId],context:NORMAL_REVIEW_CONTEXT}};
   access.assertCurrent();
   await options.register(access,workspace,job,receipt);
   access.assertCurrent();
   finishNativeLessonJob({bookingId:job.bookingId,attempt:job.attempts,state:'review',bundle:{...receipt,studentDelivery:'blocked-owner-review-required'}});
  }catch(e){
   const code=e instanceof Error?e.message:'';
   const safe=['authorization','permissions','ownership','privacy','conflict','api_setup','quota','disconnected','disabled','paused','source_limit','native_register_schema'].includes(code)?code:'native_preparation_failed';
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
 enabled:()=>process.env.NATIVE_LESSON_AUTHORING_ENABLED==='true',workspace:nativeWorkspace,access:()=>learningService().syncAccess(),source:getPilot,
 activityBaseUrl:()=>new URL('/app/native-review-activities',process.env.SITE_URL).href,
 async publish(input,dependencies){const{publishNativeReviewBundle}=await import('./bundle.ts');return publishNativeReviewBundle(input,dependencies);},
 async register(access,workspace,job,receipt){
  const student=getStudentById(job.studentId);if(!student)throw Error('ownership');
  const api=centralDriveApi({access,checkpoint:{read:()=>null,write:()=>{}}});
  await api.prepare();
  const index=await api.json(`https://www.googleapis.com/drive/v3/files/${workspace.indexId}?fields=id,mimeType,owners(emailAddress),permissions(type),trashed,appProperties`);
  if(index.id!==workspace.indexId||index.mimeType!=='application/vnd.google-apps.spreadsheet'||index.trashed||index.appProperties?.meaCentralScope!==api.scope||!index.owners?.some((o:{emailAddress?:string})=>o.emailAddress?.toLowerCase()===access.config.ownerEmail.toLowerCase()))throw Error('ownership');
  if(!Array.isArray(index.permissions)||index.permissions.some((p:{type?:string})=>!['user','group'].includes(p.type??'')))throw Error('privacy');
  await appendNativeDraftRecords(api,workspace.indexId,nativeDraftRecords(job,receipt,student.name));
 },
});}
export function queueNativeLessonWork(){nativeLearningWorker().queue();}
let timer:ReturnType<typeof setInterval>|undefined;
export function startNativeLessonWorker(){if(timer)return;queueNativeLessonWork();timer=setInterval(queueNativeLessonWork,30_000);timer.unref();}
