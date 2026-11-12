import {createHash,randomBytes} from 'node:crypto';
import {accessToken} from '../../../../server/drive/client.mjs';
import type {LearningGoogleConfig} from '../learning-google.ts';
import type {CentralArtifact,CentralStudent} from './source.ts';

export interface CentralAccess {config:LearningGoogleConfig['workspace'];credentials:{clientId:string;clientSecret:string;refreshToken:string};epoch:string;assertCurrent:()=>void}
export interface CentralFile {id:string;name:string;mimeType:string;parents?:string[];owners?:Array<{emailAddress:string}>;permissions?:Array<{type:string}>;trashed?:boolean;appProperties?:Record<string,string>;md5Checksum?:string;size?:string}
export interface UploadCheckpoint {key:string;id:string;url?:string}
export interface CheckpointStore {read:()=>UploadCheckpoint|null;write:(value:UploadCheckpoint|null)=>void}
const API='https://www.googleapis.com/drive/v3/files',UPLOAD='https://www.googleapis.com/upload/drive/v3/files';
export const FOLDER='application/vnd.google-apps.folder',DOC='application/vnd.google-apps.document',SHEET='application/vnd.google-apps.spreadsheet';
const FIELDS='id,name,mimeType,parents,owners(emailAddress),permissions(type),trashed,appProperties,md5Checksum,size';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const validId=(s:unknown):s is string=>typeof s==='string'&&/^[\w-]{10,}$/.test(s);
const esc=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const centralFileUrl=(file:CentralFile)=>file.mimeType===FOLDER?`https://drive.google.com/drive/folders/${file.id}`:file.mimeType===DOC?`https://docs.google.com/document/d/${file.id}/edit`:file.mimeType===SHEET?`https://docs.google.com/spreadsheets/d/${file.id}/edit`:`https://drive.google.com/file/d/${file.id}/view`;
export function artifactCategory(a:CentralArtifact){return ['slides','presentation'].includes(a.role)?'Presentations':a.role==='teacher-notes'?'Teacher notes':['game','game-template'].includes(a.role)?'Games':['draft','game-draft'].includes(a.role)?'Drafts':a.role==='review'?'Review':a.role==='resource'?'Resources':a.role==='curriculum'?'Curriculum':a.role==='plan'?'Lesson plans':'Records';}

export class CentralDriveError extends Error {code:string;constructor(code:string){super(code);this.code=code;}}
function fail(code:string):never{throw new CentralDriveError(code);}

export function centralDriveApi(options:{access:CentralAccess;fetch?:typeof fetch;checkpoint:CheckpointStore}){
 const {access,checkpoint}=options,fetchImpl=options.fetch??fetch;
 const scope=hash(JSON.stringify(['meabeclick-central-v1',access.config.ownerEmail,access.config.learningFolderId]));
 const files=new Map<string,CentralFile[]>();let prepared=false,token:{value:string;until:number}|null=null;
 const marker=(key:string)=>hash(key),props=(key:string)=>({meaCentralScope:scope,meaCentralKey:marker(key)});
 async function parse(response:Response){
  const text=await response.text();if(text.length>2*1024*1024)fail('google_response');
  try{return JSON.parse(text);}catch{fail('google_response');}
 }
 async function request(url:string,init:RequestInit={},allowed:number[]=[]):Promise<Response>{
  let target:URL;try{target=new URL(url);}catch{fail('google_response');}
  if(target.username||target.password||!['https://www.googleapis.com','https://sheets.googleapis.com'].includes(target.origin)||target.origin==='https://www.googleapis.com'&&!/^\/(drive\/v3\/|upload\/drive\/v3\/files)/.test(target.pathname)||target.origin==='https://sheets.googleapis.com'&&!target.pathname.startsWith('/v4/spreadsheets/'))fail('google_response');
  access.assertCurrent();
  if(!token||token.until<Date.now()){
   try{const value=await accessToken(access.credentials,(input,body)=>{access.assertCurrent();return fetchImpl(input,{...body,redirect:'manual',signal:AbortSignal.timeout(20000)});});if(typeof value!=='string'||!value||value.length>8192)fail('authorization');token={value,until:Date.now()+45*60*1000};}
   catch(e){if(e instanceof Error&&e.message==='paused')throw e;fail('authorization');}
  }
  let response:Response;
  try{response=await fetchImpl(url,{...init,redirect:'manual',headers:{...Object.fromEntries(new Headers(init.headers)),Authorization:`Bearer ${token.value}`},signal:AbortSignal.timeout(45000)});}catch{fail('google');}
  if(!response.ok&&!allowed.includes(response.status)){
   if(response.status===401)fail('authorization');if(response.status===429)fail('quota');
   if(response.status===403){const body=await parse(response);if(body.error?.details?.some((d:{reason?:string})=>d.reason==='SERVICE_DISABLED'))fail('api_setup');fail('permissions');}
   fail('google');
  }
  return response;
 }
 async function json(url:string,init:RequestInit={}){return parse(await request(url,init));}
 function ready(){access.assertCurrent();if(!prepared)fail('not_ready');}
 function validate(file:CentralFile,type:string,parent:string,key:string){
  if(!validId(file?.id)||file.mimeType!==type||file.trashed||!file.parents?.includes(parent)||file.appProperties?.meaCentralScope!==scope||file.appProperties?.meaCentralKey!==marker(key))fail('conflict');
  if(!file.owners?.some(o=>o.emailAddress?.toLowerCase()===access.config.ownerEmail.toLowerCase()))fail('ownership');
  if(!Array.isArray(file.permissions)||file.permissions.some(p=>!['user','group'].includes(p.type)))fail('privacy');
  return file;
 }
 function known(key:string,type:string,parent:string){
  const list=files.get(marker(key))??[];if(list.length>1)fail('conflict');return list.length?validate(list[0],type,parent,key):null;
 }
 function remember(file:CentralFile){files.set(file.appProperties!.meaCentralKey,[file]);return file;}
 async function metadata(id:string){if(!validId(id))fail('google_response');const response=await request(`${API}/${id}?fields=${FIELDS}`,{},[404]);return response.status===404?null:await parse(response) as CentralFile;}
 function pending(key:string){const p=checkpoint.read();return p?.key===`${scope}:${marker(key)}`&&validId(p.id)?p:null;}
 function save(key:string,id:string,url?:string){checkpoint.write({key:`${scope}:${marker(key)}`,id,...(url?{url}:{})});}
 function clear(key:string){if(pending(key))checkpoint.write(null);}
 async function reserve(key:string){const p=pending(key);if(p)return p.id;const out=await json(`${API}/generateIds?count=1&space=drive&type=files`);if(!validId(out.ids?.[0]))fail('google_response');save(key,out.ids[0]);return out.ids[0] as string;}
 function multipart(metadata:object,content:Buffer,type:string){const boundary=`mea${randomBytes(16).toString('hex')}`;return{headers:{'Content-Type':`multipart/related; boundary=${boundary}`},body:Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${type}\r\n\r\n`),content,Buffer.from(`\r\n--${boundary}--`)])};}
 async function prepare(){
  prepared=false;files.clear();
  const account=await json('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)');
  if(account.user?.emailAddress?.toLowerCase()!==access.config.ownerEmail.toLowerCase())fail('ownership');
  const root=await json(`${API}/${access.config.learningFolderId}?fields=id,mimeType,parents,owners(emailAddress),permissions(type),trashed`);
  if(root.id!==access.config.learningFolderId||root.mimeType!==FOLDER||root.trashed||!root.parents?.includes(access.config.projectFolderId)||!root.owners?.some((o:{emailAddress?:string})=>o.emailAddress?.toLowerCase()===access.config.ownerEmail.toLowerCase()))fail('ownership');
  if(!Array.isArray(root.permissions)||root.permissions.some((p:{type?:string})=>!['user','group'].includes(p.type??'')))fail('privacy');
  let pageToken='',count=0;const seen=new Set<string>();
  do{
   const url=new URL(API);url.searchParams.set('q',`appProperties has { key='meaCentralScope' and value='${scope}' }`);url.searchParams.set('pageSize','1000');url.searchParams.set('spaces','drive');url.searchParams.set('fields',`nextPageToken,incompleteSearch,files(${FIELDS})`);if(pageToken)url.searchParams.set('pageToken',pageToken);
   const page=await json(String(url));if(!Array.isArray(page.files)||page.incompleteSearch)fail('google_response');
   for(const file of page.files as CentralFile[]){if(++count>100000)fail('source_limit');if(file.appProperties?.meaCentralScope!==scope)continue;const key=file.appProperties.meaCentralKey;if(!/^[a-f0-9]{64}$/.test(key??''))fail('conflict');files.set(key,[...(files.get(key)??[]),file]);}
   pageToken=page.nextPageToken??'';if(typeof pageToken!=='string'||pageToken.length>4096||pageToken&&seen.has(pageToken))fail('google_response');seen.add(pageToken);
  }while(pageToken);
  prepared=true;
 }
 async function folder(key:string,name:string,parent:string){
  ready();const old=known(`folder:${key}`,FOLDER,parent);if(old){clear(`folder:${key}`);return old;}
  const logical=`folder:${key}`,id=await reserve(logical);
  const response=await request(`${API}?fields=${FIELDS}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,name,mimeType:FOLDER,parents:[parent],appProperties:props(logical)})},[409]);
  const file=response.status===409?await metadata(id):await parse(response);
  remember(validate(file,FOLDER,parent,logical));clear(logical);return file as CentralFile;
 }
 async function native(key:string,name:string,type:string,parent:string,html?:string){
  ready();const old=known(key,type,parent);if(old)return{file:old,reused:true};
  const meta={name,mimeType:type,parents:[parent],appProperties:props(key)};
  const out=html===undefined?await json(`${API}?fields=${FIELDS}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(meta)}):await parse(await request(`${UPLOAD}?uploadType=multipart&fields=${FIELDS}`,{method:'POST',...multipart(meta,Buffer.from(html),'text/html; charset=UTF-8')}));
  return{file:remember(validate(out,type,parent,key)),reused:false};
 }
 function session(url:string){try{const parsed=new URL(url);if(parsed.origin!=='https://www.googleapis.com'||!parsed.pathname.startsWith('/upload/drive/v3/files')||parsed.username||parsed.password)fail('google_response');return String(parsed);}catch{fail('google_response');}}
 async function blob(a:CentralArtifact,parent:string){
  ready();const key=`blob:${artifactCategory(a)}:${a.mimeType}:${a.sha256}`;let old=known(key,a.mimeType,parent);
  const good=(f:CentralFile)=>f.md5Checksum?.toLowerCase()===a.md5&&Number(f.size)===a.size;
  if(old&&good(old)){clear(key);return{file:old,reused:true};}
  if(old?.md5Checksum)fail('conflict');
  const id=old?.id??await reserve(key);save(key,id,pending(key)?.url);
  if(!old&&pending(key)){const actual=await metadata(id);if(actual){old=validate(actual,a.mimeType,parent,key);if(good(old)){remember(old);clear(key);return{file:old,reused:true};}if(old.md5Checksum)fail('conflict');}}
  const meta={name:`${a.lesson?`${a.lesson} — `:''}${a.name} [${a.sha256.slice(0,8)}]`.slice(0,240),mimeType:a.mimeType,appProperties:props(key)};
  if(a.size===0){
   const out=await parse(await request(`${UPLOAD}${old?`/${id}`:''}?uploadType=multipart&fields=${FIELDS}`,{method:old?'PATCH':'POST',...multipart({...meta,...(!old?{id,parents:[parent]}:{})},Buffer.alloc(0),a.mimeType)}));
   validate(out,a.mimeType,parent,key);if(!good(out))fail('google_response');remember(out);clear(key);return{file:out as CentralFile,reused:false};
  }
  let url=pending(key)?.url,offset=0;
  if(url){
   const response=await request(session(url),{method:'PUT',headers:{'Content-Length':'0','Content-Range':`bytes */${a.size}`},body:Buffer.alloc(0)},[308,404,410]);
   if(response.ok){const file=await parse(response);validate(file,a.mimeType,parent,key);if(!good(file))fail('conflict');remember(file);clear(key);return{file:file as CentralFile,reused:true};}
   if(response.status===308)offset=response.headers.get('Range')?Number(response.headers.get('Range')!.match(/^bytes=0-(\d+)$/)?.[1])+1:0;else url=undefined;
  }
  if(!url){
   const init={method:old?'PATCH':'POST',headers:{'Content-Type':'application/json','X-Upload-Content-Type':a.mimeType,'X-Upload-Content-Length':String(a.size)},body:JSON.stringify({...meta,...(!old?{id,parents:[parent]}:{})})};
   let response=await request(`${UPLOAD}${old?`/${id}`:''}?uploadType=resumable&fields=${FIELDS}`,init,[409]);
   if(response.status===409){
    old=validate(await metadata(id) as CentralFile,a.mimeType,parent,key);if(good(old)){remember(old);clear(key);return{file:old,reused:true};}if(old.md5Checksum)fail('conflict');
    response=await request(`${UPLOAD}/${id}?uploadType=resumable&fields=${FIELDS}`,{...init,method:'PATCH',body:JSON.stringify({appProperties:props(key)})});
   }
   url=session(response.headers.get('Location')??'');save(key,id,url);
  }
  if(!Number.isSafeInteger(offset)||offset<0||offset>=a.size)fail('google_response');
  while(offset<a.size){
   access.assertCurrent();const bytes=await a.read(offset,Math.min(8*1024*1024,a.size-offset));if(!bytes.length)fail('source_changed');
   const response=await request(session(url),{method:'PUT',headers:{'Content-Type':a.mimeType,'Content-Length':String(bytes.length),'Content-Range':`bytes ${offset}-${offset+bytes.length-1}/${a.size}`},body:Uint8Array.from(bytes)},[308]);
   if(response.ok){const file=await parse(response);validate(file,a.mimeType,parent,key);if(!good(file))fail('conflict');remember(file);clear(key);return{file:file as CentralFile,reused:false};}
   const next=Number(response.headers.get('Range')?.match(/^bytes=0-(\d+)$/)?.[1])+1;
   if(!Number.isSafeInteger(next)||next<=offset||next>a.size)fail('upload_stalled');offset=next;
  }
  fail('google_response');
 }
 async function profile(student:CentralStudent,parent:string,indexId:string){
  if(!validId(indexId))fail('google_response');
  const html=`<!doctype html><html lang="he" dir="rtl"><body dir="rtl"><h1>${esc(student.name)} — תיק תלמיד/ה</h1><p>מזהה: ${esc(student.code)} · ${esc(student.subjects)}</p><p><a href="https://docs.google.com/spreadsheets/d/${indexId}/edit">הרישום המרכזי — חומרים והתקדמות מהאתר</a></p><h2>מטרות הלמידה</h2><p>${esc(student.goals)}</p><h2>מה עוזר בלמידה</h2><p>${esc(student.style)}</p><h2>הערות למורה</h2><p>${esc(student.notes)}</p><p>זהו מסמך לעריכה חופשית. הסנכרון אינו מחליף את ההערות שלכם; נתונים שמתעדכנים אוטומטית נמצאים בגיליון הרישום.</p></body></html>`;
  return native(`profile:${student.id}`,`${student.name} — תיק תלמיד`,DOC,parent,html);
 }
 return{scope,prepare,folder,blob,profile,artifactCheckpointKey:(a:CentralArtifact)=>`${scope}:${marker(`blob:${artifactCategory(a)}:${a.mimeType}:${a.sha256}`)}`,register:(parent:string)=>native('register','MeaBeclick — Website sync index',SHEET,parent),json,request};
}
