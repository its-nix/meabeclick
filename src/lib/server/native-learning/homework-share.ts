import {decodeWorkspace} from '../../learning/workspace.ts';
import {handle} from '../db.ts';
import {studentGoogleEmail} from '../google-login.ts';
import {driveFileId,type ApprovalSheet} from './approval-sync.ts';

/** Named-user, reader-only sharing seam. The real one is central-drive/share.ts; tests use a fake. */
export interface HomeworkShareApi {share(docId:string,email:string):Promise<{shared:boolean}>;revoke(docId:string,email:string):Promise<{revoked:boolean}>}
export interface HomeworkShareResult {shared:number;revoked:number;skippedNoEmail:number;failed:number}
const numeric=(value:unknown)=>{const m=String(value??'').match(/^student-(\d+)$/);return m?Number(m[1]):null;};
const safeCode=(e:unknown)=>String((e as Error)?.message??'error').replace(/[^\w :;,.-]/g,'').slice(0,80)||'error';

/** After a homework Material is approved and published to a live assignment, share the Doc with the student's own
 * Google account; withdraw (unpublish, cancel, or a changed account) revokes exactly what was granted.
 * A student with no Google email yet is skipped quietly with a recorded status and retried on the next pass. */
export async function syncHomeworkShares(input:{sheet:ApprovalSheet;api:HomeworkShareApi;emailFor?:(studentId:number)=>string|null}):Promise<HomeworkShareResult> {
 const emailFor=input.emailFor??studentGoogleEmail,db=handle(),now=new Date().toISOString(),out:HomeworkShareResult={shared:0,revoked:0,skippedNoEmail:0,failed:0};
 const {grids}=await input.sheet.read(),snapshot=decodeWorkspace(grids,1,{tolerateRuleViolations:true});
 const eligible=new Map<string,{studentId:number;docId:string}>();
 for(const m of snapshot.Materials){
  if(m.kind!=='homework'||m.provider!=='google_docs'||m.review_status!=='approved'||m.publication_status!=='published'||m.audience!=='student'||m.is_demo===true)continue;
  const live=snapshot.Assignments.some(a=>a.material_id===m.material_id&&a.student_id===m.student_id&&['assigned','submitted','reviewed'].includes(String(a.status))&&a.is_demo===false);
  const studentId=numeric(m.student_id),docId=driveFileId(String(m.url));
  if(live&&studentId!==null&&docId)eligible.set(String(m.material_id),{studentId,docId});
 }
 const record=db.prepare(`INSERT INTO native_homework_shares (material_id,student_id,doc_id,email,status,code,updated_at) VALUES (?,?,?,?,?,?,?)
  ON CONFLICT(material_id) DO UPDATE SET student_id=excluded.student_id,doc_id=excluded.doc_id,email=excluded.email,status=excluded.status,code=excluded.code,updated_at=excluded.updated_at`);
 const previous=new Map(db.prepare('SELECT * FROM native_homework_shares').all().map(r=>[String(r.material_id),r]));
 // Revoke first: withdrawn materials and accounts that changed.
 for(const [id,row] of previous){
  const want=eligible.get(id);
  if(row.status!=='shared'||!row.email)continue;
  const email=want?emailFor(want.studentId):null;
  if(want&&email&&email.toLowerCase()===String(row.email).toLowerCase())continue;
  try{await input.api.revoke(String(row.doc_id),String(row.email));record.run(id,row.student_id,row.doc_id,row.email,'revoked',null,now);out.revoked++;}
  catch(e){record.run(id,row.student_id,row.doc_id,row.email,'shared',`revoke_failed: ${safeCode(e)}`,now);out.failed++;}
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
