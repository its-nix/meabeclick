import {decodeWorkspaceRows} from '../../learning/workspace.ts';
import {handle} from '../db.ts';
import {parentGoogleEmail,studentGoogleEmail} from '../google-login.ts';
import type {FamilyAccess} from '../family.ts';
import type {ApprovalSheet} from './approval-sync.ts';

const LINK='*';
const idPattern=/^[\w-]{10,200}$/;
type Role='reader'|'writer';
type Target={materialId:string;studentId:number;docId:string;reviewFolderId:string};
export interface HomeworkShareApi {
 place(target:Target):Promise<string>;
 restrictSharing(docId:string,parentId:string,managedLink:boolean):Promise<void>;
 ensure(docId:string,parentId:string,grantee:string,role:Role,managed:boolean,beforeWrite:()=>void):Promise<boolean>;
 revoke(docId:string,grantee:string):Promise<boolean>;
 verifyDelivery(docId:string,parentId:string,grants:ReadonlyMap<string,Role>):Promise<string|null>;
}

function homeworkId(url:unknown) {
 const match=String(url).match(/^https:\/\/docs\.google\.com\/document\/d\/([\w-]{10,200})(?:\/edit)?(?:[?#].*)?$/);
 return match?.[1]??null;
}
function registeredDoc(materialId:string,docId:string){
 const id=/^native-(\d+)-homework$/.exec(materialId)?.[1];
 if(!id||!idPattern.test(docId))return false;
 const row=handle().prepare('SELECT bundle FROM native_lesson_jobs WHERE id=?').get(Number(id));
 return Boolean(row?.bundle&&JSON.parse(String(row.bundle)).homework?.id===docId);
}
const currentJob=(id:number)=>handle().prepare(`SELECT j.student_id,j.booking_id,j.state,j.bundle
 FROM native_lesson_jobs j JOIN bookings_v2 b ON b.id=j.booking_id AND b.student_id=j.student_id
 WHERE j.id=? AND b.status='confirmed'`).get(id);

function eligibleHomework(grids:Awaited<ReturnType<ApprovalSheet['read']>>['grids']) {
 const materials=decodeWorkspaceRows(grids,'Materials'),assignments=decodeWorkspaceRows(grids,'Assignments');
 const targets=new Map<string,Target>();
 const seen=new Set<string>();
 for(const m of materials.rows){
  if(m.kind!=='homework'||m.provider!=='google_docs'||m.review_status!=='approved'||m.publication_status!=='published'||m.audience!=='student'||m.is_demo!==false)continue;
  const materialId=String(m.material_id),jobId=/^native-(\d+)-homework$/.exec(materialId)?.[1];
  const docId=homeworkId(m.url);
  if(!jobId||!docId)continue;
  const job=currentJob(Number(jobId));
  if(job?.state!=='review'||m.student_id!==`student-${job.student_id}`||!job.bundle)continue;
  const receipt=JSON.parse(String(job.bundle));
  if(receipt.homework?.id!==docId||receipt.sourceHash!==m.content_sha256||!idPattern.test(receipt.reviewFolderId??''))continue;
  const live=assignments.rows.some(a=>a.assignment_id===`${materialId}-assignment`&&a.material_id===materialId&&a.student_id===m.student_id&&
    a.lesson_id===`booking-${job.booking_id}`&&a.is_demo===false&&['assigned','submitted','reviewed'].includes(String(a.status)));
  if(!live)continue;
  if(seen.has(docId)){for(const [key,t] of targets)if(t.docId===docId)targets.delete(key);continue;}
  seen.add(docId);
  targets.set(materialId,{materialId,docId,studentId:Number(job.student_id),reviewFolderId:receipt.reviewFolderId});
 }
 return {targets,problems:[...materials.problems,...assignments.problems]};
}

const safeCode=(e:unknown)=>String((e as Error)?.message??'error').replace(/[^\w :;,.-]/g,'').slice(0,80)||'error';

export async function syncHomeworkShares(input:{sheet:ApprovalSheet;api:HomeworkShareApi;emailFor?:(studentId:number)=>string|null;parentEmailFor?:(studentId:number)=>string|null}) {
 const db=handle(),out={shared:0,revoked:0,failed:0,problems:[] as string[],error:undefined as string|undefined};
 let snapshot:ReturnType<typeof eligibleHomework>;
 try{snapshot=eligibleHomework((await input.sheet.read()).grids);}catch(e){out.error=safeCode(e);return out;}
 out.problems=snapshot.problems;
 const desired=new Map<string,Map<string,Role>>();
 for(const target of snapshot.targets.values()){
  const student=(input.emailFor??studentGoogleEmail)(target.studentId)?.toLowerCase();
  const parent=student?(input.parentEmailFor??parentGoogleEmail)(target.studentId)?.toLowerCase():null;
  if(parent&&parent===student){out.failed++;out.problems.push(`${target.materialId}: student and parent use the same Google account`);continue;}
  desired.set(target.materialId,student?new Map([[student,'writer'],...(parent?[[parent,'reader'] as const]:[])]):new Map([[LINK,'writer']]));
 }
 const record=db.prepare(`INSERT OR IGNORE INTO native_homework_grants VALUES (?,?,?)`);
 const forget=db.prepare(`DELETE FROM native_homework_grants WHERE material_id=? AND doc_id=? AND grantee=?`);
 const pending=db.prepare(`INSERT INTO native_homework_delivery(material_id,student_id,doc_id,ready,access_mode) VALUES (?,?,?,0,?)
   ON CONFLICT(material_id) DO UPDATE SET student_id=excluded.student_id,doc_id=excluded.doc_id,ready=CASE WHEN native_homework_delivery.doc_id=excluded.doc_id
    AND native_homework_delivery.access_mode=excluded.access_mode THEN native_homework_delivery.ready ELSE 0 END,
   access_mode=excluded.access_mode`);
 const ready=db.prepare('UPDATE native_homework_delivery SET ready=1,resource_key=? WHERE material_id=?');
 const hide=db.prepare('UPDATE native_homework_delivery SET ready=0 WHERE material_id=?');
 const managed=new Set<string>();
 const failed=new Set<string>();
 for(const old of db.prepare('SELECT material_id FROM native_homework_delivery').all()){
  if(!desired.has(String(old.material_id)))hide.run(old.material_id);
 }
 for(const row of db.prepare('SELECT material_id,doc_id,grantee FROM native_homework_grants').all()){
  const id=String(row.material_id),doc=String(row.doc_id),grantee=String(row.grantee);
  if(snapshot.targets.get(id)?.docId===doc&&desired.get(id)?.has(grantee)){managed.add(JSON.stringify([id,doc,grantee]));continue;}
  hide.run(id);
  if(!registeredDoc(id,doc)){out.failed++;out.problems.push(`${id}: unverified legacy grant`);continue;}
  try{if(await input.api.revoke(doc,grantee))out.revoked++;forget.run(id,doc,grantee);}
  catch(e){failed.add(id);out.failed++;out.problems.push(`${id}: revoke ${safeCode(e)}`);}
 }
 for(const [id,grants] of desired){
  if(failed.has(id))continue;
  const target=snapshot.targets.get(id)!;
  pending.run(id,target.studentId,target.docId,grants.has(LINK)?'link':'named');
  try{
   const parentId=await input.api.place(target);
   await input.api.restrictSharing(target.docId,parentId,grants.has(LINK)&&managed.has(JSON.stringify([id,target.docId,LINK])));
   for(const [grantee,role] of grants){
    const owns=managed.has(JSON.stringify([id,target.docId,grantee]));
    if(await input.api.ensure(target.docId,parentId,grantee,role,owns,()=>record.run(id,target.docId,grantee)))out.shared++;
   }
   const key=await input.api.verifyDelivery(target.docId,parentId,grants);
   ready.run(key,id);
  }catch(e){hide.run(id);out.failed++;out.problems.push(`${id}: ${safeCode(e)}`);}
 }
 return out;
}

/** The parent preview of the student board never receives forwardable links. */
export function studentHomeworkLinks(access:FamilyAccess,studentId:number) {
 if(!access.students.some(student=>student.id===studentId)||access.identity.kind!=='student'&&!access.isSelf)return [];
 return handle().prepare(`SELECT d.doc_id,d.access_mode,d.resource_key FROM native_homework_delivery d
  JOIN native_lesson_jobs j ON d.material_id='native-'||j.id||'-homework' AND j.student_id=d.student_id
  JOIN bookings_v2 b ON b.id=j.booking_id AND b.student_id=j.student_id
  WHERE d.student_id=? AND d.ready=1 AND b.status='confirmed' AND j.state='review' AND json_extract(j.bundle,'$.homework.id')=d.doc_id ORDER BY j.id DESC`).all(studentId)
  .filter(r=>idPattern.test(String(r.doc_id))&&(r.access_mode==='named')===Boolean(studentGoogleEmail(studentId)))
  .map(r=>{
   const forwardable=r.access_mode==='link';
   const url=new URL(`https://docs.google.com/document/d/${r.doc_id}/edit`);
   if(forwardable&&typeof r.resource_key==='string')url.searchParams.set('resourcekey',r.resource_key);
   return {url:url.href,forwardable};
  });
}
