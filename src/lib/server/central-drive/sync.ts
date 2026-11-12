/** One process-wide worker. Drive holds content; this file keeps only retry state. */
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync,mkdirSync,unlinkSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {learningService} from '../learning-google.ts';
import {centralDriveApi,artifactCategory,centralFileUrl,type CentralAccess,type UploadCheckpoint} from './api.ts';
import {writeCentralIndex,type IndexCell} from './index.ts';
import type {LearningInventory} from './source.ts';

export const SYNC_ERRORS:Record<string,string>={
 authorization:'ההרשאה ב־Google דורשת חיבור מחדש.',permissions:'אין הרשאה לאחד הקבצים. בדקו את הגישה בחשבון האישי.',
 ownership:'החשבון או מיקום התיקייה השתנו. בדקו את החיבור.',privacy:'לתיקיית הלמידה יש גישה ציבורית. הסנכרון נעצר כדי להגן על המידע.',
 conflict:'קובץ או לשונית מנוהלים הועברו, נערכו או שוכפלו ב־Drive. הסנכרון נעצר כדי לשמור על השינויים.',
 api_setup:'יש להפעיל את Drive API ואת Sheets API בפרויקט Google של החיבור.',quota:'Google מגביל כרגע את הקצב או האחסון. אפשר לנסות שוב בהמשך.',
 source_changed:'החומרים השתנו בזמן הקריאה. אפשר לנסות שוב.',source_schema:'מבנה נתוני הלמידה דורש בדיקה בשרת.',source_path:'לא ניתן לקרוא בבטחה את אחד מנתיבי החומרים.',
 source_limit:'כמות הנתונים חורגת ממגבלות הסנכרון. נדרשת בדיקה בשרת.',storage:'לא ניתן לשמור את מצב הסנכרון בצורה מאובטחת.',
 setup:'חיבור האחסון עדיין לא הוגדר בשרת.',disconnected:'יש לחבר פעם אחת את חשבון האחסון האישי.',
 google:'הסנכרון מול Google לא הושלם. חומרים שכבר נשמרו יישמרו לניסיון הבא.',
};
export class CentralStorageSelected extends Error {constructor(){super('central storage selected');}}
type Phase='idle'|'running'|'complete'|'failed'|'paused';
interface State {version:1;selected:boolean;scope?:string;runId?:string|null;phase:Phase;stage:string;startedAt?:string;lastSuccess?:string;done:number;total:number;uploaded:number;reused:number;students:number;error?:string|null;indexUrl?:string;fingerprint?:string;pending?:UploadCheckpoint|null}
interface Service {status:()=>{state:string;account:string;folderUrl?:string;automaticSyncEnabled:boolean};syncAccess:()=>CentralAccess;setAutomaticSync:(enabled:boolean)=>Promise<unknown>}
const empty=():State=>({version:1,selected:false,phase:'idle',stage:'',done:0,total:0,uploaded:0,reused:0,students:0});
function load(path:string):State{
 try{const raw=readFileSync(path,'utf8');if(raw.length>65536)throw Error();const value=JSON.parse(raw);if(value.version!==1||!['idle','running','complete','failed','paused'].includes(value.phase)||typeof value.selected!=='boolean')throw Error();return value;}
 catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return empty();throw Error('storage');}
}
function persist(path:string,state:State){
 const temporary=`${path}.${randomUUID()}.tmp`;
 try{mkdirSync(dirname(path),{recursive:true,mode:0o700});writeFileSync(temporary,JSON.stringify(state),{mode:0o600,flag:'wx'});renameSync(temporary,path);}
 catch{try{unlinkSync(temporary);}catch{}throw Error('storage');}
}
export function centralSyncController(options:{path:string;service:()=>Service;inventory:()=>Promise<LearningInventory>;fetch?:typeof fetch}){
 let active:Promise<void>|null=null,activeEpoch:string|null=null,requeue=false;
 function view(){
  let state:State;try{state=load(options.path);}catch{return{...empty(),phase:'failed' as Phase,configured:true,connected:false,enabled:false,account:null,folderUrl:null,error:'storage',message:SYNC_ERRORS.storage};}
  const{pending,scope,runId,fingerprint,selected,version,...publicState}=state;
  try{
   const connection=options.service().status(),access=connection.automaticSyncEnabled?options.service().syncAccess():null;
   // Folder identity is public configuration; tokens and upload URLs never leave the server.
   const config=access?.config;
   return{...publicState,configured:true,connected:connection.state!=='disconnected',enabled:connection.automaticSyncEnabled,account:connection.account,folderUrl:connection.folderUrl??(config?`https://drive.google.com/drive/folders/${config.learningFolderId}`:null),message:state.error?SYNC_ERRORS[state.error]??SYNC_ERRORS.google:null};
  }catch(e){const reason=e instanceof Error&&SYNC_ERRORS[e.message]?e.message:'setup';return{...publicState,configured:reason!=='setup',connected:false,enabled:false,account:null,folderUrl:null,error:reason,message:SYNC_ERRORS[reason]};}
 }
 async function work(access:CentralAccess,id:string){
  const check=()=>{access.assertCurrent();if(load(options.path).runId!==id)throw Error('paused');};
  function update(patch:Partial<State>){check();persist(options.path,{...load(options.path),...patch});}
  try{
   const api=centralDriveApi({access,fetch:options.fetch,checkpoint:{read:()=>load(options.path).pending??null,write:value=>update({pending:value})}});
   const previous=load(options.path);update({scope:api.scope,...(previous.scope&&previous.scope!==api.scope?{pending:null,indexUrl:undefined,lastSuccess:undefined}:{}),stage:'connecting'});
   await api.prepare();check();update({stage:'reading'});
   const inventory=await options.inventory();check();update({total:inventory.artifacts.length,stage:'uploading'});
   const root=await api.folder('site','Website sync',access.config.learningFolderId);
   const library=await api.folder('library','Library',root.id),studentsFolder=await api.folder('students','Students',root.id);
   const index=await api.register(root.id),materials:IndexCell[][]=[],students:IndexCell[][]=[];
   const artifacts=[...inventory.artifacts],pending=load(options.path).pending;
   // Finish the persisted media upload before a new folder can claim the checkpoint.
   artifacts.sort((a,b)=>Number(api.artifactCheckpointKey(b)===pending?.key)-Number(api.artifactCheckpointKey(a)===pending?.key));
   const categories=new Map<string,string>();
   for(const artifact of artifacts){
    check();const category=artifactCategory(artifact);
    if(!categories.has(category))categories.set(category,(await api.folder(`category:${category}`,category,library.id)).id);
    const saved=await api.blob(artifact,categories.get(category)!);
    materials.push([artifact.key,artifact.role,artifact.lesson,artifact.version,artifact.name,[...artifact.folders,artifact.name].join('/'),artifact.sha256,artifact.size,{text:'פתיחת הקובץ',url:centralFileUrl(saved.file)}]);
    const s=load(options.path);update({done:s.done+1,reused:s.reused+Number(saved.reused),uploaded:s.uploaded+Number(!saved.reused)});
   }
   update({stage:'profiles'});
   for(const student of inventory.students){
    check();const folder=await api.folder(`student:${student.id}`,student.name,studentsFolder.id),profile=await api.profile(student,folder.id,index.file.id);
    students.push([student.id,student.name,student.subjects,student.goals,student.progress,student.progress_note,{text:'פרופיל לעריכה',url:centralFileUrl(profile.file)},{text:'תיקיית תלמיד/ה',url:centralFileUrl(folder)}]);
    update({students:load(options.path).students+1});
   }
   update({stage:'index'});
   materials.sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
   await writeCentralIndex(api,index.file.id,{students,materials,progress:inventory.progress});
   update({phase:'complete',stage:'',lastSuccess:new Date().toISOString(),error:null,runId:null,indexUrl:centralFileUrl(index.file),fingerprint:inventory.fingerprint,pending:null});
  }catch(e){
   const state=load(options.path);if(state.runId!==id)return;
   const reason=e instanceof Error?e.message:'google';
   persist(options.path,{...state,phase:reason==='paused'?'paused':'failed',stage:'',runId:null,error:reason==='paused'?null:SYNC_ERRORS[reason]?reason:'google'});
  }
 }
 function queue(){
  const connection=options.service().status();if(!connection.automaticSyncEnabled)return view();
  const access=options.service().syncAccess();
  if(active){if(activeEpoch!==access.epoch)requeue=true;return view();}
  const state=load(options.path),id=randomUUID();
  persist(options.path,{...state,selected:true,runId:id,phase:'running',stage:'connecting',startedAt:new Date().toISOString(),done:0,total:0,students:0,uploaded:0,reused:0,error:null});
  activeEpoch=access.epoch;
  active=work(access,id).catch(()=>{/* No provider details or learner data in logs. */}).finally(()=>{active=null;activeEpoch=null;if(requeue){requeue=false;try{queue();}catch{}}});
  return view();
 }
 async function setEnabled(enabled:boolean){
  await options.service().setAutomaticSync(enabled);
  const state=load(options.path);persist(options.path,{...state,selected:true,runId:null,phase:enabled?'idle':'paused',stage:'',error:null});
  if(enabled)queue();return view();
 }
 return{view,queue,setEnabled,async settled(){while(active)await active;}};
}

let controller:ReturnType<typeof centralSyncController>|undefined;
const statePath=()=>join(process.env.DATA_DIR??'./data','.credentials','central-learning-sync.json');
export function centralLearningSync(){return controller??=centralSyncController({path:statePath(),service:learningService,inventory:async()=>{const{learningInventory}=await import('./source.ts');return learningInventory();}});}
/** A revoked/misconfigured central connection must not revive business storage. */
export function centralStorageSelected(){
 try{if(load(statePath()).selected)return true;return learningService().centralSelected();}
 catch{return existsSync(join(process.env.DATA_DIR??'./data','.credentials','learning-google.json'))||existsSync(statePath());}
}
export function queueCentralSync(){try{return centralLearningSync().queue();}catch{return centralLearningSync().view();}}
