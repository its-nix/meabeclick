import {CentralDriveError,DOC} from './api.ts';
import type {CentralFile} from './api.ts';
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

/** Release-only ACL operations on a receipt-verified Google Doc. */
export function homeworkDeliveryPermissions(api:ShareApi){
 return {
  async restrictSharing(docId:string,parentId:string,managedLink:boolean){
   const file=await homeworkDoc(api,docId);
   assertParent(file,parentId);
   const permissions=await listPermissions(api,docId);
   if(permissions.some(p=>p.type==='domain'||p.type==='anyone'&&!managedLink))fail('privacy');
   if(file.writersCanShare!==false){
    const updated=await api.json(`${API}/${docId}?fields=id,writersCanShare`,jsonRequest('PATCH',{writersCanShare:false}));
    if(updated.id!==docId||updated.writersCanShare!==false)fail('google_response');
   }
  },
  async ensure(docId:string,parentId:string,grantee:string,role:'reader'|'writer',managed:boolean,beforeWrite:()=>void){
   const email=grantee==='*'?null:clean(grantee);
   const file=await homeworkDoc(api,docId);
   assertParent(file,parentId);
   if(file.writersCanShare!==false)fail('privacy');
   const matches=(await listPermissions(api,docId)).filter(p=>isGrantee(p,email??'*'));
   if(matches.length>1)fail('conflict');
   const existing=matches[0];
   const correct=existing?.role===role&&(email!==null||existing?.allowFileDiscovery===false);
   if(correct)return false;
   // Preserve preexisting named grants and operator roles. Only our grants can be changed.
   if(existing&&(!managed||existing.role==='owner')||email===api.ownerEmail.toLowerCase())fail('homework_role_conflict');
   beforeWrite();
   if(existing){
    await api.json(permissionUrl(docId,existing.id),jsonRequest('PATCH',{role,...(email===null?{allowFileDiscovery:false}:{})}));
   }else{
    const body=email===null?{type:'anyone',role,allowFileDiscovery:false}:{type:'user',role,emailAddress:email};
    const query=email===null?'':'&sendNotificationEmail=false';
    await api.json(`${API}/${docId}/permissions?supportsAllDrives=false${query}`,jsonRequest('POST',body));
   }
   return true;
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
  async revoke(docId:string,grantee:string){
   if(grantee!=='*')return (await revokeHomeworkShare(api,docId,grantee)).revoked;
   await homeworkDoc(api,docId);
   const permissions=(await listPermissions(api,docId)).filter(p=>p.type==='anyone');
   for(const p of permissions)await api.request(permissionUrl(docId,p.id),{method:'DELETE'},[404]);
   return permissions.length>0;
  },
 };
}
