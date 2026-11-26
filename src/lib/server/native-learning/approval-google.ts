import {workspaceTables,workspaceHeader,type WorkspaceCell} from '../../learning/workspace.ts';
import {syncNativeGameApprovals,type ApprovalSheet} from './approval-sync.ts';
import type {GamesDrive} from './games.ts';
import {appendNativeResultsToProgress,type ProgressSheet,type NativeResult} from './results.ts';
import {handle} from '../db.ts';
import {syncHomeworkShares} from './homework-share.ts';
import {homeworkDeliveryPermissions} from '../central-drive/share.ts';
import {nativeStudentFolder,placeHomeworkDoc} from './homework-placement.ts';
import {getStudentById} from '../entities.ts';
import type {HomeworkShareApi} from './homework-share.ts';
import {SHEET} from '../central-drive/api.ts';

/** The slice of the central Drive client these adapters need (centralDriveApi satisfies it). */
export interface GoogleApi {scope:string;ownerEmail:string;json:(url:string,init?:RequestInit)=>Promise<any>;request:(url:string,init?:RequestInit,allowed?:number[])=>Promise<Response>}
const FILES='https://www.googleapis.com/drive/v3/files',ID=/^[\w-]{10,}$/;
const MAX_BYTES=512*1024,RANGE_ROWS=5002;
const fail=(code:string):never=>{throw new Error(code);};

/** Reads only JSON games files this site created (scope marker) and owns, never a file someone else shared in. */
export function googleGamesDrive(api:GoogleApi):GamesDrive {
 return {async read(fileId){
  if(!ID.test(fileId))fail('games_file_invalid: id');
  const meta=await api.json(`${FILES}/${fileId}?fields=id,mimeType,size,version,headRevisionId,trashed,owners(emailAddress),appProperties&supportsAllDrives=false`);
  if(meta.id!==fileId||meta.trashed||meta.mimeType!=='application/json'||meta.appProperties?.meaCentralScope!==api.scope)fail('games_file_invalid: file');
  if(!meta.owners?.some((o:{emailAddress?:string})=>o.emailAddress?.toLowerCase()===api.ownerEmail.toLowerCase()))fail('games_file_invalid: owner');
  if(Number(meta.size)>MAX_BYTES)fail('games_file_invalid: size');
  const revisionId=String(meta.headRevisionId||meta.version||'');
  const response=await api.request(`${FILES}/${fileId}?alt=media&supportsAllDrives=false`);
  const text=await response.text();
  return {revisionId,text};
 }};
}

const roles=['Students','Lessons','Materials','Assignments'] as const;
const columnName=(n:number)=>{let s='';for(let i=n+1;i>0;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s;};

/** The Native * tabs written by appendNativeDraftRecords, presented under the workspace tab names. */
export function googleApprovalSheet(api:GoogleApi,indexId:string):ApprovalSheet {
 if(!ID.test(indexId))fail('google_response');
 const base=`https://sheets.googleapis.com/v4/spreadsheets/${indexId}`;
 const version=async()=>{
  const meta=await api.json(`${FILES}/${indexId}?fields=id,mimeType,version,trashed,owners(emailAddress),permissions(type),appProperties`);
  if(meta.id!==indexId||meta.mimeType!==SHEET||meta.trashed||meta.appProperties?.meaCentralScope!==api.scope||!meta.owners?.some((o:{emailAddress?:string})=>o.emailAddress?.toLowerCase()===api.ownerEmail.toLowerCase()))fail('ownership');
  if(!Array.isArray(meta.permissions)||meta.permissions.some((p:{type?:string})=>p.type!=='user'&&p.type!=='group'))fail('privacy');
  const revision=String(meta.version??'');
  if(!revision)fail('google_response');
  return revision;
 };
 return {
  async read(){
   const revision=await version();
   const meta=await api.json(`${base}?fields=sheets(properties(title))`);
   if(!Array.isArray(meta.sheets))fail('google_response');
   const titles=new Set(meta.sheets.map((s:any)=>s.properties?.title));
   const grids:Record<string,WorkspaceCell[][]>={};
   const present=roles.filter(name=>titles.has(`Native ${name}`));
   for(const [name,columns] of Object.entries(workspaceTables))grids[name]=[columns.map(workspaceHeader)];
   if(present.length){
    const query=new URLSearchParams({valueRenderOption:'UNFORMATTED_VALUE'});
    for(const name of present)query.append('ranges',`'Native ${name}'!A1:Z${RANGE_ROWS}`);
    const out=await api.json(`${base}/values:batchGet?${query}`);
    if(!Array.isArray(out.valueRanges)||out.valueRanges.length!==present.length)fail('google_response');
    for(const [i,name] of present.entries()){
     const range=out.valueRanges[i];
     if(typeof range?.range!=='string'||!range.range.startsWith(`'Native ${name}'!`)&&!range.range.startsWith(`Native ${name}!`))fail('google_response');
     if(Array.isArray(range.values)&&range.values.length)grids[name]=range.values;
    }
   }
   if(await version()!==revision)fail('conflict');
   return {revision,grids};
  },
  async update(cells,revision){
   if(!cells.length)return;
   if(await version()!==revision)fail('conflict');
   const data=cells.map(c=>{if(c.table!=='Materials')fail('conflict');return{range:`'Native Materials'!${columnName(c.column)}${c.row+1}`,values:[[c.value]]};});
   await api.json(`${base}/values:batchUpdate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({valueInputOption:'RAW',data})});
  },
 };
}

/** The Native Progress tab (same Native-* ownership marker as the other tabs), created on first append. */
export function googleProgressSheet(api:GoogleApi,indexId:string):ProgressSheet {
 if(!ID.test(indexId))fail('google_response');
 const base=`https://sheets.googleapis.com/v4/spreadsheets/${indexId}`,title='Native Progress',marker=`${api.scope}:native-v1:Progress`,header=workspaceTables.Progress.map(workspaceHeader);
 async function find(){
  const meta=await api.json(`${base}?fields=sheets(properties,developerMetadata)`);if(!Array.isArray(meta.sheets))fail('google_response');
  const owned=meta.sheets.filter((x:any)=>x.developerMetadata?.some((m:any)=>m.metadataKey==='meaNativeRecords'&&m.metadataValue===marker));
  if(owned.length>1||owned[0]&&owned[0].properties.title!==title)fail('conflict');
  if(!owned.length&&meta.sheets.some((x:any)=>x.properties?.title===title))fail('conflict');
  const used=new Set(meta.sheets.map((x:any)=>x.properties?.sheetId));let next=1;while(used.has(next))next++;
  return {sheet:owned[0]??null,nextId:next};
 }
 async function values(){const out=await api.json(`${base}/values/${encodeURIComponent(`'${title}'!A1:Z${RANGE_ROWS}`)}?valueRenderOption=UNFORMATTED_VALUE`);return (out.values??[]) as unknown[][];}
 return {
  async progressIds(){const {sheet}=await find();if(!sheet)return new Set<string>();return new Set((await values()).slice(1).map(r=>String(r[0]??'')));},
  async appendProgress(rows){
   const {sheet,nextId}=await find(),requests:object[]=[];let sheetId=sheet?.properties.sheetId,existing=0;
   if(sheet)existing=(await values()).length;
   if(existing+rows.length>RANGE_ROWS-1)fail('source_limit');
   if(!sheet){sheetId=nextId;requests.push({addSheet:{properties:{sheetId,title,rightToLeft:true,gridProperties:{rowCount:5001,columnCount:header.length,frozenRowCount:1}}}},{createDeveloperMetadata:{developerMetadata:{metadataKey:'meaNativeRecords',metadataValue:marker,visibility:'DOCUMENT',location:{sheetId}}}});}
   const grid=[...(existing?[]:[header]),...rows.map(r=>workspaceTables.Progress.map(c=>r[c.key]??''))];
   requests.push({appendCells:{sheetId,rows:grid.map(row=>({values:row.map(v=>({userEnteredValue:typeof v==='boolean'?{boolValue:v}:{stringValue:String(v)}}))})),fields:'userEnteredValue'}});
   await api.json(`${base}:batchUpdate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requests})});
  },
 };
}
/** Appends finished game results (not awaiting-review) as evidence rows; idempotent by evidence_id. */
export async function syncNativeProgress(sheet:ProgressSheet){
 const students=handle().prepare('SELECT DISTINCT student_id FROM native_results').all().map(r=>Number(r.student_id));
 const context=(r:NativeResult)=>{
  if(r.bookingId===null)return null;
  const job=handle().prepare('SELECT id FROM native_lesson_jobs WHERE booking_id=?').get(r.bookingId);
  return job?{studentRef:`student-${r.studentId}`,lessonId:`booking-${r.bookingId}`,assignmentId:`native-${job.id}-games-assignment`}:null;
 };
 let appended=0;const errors:string[]=[];
 for(const studentId of students){
  try{appended+=(await appendNativeResultsToProgress({sheet,studentId,context})).appended;}
  catch(e){errors.push(String((e as Error)?.message??'error').replace(/[^\w :;,.-]/g,'').slice(0,80)||'error');}
 }
 return {appended,...(errors.length?{error:[...new Set(errors)].join('; ')}:{})};
}

let running:Promise<unknown>|null=null;
/** One pass of the approval sync over the live central Drive; single-flight. Returns null when no native workspace is connected. */
export async function runNativeGameApprovals(deps?:{api:()=>Promise<{api:GoogleApi;indexId:string;homeworkApi?:HomeworkShareApi}|null>}) {
 if(running)return null;
 const job=(async()=>{
  const ctx=await(deps?.api??liveApi)();if(!ctx)return null;
  const sheet=googleApprovalSheet(ctx.api,ctx.indexId),games=await syncNativeGameApprovals({sheet,drive:googleGamesDrive(ctx.api)});
  const homework=ctx.homeworkApi?await syncHomeworkShares({sheet,api:ctx.homeworkApi}):null;
  const progress=await syncNativeProgress(googleProgressSheet(ctx.api,ctx.indexId)).catch(e=>({appended:0,error:String((e as Error)?.message??'error').replace(/[^\w :;,.-]/g,'').slice(0,80)||'error'}));
  return {...games,homework,progress};
 })();
 running=job;
 try{return await job;}finally{running=null;}
}
async function liveApi(){
 const {nativeWorkspace}=await import('../learning-archive.ts'),{learningService}=await import('../learning-google.ts'),{centralDriveApi}=await import('../central-drive/api.ts');
 const workspace=nativeWorkspace();if(!workspace)return null;
 const service=learningService();if(!service.status().automaticSyncEnabled)return null;
 const access=service.syncAccess(),api=centralDriveApi({access,checkpoint:{read:()=>null,write:()=>{}}});
 let prepared=false;
 const homeworkApi:HomeworkShareApi={
  ...homeworkDeliveryPermissions(api),
  async place(target){
   if(!prepared){await api.prepare();prepared=true;}
   const student=getStudentById(target.studentId);
   if(!student)throw Error('ownership');
   await api.privateFolder(workspace.workspaceId,access.config.learningFolderId);
   await api.privateFolder(workspace.reviewId,workspace.workspaceId);
   await api.privateFolder(target.reviewFolderId,workspace.reviewId);
   const folder=await nativeStudentFolder(api,access.config.learningFolderId,workspace,student,true);
   await placeHomeworkDoc(api,target.docId,target.reviewFolderId,folder.id);
   return folder.id;
  },
 };
 return {api:api as unknown as GoogleApi,indexId:workspace.indexId,homeworkApi};
}
