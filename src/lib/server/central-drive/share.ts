import {CentralDriveError,DOC} from './api.ts';
import type {CentralFile} from './api.ts';
import {isValidEmailAddress,normalizeEmail} from '../email-address.ts';

/**
 * Direct (named-user, reader) sharing of a student-facing homework Doc.
 * Named-user permissions pass the central-drive privacy guard; link sharing is deliberately NOT
 * implemented here (see Todoist 6j2xWJ2fxPJxGm3H for the fallback design).
 */
interface ShareApi {scope:string;ownerEmail:string;json:(url:string,init?:RequestInit)=>Promise<any>;request:(url:string,init?:RequestInit,allowed?:number[])=>Promise<Response>}
interface Permission {id:string;type:string;role?:string;emailAddress?:string}
const API='https://www.googleapis.com/drive/v3/files',ID=/^[\w-]{10,}$/;
const fail=(code:string):never=>{throw new CentralDriveError(code);};

async function homeworkDoc(api:ShareApi,id:string){
 if(!ID.test(id))fail('google_response');
 const file=await api.json(`${API}/${id}?fields=id,mimeType,owners(emailAddress),trashed,appProperties`) as CentralFile;
 if(file.id!==id||file.mimeType!==DOC||file.trashed||file.appProperties?.meaCentralScope!==api.scope)fail('conflict');
 if(!file.owners?.some(o=>o.emailAddress?.toLowerCase()===api.ownerEmail.toLowerCase()))fail('ownership');
 return file;
}
async function listPermissions(api:ShareApi,id:string):Promise<Permission[]>{
 const out=await api.json(`${API}/${id}/permissions?fields=permissions(id,type,role,emailAddress)&supportsAllDrives=false`);
 if(!Array.isArray(out.permissions))fail('google_response');return out.permissions;
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
