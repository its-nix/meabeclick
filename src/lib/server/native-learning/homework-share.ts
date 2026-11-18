import {decodeWorkspaceRows} from '../../learning/workspace.ts';
import {handle} from '../db.ts';
import {studentGoogleEmail} from '../google-login.ts';
import {driveFileId,type ApprovalSheet} from './approval-sync.ts';

/** Named-user, reader-only sharing seam. The real one is central-drive/share.ts; tests use a fake. */
export interface HomeworkShareApi {share(docId:string,email:string):Promise<{shared:boolean}>;revoke(docId:string,email:string):Promise<{revoked:boolean}>}
export interface HomeworkShareResult {shared:number;revoked:number;skippedNoEmail:number;failed:number;problems:string[];error?:string}
const numeric=(value:unknown)=>{const m=String(value??'').match(/^student-(\d+)$/);return m?Number(m[1]):null;};
const safeCode=(e:unknown)=>String((e as Error)?.message??'error').replace(/[^\w :;,.-]/g,'').slice(0,80)||'error';

/** The Material must be the site's own homework Material for this student (`native-<job>-homework` of a live job of that student) and name a Google Doc, so a Sheet edit cannot make the site share any other file. */
function registeredHomework(materialId:string,studentId:number,url:string):boolean{
 const m=materialId.match(/^native-(\d+)-homework$/);if(!m)return false;
 try{const u=new URL(url);if(u.protocol!=='https:'||u.hostname!=='docs.google.com'||!/^\/document\/d\/[\w-]{10,}/.test(u.pathname))return false;}catch{return false;}
 const job=handle().prepare('SELECT student_id,state FROM native_lesson_jobs WHERE id=?').get(Number(m[1]));
 return !!job&&Number(job.student_id)===studentId&&job.state!=='cancelled';
}
/** After a homework Material is approved and published to a live assignment, share the Doc with the student's own
 * Google account; withdraw (unpublish, cancel, or a changed account) revokes exactly what was granted.
 * A student with no Google email yet is skipped quietly with a recorded status and retried on the next pass. */
export async function syncHomeworkShares(input:{sheet:ApprovalSheet;api:HomeworkShareApi;emailFor?:(studentId:number)=>string|null}):Promise<HomeworkShareResult> {
 const emailFor=input.emailFor??studentGoogleEmail,db=handle(),now=new Date().toISOString(),out:HomeworkShareResult={shared:0,revoked:0,skippedNoEmail:0,failed:0,problems:[]};
 let snapshot:{Materials:ReturnType<typeof decodeWorkspaceRows>['rows'];Assignments:ReturnType<typeof decodeWorkspaceRows>['rows']};
 try{
  const {grids}=await input.sheet.read(),materials=decodeWorkspaceRows(grids,'Materials'),assignments=decodeWorkspaceRows(grids,'Assignments');
  snapshot={Materials:materials.rows,Assignments:assignments.rows};out.problems=[...materials.problems,...assignments.problems];
 }catch(e){out.error=safeCode(e);return out;}
 const eligible=new Map<string,{studentId:number;docId:string}>();
 for(const m of snapshot.Materials){
  if(m.kind!=='homework'||m.provider!=='google_docs'||m.review_status!=='approved'||m.publication_status!=='published'||m.audience!=='student'||m.is_demo===true)continue;
  const live=snapshot.Assignments.some(a=>a.material_id===m.material_id&&a.student_id===m.student_id&&['assigned','submitted','reviewed'].includes(String(a.status))&&a.is_demo===false);
  const studentId=numeric(m.student_id),docId=driveFileId(String(m.url));
  if(live&&studentId!==null&&docId&&registeredHomework(String(m.material_id),studentId,String(m.url)))eligible.set(String(m.material_id),{studentId,docId});
 }
 // A Doc may belong to one student only: two materials of different students naming one Doc are both refused.
 const owners=new Map<string,Set<number>>();for(const e of eligible.values())owners.set(e.docId,(owners.get(e.docId)??new Set()).add(e.studentId));
 for(const [id,e] of [...eligible])if((owners.get(e.docId)?.size??0)>1){eligible.delete(id);out.problems.push(`${id}: doc shared by several students`);}
 const record=db.prepare(`INSERT INTO native_homework_shares (material_id,student_id,doc_id,email,status,code,updated_at) VALUES (?,?,?,?,?,?,?)
  ON CONFLICT(material_id) DO UPDATE SET student_id=excluded.student_id,doc_id=excluded.doc_id,email=excluded.email,status=excluded.status,code=excluded.code,updated_at=excluded.updated_at`);
 const previous=new Map(db.prepare('SELECT * FROM native_homework_shares').all().map(r=>[String(r.material_id),r]));
 const addPending=db.prepare(`INSERT INTO native_homework_revocations (material_id,email,doc_id,code,updated_at) VALUES (?,?,?,?,?)
  ON CONFLICT(material_id,email) DO UPDATE SET code=excluded.code,updated_at=excluded.updated_at`);
 const dropPending=db.prepare('DELETE FROM native_homework_revocations WHERE material_id=? AND email=?');
 // Grants whose revoke failed earlier, after the Doc was shared with a newer address, are retried until they succeed.
 for(const p of db.prepare('SELECT * FROM native_homework_revocations').all()){
  const cur=previous.get(String(p.material_id));
  if(cur?.status==='shared'&&String(cur.email).toLowerCase()===String(p.email))continue; // the main loop below owns this one
  const want=eligible.get(String(p.material_id)),wanted=want?emailFor(want.studentId):null;
  if(wanted&&wanted.toLowerCase()===String(p.email)){dropPending.run(p.material_id,p.email);continue;} // wanted again: nothing to revoke
  try{await input.api.revoke(String(p.doc_id),String(p.email));dropPending.run(p.material_id,p.email);out.revoked++;}
  catch(e){addPending.run(p.material_id,p.email,p.doc_id,`revoke_failed: ${safeCode(e)}`,now);out.failed++;}
 }
 // Revoke first: withdrawn materials and accounts that changed.
 for(const [id,row] of previous){
  const want=eligible.get(id);
  if(row.status!=='shared'||!row.email)continue;
  const email=want?emailFor(want.studentId):null;
  if(want&&email&&email.toLowerCase()===String(row.email).toLowerCase())continue;
  try{await input.api.revoke(String(row.doc_id),String(row.email));record.run(id,row.student_id,row.doc_id,row.email,'revoked',null,now);dropPending.run(id,String(row.email).toLowerCase());out.revoked++;}
  catch(e){record.run(id,row.student_id,row.doc_id,row.email,'shared',`revoke_failed: ${safeCode(e)}`,now);addPending.run(id,String(row.email).toLowerCase(),row.doc_id,`revoke_failed: ${safeCode(e)}`,now);out.failed++;}
 }
 for(const [id,row] of previous)if(!eligible.has(id)&&row.status!=='shared'&&row.status!=='revoked')record.run(id,row.student_id,row.doc_id,row.email??null,'revoked',null,now);
 for(const [id,want] of eligible){
  const row=db.prepare('SELECT status,email FROM native_homework_shares WHERE material_id=?').get(id);
  const email=emailFor(want.studentId);
  if(!email){record.run(id,want.studentId,want.docId,null,'no_google_email',null,now);out.skippedNoEmail++;continue;}
  if(row?.status==='shared'&&String(row.email).toLowerCase()===email.toLowerCase())continue;
  try{await input.api.share(want.docId,email);record.run(id,want.studentId,want.docId,email,'shared',null,now);out.shared++;}
  catch(e){record.run(id,want.studentId,want.docId,email,'failed',safeCode(e),now);out.failed++;}
 }
 return out;
}
export function homeworkShareStatus(materialId:string){const r=handle().prepare('SELECT status,email,code FROM native_homework_shares WHERE material_id=?').get(materialId);return r?{status:String(r.status),email:r.email===null?null:String(r.email),code:r.code===null?null:String(r.code)}:null;}
