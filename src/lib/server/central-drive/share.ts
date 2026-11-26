import {CentralDriveError,DOC} from './api.ts';
import type {CentralFile} from './api.ts';
import type {HomeworkGrant} from '../native-learning/homework-share.ts';
import {isValidEmailAddress,normalizeEmail} from '../email-address.ts';

interface ShareApi {scope:string;ownerEmail:string;json:(url:string,init?:RequestInit)=>Promise<any>;request:(url:string,init?:RequestInit,allowed?:number[])=>Promise<Response>}
interface Permission {id:string;type:string;role?:string;emailAddress?:string;allowFileDiscovery?:boolean}
const API='https://www.googleapis.com/drive/v3/files',ID=/^[\w-]{10,}$/;
const fail=(code:string):never=>{throw new CentralDriveError(code);};

async function homeworkDoc(api:ShareApi,id:string){
 if(!ID.test(id))fail('google_response');
 const file=await api.json(`${API}/${id}?fields=id,mimeType,parents,owners(emailAddress),trashed,appProperties,writersCanShare,resourceKey`) as CentralFile & {writersCanShare?:boolean;resourceKey?:string};
 if(file.id!==id||file.mimeType!==DOC||file.trashed||file.appProperties?.meaCentralScope!==api.scope)fail('conflict');
 if(!file.owners?.some(o=>o.emailAddress?.toLowerCase()===api.ownerEmail.toLowerCase()))fail('ownership');
 return file;
}
async function listPermissions(api:ShareApi,id:string):Promise<Permission[]>{
 const permissions:Permission[]=[];
 let token:string|undefined;
 const seen=new Set<string>();
 do{
  const query=new URLSearchParams({fields:'nextPageToken,permissions(id,type,role,emailAddress,allowFileDiscovery)',supportsAllDrives:'false'});
  if(token)query.set('pageToken',token);
  const out=await api.json(`${API}/${id}/permissions?${query}`);
  if(!Array.isArray(out.permissions))fail('google_response');
  permissions.push(...out.permissions);
  token=out.nextPageToken;
  if(token){if(typeof token!=='string'||seen.has(token)||seen.size>=100)fail('google_response');seen.add(token);}
 }while(token);
 return permissions;
}
function clean(email:string){const e=normalizeEmail(email);if(!isValidEmailAddress(e))fail('invalid_email');return e;}
const hasEmail=(p:Permission,e:string)=>p.type==='user'&&p.emailAddress?.toLowerCase()===e;

export async function shareHomeworkWithStudent(api:ShareApi,docId:string,studentEmail:string){
 const email=clean(studentEmail);if(email===api.ownerEmail.toLowerCase())fail('invalid_email');
 await homeworkDoc(api,docId);
 if((await listPermissions(api,docId)).some(p=>hasEmail(p,email)))return{shared:false};
 await api.json(`${API}/${docId}/permissions?sendNotificationEmail=false&supportsAllDrives=false`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'user',role:'reader',emailAddress:email})});
 return{shared:true};
}
export async function revokeHomeworkShare(api:ShareApi,docId:string,studentEmail:string){
 const email=clean(studentEmail);await homeworkDoc(api,docId);
 const mine=(await listPermissions(api,docId)).filter(p=>hasEmail(p,email)&&p.role!=='owner');
 for(const p of mine){if(!/^[\w-]+$/.test(p.id))fail('google_response');await api.request(`${API}/${docId}/permissions/${p.id}`,{method:'DELETE'},[404]);}
 return{revoked:mine.length>0};
}


const jsonRequest=(method:string,body:object):RequestInit=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const isGrantee=(p:Permission,grantee:string)=>grantee==='*'?p.type==='anyone':hasEmail(p,grantee);
function permissionUrl(docId:string,id:string){
 if(!/^[\w-]+$/.test(id))fail('google_response');
 return `${API}/${docId}/permissions/${id}`;
}
function assertParent(file:CentralFile,parentId:string){
 if(file.parents?.length!==1||file.parents[0]!==parentId)fail('conflict');
}

function checkGrant(permissions:Permission[],grantee:string,role:'reader'|'writer',prior?:HomeworkGrant){
 const matches=permissions.filter(p=>isGrantee(p,grantee)||p.id===prior?.permissionId);
 if(matches.length>1)fail('conflict');
 const existing=matches[0];
 if(existing&&(prior?.role!==role||existing.role!==role||!isGrantee(existing,grantee)||prior.permissionId&&prior.permissionId!==existing.id||
    grantee==='*'&&existing.allowFileDiscovery!==false))fail('homework_role_conflict');
 if(existing&&grantee!=='*'&&!prior?.permissionId)fail('homework_named_grant_needs_review');
 return existing;
}

/** Release-only ACL operations on a receipt-verified Google Doc. */
export function homeworkDeliveryPermissions(api:ShareApi){
 return {
  async restrictSharing(docId:string,parentId:string,grants:ReadonlyMap<string,'reader'|'writer'>,prior:ReadonlyMap<string,HomeworkGrant>){
   const file=await homeworkDoc(api,docId);
   assertParent(file,parentId);
   const permissions=await listPermissions(api,docId);
   if(permissions.some(p=>p.type==='domain'||p.type==='anyone'&&(!grants.has('*')||prior.get('*')?.role!=='writer')))fail('privacy');
   for(const [grantee,role] of grants){
    if(grantee!=='*'&&clean(grantee)===api.ownerEmail.toLowerCase())fail('homework_role_conflict');
    checkGrant(permissions,grantee,role,prior.get(grantee));
   }
   if(file.writersCanShare!==false){
    const updated=await api.json(`${API}/${docId}?fields=id,writersCanShare`,jsonRequest('PATCH',{writersCanShare:false}));
    if(updated.id!==docId||updated.writersCanShare!==false)fail('google_response');
   }
  },
  async ensure(docId:string,parentId:string,grantee:string,role:'reader'|'writer',prior:HomeworkGrant|undefined,checkCurrent:()=>Promise<void>,beforeWrite:()=>void){
   const email=grantee==='*'?null:clean(grantee);
   const file=await homeworkDoc(api,docId);
   assertParent(file,parentId);
   if(file.writersCanShare!==false)fail('privacy');
   let existing=checkGrant(await listPermissions(api,docId),email??'*',role,prior);
   if(!existing){
    await checkCurrent();
    existing=checkGrant(await listPermissions(api,docId),email??'*',role,prior);
   }
   if(existing){
    permissionUrl(docId,existing.id);
    return {created:false,permissionId:existing.id};
   }
   if(email===api.ownerEmail.toLowerCase())fail('homework_role_conflict');
   beforeWrite();
   const body=email===null?{type:'anyone',role,allowFileDiscovery:false}:{type:'user',role,emailAddress:email};
   const query=email===null?'':'&sendNotificationEmail=false';
   const result=await api.json(`${API}/${docId}/permissions?supportsAllDrives=false&fields=id${query}`,jsonRequest('POST',body));
   if(typeof result.id!=='string')fail('google_response');
   permissionUrl(docId,result.id);
   return {created:true,permissionId:result.id as string};
  },
  async verifyDelivery(docId:string,parentId:string,grants:ReadonlyMap<string,'reader'|'writer'>){
   const file=await homeworkDoc(api,docId);
   assertParent(file,parentId);
   if(file.writersCanShare!==false)fail('privacy');
   const permissions=await listPermissions(api,docId);
   if(permissions.some(p=>p.type==='domain'||p.type==='anyone'&&!grants.has('*')))fail('privacy');
   for(const [grantee,role] of grants){
    const matching=permissions.filter(p=>isGrantee(p,grantee));
    if(matching.length!==1||matching[0].role!==role||grantee==='*'&&matching[0].allowFileDiscovery!==false)fail('homework_role_conflict');
   }
   if(file.resourceKey&&!/^[\w-]{1,256}$/.test(file.resourceKey))fail('google_response');
   return file.resourceKey??null;
  },
  async revoke(docId:string,grantee:string,grant:HomeworkGrant){
   const file=await homeworkDoc(api,docId);
   const email=grantee==='*'?null:clean(grantee);
   const matches=()=>listPermissions(api,docId).then(permissions=>permissions.filter(p=>isGrantee(p,email??'*')||p.id===grant.permissionId));
   const permissions=await matches();
   if(!permissions.length)return false;
   // The old ledger did not distinguish an existing operator grant from one the app created.
   if(!grant.role)fail('legacy_homework_grant_needs_review');
   if(email!==null&&!grant.permissionId)fail('homework_named_grant_needs_review');
   const p=permissions[0];
   if(permissions.length!==1||p.role!==grant.role||grant.permissionId&&p.id!==grant.permissionId||
      email===null&&p.allowFileDiscovery!==false)fail('homework_role_conflict');
   const parent=file.parents?.length===1?file.parents[0]:null;
   if(!parent||!ID.test(parent))throw new CentralDriveError('conflict');
   if((await listPermissions(api,parent)).some(inherited=>isGrantee(inherited,email??'*')||inherited.id===p.id)){
    fail('homework_inherited_grant_needs_review');
   }
   await api.request(permissionUrl(docId,p.id),{method:'DELETE'},[404]);
   if((await matches()).length)fail('homework_revocation_unverified');
   return true;
  },

 };
}
