/** Personal learning authorization; intentionally separate from business Drive. */
import {createHash,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,renameSync,unlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {workspaceClient,type LearningWorkspaceConfig} from './learning-workspace.ts';
import {accessToken} from '../../../server/drive/client.mjs';

export const LEARNING_CONNECTION_PATH='/app/library/connection';
export const LEARNING_FLOW_COOKIE='maab_learning_google';
const SCOPE='https://www.googleapis.com/auth/drive.file';
const TTL=10*60*1000;
const hash=(s:string)=>createHash('sha256').update(s).digest('base64url');
const secret=()=>randomBytes(32).toString('base64url');
type Workspace=LearningWorkspaceConfig & {templatesFolderId:string;libraryFolderId:string;studentsFolderId:string;reviewFolderId:string;studentProfileTemplateId:string;lessonBriefTemplateId:string};
export interface LearningGoogleConfig {workspace:Workspace;clientId:string;clientSecret:string;redirectUri:string;tokenKey:string;storePath:string}

export function learningFiles(w:Workspace){
 const folder='application/vnd.google-apps.folder',doc='application/vnd.google-apps.document';
 return [
  {id:w.projectFolderId,name:'MeaBeclick',type:folder,parent:undefined},
  {id:w.learningFolderId,name:'Learning',type:folder,parent:w.projectFolderId},
  {id:w.spreadsheetId,name:'Learning register',type:'application/vnd.google-apps.spreadsheet',parent:w.learningFolderId},
  ...([['templatesFolderId','Templates'],['libraryFolderId','Library'],['studentsFolderId','Students'],['reviewFolderId','Review']] as const).map(([key,name])=>({id:w[key],name,type:folder,parent:w.learningFolderId})),
  {id:w.studentProfileTemplateId,name:'תבנית פרופיל תלמיד',type:doc,parent:w.templatesFolderId},
  {id:w.lessonBriefTemplateId,name:'תבנית תכנון שיעור',type:doc,parent:w.templatesFolderId},
 ];
}

export function learningGoogleConfig(env:Record<string,string|undefined>=process.env):LearningGoogleConfig {
 try{
  if(!env.LEARNING_GOOGLE_CLIENT_ID||!env.LEARNING_GOOGLE_CLIENT_SECRET||!env.LEARNING_GOOGLE_WORKSPACE_FILE||!env.DATA_DIR||!/^([a-f\d]{64})$/i.test(env.LEARNING_GOOGLE_TOKEN_KEY??''))throw Error();
  const site=new URL(env.SITE_URL??'');
  if(site.pathname!=='/'||site.search||site.hash||site.username||site.password||(site.protocol!=='https:'&&!(site.protocol==='http:'&&['localhost','127.0.0.1'].includes(site.hostname))))throw Error();
  const workspace=JSON.parse(readFileSync(env.LEARNING_GOOGLE_WORKSPACE_FILE,'utf8')) as Workspace;
  if(workspace.version!==1||typeof workspace.ownerEmail!=='string'||!/^\S+@\S+\.\S+$/.test(workspace.ownerEmail))throw Error();
  const ids=learningFiles(workspace).map(f=>f.id);
  if(ids.some(id=>typeof id!=='string'||!/^[-\w]{10,}$/.test(id))||new Set(ids).size!==9)throw Error();
  return {workspace,clientId:env.LEARNING_GOOGLE_CLIENT_ID,clientSecret:env.LEARNING_GOOGLE_CLIENT_SECRET,redirectUri:`${site.origin}/auth/google/callback`,tokenKey:env.LEARNING_GOOGLE_TOKEN_KEY!,storePath:join(env.DATA_DIR,'.credentials','learning-google.json')};
 }catch{throw Error('learning Google setup is incomplete or invalid');}
}

export function learningConnectionService(options:{config:LearningGoogleConfig;fetch?:typeof fetch;now?:()=>number}){
 const {config}=options,now=options.now??Date.now,fetchImpl=options.fetch??fetch;
 const identity=hash(JSON.stringify([config.clientId,config.redirectUri,config.workspace]));
 type Record={refreshToken:string;checkedAt:string;verified:boolean;realRecords:Awaited<ReturnType<ReturnType<typeof workspaceClient>['status']>>['realRecords']};
 function read():Record|null{
  let raw:string;
  try{raw=readFileSync(config.storePath,'utf8');}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw Error('storage');}
  try{
   if(raw.length>32*1024)throw Error();
   const sealed=JSON.parse(raw);
   if(sealed.version!==1)throw Error();
   const decipher=createDecipheriv('aes-256-gcm',Buffer.from(config.tokenKey,'hex'),Buffer.from(sealed.iv,'base64url'));
   decipher.setAAD(Buffer.from(identity));decipher.setAuthTag(Buffer.from(sealed.tag,'base64url'));
   const record=JSON.parse(Buffer.concat([decipher.update(Buffer.from(sealed.data,'base64url')),decipher.final()]).toString('utf8'));
   if(typeof record.refreshToken!=='string'||!record.refreshToken||typeof record.checkedAt!=='string'||typeof record.verified!=='boolean'||!record.realRecords)throw Error();
   return record;
  }catch{throw Error('storage');}
 }
 function storedVersion(){
  try{return hash(readFileSync(config.storePath,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw Error('storage');}
 }
 function write(record:Record,expected:string|null){
  // An older in-flight check must never restore credentials replaced by consent.
  if(storedVersion()!==expected)throw Error('superseded');
  const temporary=`${config.storePath}.${secret()}.tmp`;
  try{
   const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(config.tokenKey,'hex'),iv);
   cipher.setAAD(Buffer.from(identity));
   const data=Buffer.concat([cipher.update(JSON.stringify(record),'utf8'),cipher.final()]);
   mkdirSync(dirname(config.storePath),{recursive:true,mode:0o700});
   writeFileSync(temporary,JSON.stringify({version:1,iv:iv.toString('base64url'),tag:cipher.getAuthTag().toString('base64url'),data:data.toString('base64url')}),{mode:0o600,flag:'wx'});
   renameSync(temporary,config.storePath);
  }catch{try{unlinkSync(temporary);}catch{}throw Error('storage');}
 }
 const credentials=(refreshToken:string)=>({clientId:config.clientId,clientSecret:config.clientSecret,refreshToken});
 async function json(url:string,init?:RequestInit):Promise<any>{
  try{
   const response=await fetchImpl(url,{...init,signal:AbortSignal.timeout(20000)});
   if(!response.ok)throw Error();
   const body=await response.text();if(body.length>1024*1024)throw Error();
   return JSON.parse(body);
  }catch{throw Error('google');}
 }
 async function validate(refreshToken:string,access?:string){
  if(!access){try{access=await accessToken(credentials(refreshToken),(input,init)=>fetchImpl(input,{...init,signal:AbortSignal.timeout(20000)}));}catch{throw Error('google');}}
  const headers={Authorization:`Bearer ${access}`};
  const account=await json('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',{headers});
  if(account.user?.emailAddress?.toLowerCase()!==config.workspace.ownerEmail.toLowerCase())throw Error('account');
  for(const file of learningFiles(config.workspace)){
   let actual:any;
   try{actual=await json(`https://www.googleapis.com/drive/v3/files/${file.id}?fields=id,mimeType,parents,owners(emailAddress),trashed`,{headers});}catch{throw Error('files');}
   if(actual.id!==file.id||actual.mimeType!==file.type||actual.trashed||!actual.owners?.some((o:{emailAddress?:string})=>o.emailAddress?.toLowerCase()===config.workspace.ownerEmail.toLowerCase())||(file.parent&&!actual.parents?.includes(file.parent)))throw Error('files');
  }
  try{return await workspaceClient({config:config.workspace,credentials:credentials(refreshToken),fetch:fetchImpl}).status();}catch{throw Error('register');}
 }
 const flows=new Map<string,{browserHash:string;sessionHash:string;verifier:string;expires:number}>();
 function start(session:string){
  if(!session)throw Error('session');
  for(const[state,flow]of flows)if(flow.expires<=now())flows.delete(state);
  if(flows.size>=50)throw Error('busy');
  const state=`learning.${secret()}`,browser=secret(),verifier=secret();
  flows.set(state,{browserHash:hash(browser),sessionHash:hash(session),verifier,expires:now()+TTL});
  const query=new URLSearchParams({client_id:config.clientId,redirect_uri:config.redirectUri,response_type:'code',scope:SCOPE,access_type:'offline',prompt:'select_account consent',include_granted_scopes:'false',state,code_challenge:hash(verifier),code_challenge_method:'S256',trigger_onepick:'true',allow_multiple:'true',allow_folder_selection:'true',file_ids:learningFiles(config.workspace).map(f=>f.id).join(','),login_hint:config.workspace.ownerEmail});
  return {url:`https://accounts.google.com/o/oauth2/v2/auth?${query}`,browser};
 }
 async function finish(input:{state:string;browser:string;session:string;authCode:string|null;pickedFileIds:string|null;error:string|null}){
  const flow=flows.get(input.state);
  if(!flow||flow.expires<=now()||!input.session||hash(input.browser)!==flow.browserHash||hash(input.session)!==flow.sessionHash)throw Error('expired');
  flows.delete(input.state); // Claim before the first network await.
  const previous=storedVersion();
  if(input.error)throw Error('cancelled');
  const picked=(input.pickedFileIds??'').split(','),required=learningFiles(config.workspace).map(f=>f.id);
  if(picked.length!==required.length||new Set(picked).size!==required.length||required.some(id=>!picked.includes(id)))throw Error('selection');
  if(!input.authCode||input.authCode.length>4096)throw Error('google');
  const token=await json('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,redirect_uri:config.redirectUri,code:input.authCode,code_verifier:flow.verifier,grant_type:'authorization_code'})});
  if(typeof token.access_token!=='string'||!token.access_token||token.access_token.length>8192||typeof token.refresh_token!=='string'||!token.refresh_token||token.refresh_token.length>8192)throw Error('offline');
  if(typeof token.scope!=='string'||token.scope.trim()!==SCOPE)throw Error('scope');
  const status=await validate(token.refresh_token,token.access_token);
  write({refreshToken:token.refresh_token,checkedAt:new Date(now()).toISOString(),verified:true,realRecords:status.realRecords},previous);
 }
 function status(){
  const record=read();
  return {state:record?(record.verified?'verified':'failed'):'disconnected',account:config.workspace.ownerEmail,checkedAt:record?.checkedAt??null,realRecords:record?.realRecords??null,readOnly:true,automaticPublishing:false};
 }
 function connected(){
  const record=read();if(!record)throw Error('disconnected');
  return workspaceClient({config:config.workspace,credentials:credentials(record.refreshToken),fetch:fetchImpl});
 }
 async function verify(){
  const previous=storedVersion(),record=read();if(!record)throw Error('disconnected');
  let checked:Awaited<ReturnType<typeof validate>>;
  try{checked=await validate(record.refreshToken);}
  catch(e){write({...record,checkedAt:new Date(now()).toISOString(),verified:false},previous);throw e;}
  write({...record,checkedAt:new Date(now()).toISOString(),verified:true,realRecords:checked.realRecords},previous);
  return status();
 }
 return {start,finish,status,verify,connected};
}

let active:{identity:string;service:ReturnType<typeof learningConnectionService>}|undefined;
/** Preserve short-lived flows across requests; config rotation invalidates them. */
export function learningService(){
 const config=learningGoogleConfig(),identity=hash(JSON.stringify(config));
 if(!active||active.identity!==identity)active={identity,service:learningConnectionService({config})};
 return active.service;
}
