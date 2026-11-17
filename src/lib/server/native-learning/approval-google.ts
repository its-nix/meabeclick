import {workspaceTables,workspaceHeader,type WorkspaceCell} from '../../learning/workspace.ts';
import {syncNativeGameApprovals,type ApprovalSheet} from './approval-sync.ts';
import type {GamesDrive} from './games.ts';
import {syncHomeworkShares} from './homework-share.ts';
import {shareHomeworkWithStudent,revokeHomeworkShare} from '../central-drive/share.ts';

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
  const meta=await api.json(`${FILES}/${indexId}?fields=id,mimeType,version,trashed,owners(emailAddress),appProperties`);
  if(meta.id!==indexId||meta.trashed||meta.appProperties?.meaCentralScope!==api.scope||!meta.owners?.some((o:{emailAddress?:string})=>o.emailAddress?.toLowerCase()===api.ownerEmail.toLowerCase()))fail('ownership');
  return String(meta.version??'');
 };
 return {
  async read(){
   const revision=await version();
   const meta=await api.json(`${base}?fields=sheets(properties(title))`);
   if(!Array.isArray(meta.sheets))fail('google_response');
   const titles=new Set(meta.sheets.map((s:any)=>s.properties?.title));
   const grids:Record<string,WorkspaceCell[][]>={};
   for(const name of Object.keys(workspaceTables)){
    const header=workspaceTables[name].map(workspaceHeader),title=`Native ${name}`;
    if(!(roles as readonly string[]).includes(name)||!titles.has(title)){grids[name]=[header];continue;}
    const out=await api.json(`${base}/values/${encodeURIComponent(`'${title}'!A1:Z${RANGE_ROWS}`)}?valueRenderOption=UNFORMATTED_VALUE`);
    grids[name]=Array.isArray(out.values)&&out.values.length?out.values:[header];
   }
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

let running:Promise<unknown>|null=null;
/** One pass of the approval sync over the live central Drive; single-flight. Returns null when no native workspace is connected. */
export async function runNativeGameApprovals(deps?:{api:()=>Promise<{api:GoogleApi;indexId:string}|null>}) {
 if(running)return null;
 const job=(async()=>{
  const ctx=await(deps?.api??liveApi)();if(!ctx)return null;
  const sheet=googleApprovalSheet(ctx.api,ctx.indexId),games=await syncNativeGameApprovals({sheet,drive:googleGamesDrive(ctx.api)});
  // Homework Docs are shared by named user only; a failure here never undoes the game approvals above.
  const homework=await syncHomeworkShares({sheet,api:{share:(doc,email)=>shareHomeworkWithStudent(ctx.api,doc,email),revoke:(doc,email)=>revokeHomeworkShare(ctx.api,doc,email)}}).catch(()=>null);
  return {...games,homework};
 })();
 running=job;
 try{return await job;}finally{running=null;}
}
async function liveApi(){
 const {nativeWorkspace}=await import('../learning-archive.ts'),{learningService}=await import('../learning-google.ts'),{centralDriveApi}=await import('../central-drive/api.ts');
 const workspace=nativeWorkspace();if(!workspace)return null;
 const service=learningService();if(!service.status().automaticSyncEnabled)return null;
 const access=service.syncAccess(),api=centralDriveApi({access,checkpoint:{read:()=>null,write:()=>{}}});
 return {api:api as unknown as GoogleApi,indexId:workspace.indexId};
}
