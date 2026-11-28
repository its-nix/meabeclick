import {decodeWorkspaceRows} from '../../learning/workspace.ts';
import {handle} from '../db.ts';
import {parentGoogleEmail,studentGoogleEmail} from '../google-login.ts';
import type {FamilyAccess} from '../family.ts';
import type {ApprovalSheet} from './approval-sync.ts';

const LINK='*';
const idPattern=/^[\w-]{10,200}$/;
type Role='reader'|'writer';
export type HomeworkGrant={role:Role|null;permissionId:string|null};
type Target={materialId:string;studentId:number;docId:string;reviewFolderId:string;releaseId:string};
export interface HomeworkShareApi {
 place(target:Target):Promise<string>;
 restrictSharing(docId:string,parentId:string,grants:ReadonlyMap<string,Role>,prior:ReadonlyMap<string,HomeworkGrant>):Promise<void>;
 ensure(docId:string,parentId:string,grantee:string,role:Role,prior:HomeworkGrant|undefined,checkCurrent:()=>Promise<void>,beforeWrite:()=>void):Promise<{created:boolean;permissionId:string}>;
 revoke(docId:string,grantee:string,grant:HomeworkGrant):Promise<boolean>;
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
  if(!jobId||!docId||typeof m.release_id!=='string'||!m.release_id.trim())continue;
  const job=currentJob(Number(jobId));
  if(job?.state!=='review'||m.student_id!==`student-${job.student_id}`||!job.bundle)continue;
  const receipt=JSON.parse(String(job.bundle));
  if(receipt.homework?.id!==docId||receipt.sourceHash!==m.content_sha256||!idPattern.test(receipt.reviewFolderId??''))continue;
  const live=assignments.rows.some(a=>a.assignment_id===`${materialId}-assignment`&&a.material_id===materialId&&a.student_id===m.student_id&&
    a.lesson_id===`booking-${job.booking_id}`&&a.is_demo===false&&['assigned','submitted','reviewed'].includes(String(a.status)));
  if(!live)continue;
  if(seen.has(docId)){for(const [key,t] of targets)if(t.docId===docId)targets.delete(key);continue;}
  seen.add(docId);
  targets.set(materialId,{materialId,docId,studentId:Number(job.student_id),reviewFolderId:receipt.reviewFolderId,releaseId:m.release_id});
 }
 return {targets,problems:[...materials.problems,...assignments.problems]};
}

const safeCode=(e:unknown)=>String((e as Error)?.message??'error').replace(/[^\w :;,.-]/g,'').slice(0,80)||'error';

export async function syncHomeworkShares(input:{sheet:ApprovalSheet;api:HomeworkShareApi;emailFor?:(studentId:number)=>string|null;parentEmailFor?:(studentId:number)=>string|null}) {
 const db=handle(),out={shared:0,revoked:0,failed:0,problems:[] as string[],error:undefined as string|undefined};
 let snapshot:ReturnType<typeof eligibleHomework>;
 try{snapshot=eligibleHomework((await input.sheet.read()).grids);}catch(e){out.error=safeCode(e);return out;}
 out.problems=snapshot.problems;
 function wanted(studentId:number):Map<string,Role>|null {
  const student=(input.emailFor??studentGoogleEmail)(studentId)?.toLowerCase();
  const parent=student?(input.parentEmailFor??parentGoogleEmail)(studentId)?.toLowerCase():null;
  if(parent&&parent===student)return null;
  if(!student)return new Map([[LINK,'writer']]);
  return new Map([[student,'writer'],...(parent?[[parent,'reader'] as const]:[])]);
 }
 const desired=new Map<string,Map<string,Role>>();
 for(const target of snapshot.targets.values()){
  const grants=wanted(target.studentId);
  if(!grants){out.failed++;out.problems.push(`${target.materialId}: student and parent use the same Google account`);continue;}
  desired.set(target.materialId,grants);
 }
 const record=db.prepare(`INSERT INTO native_homework_grants(material_id,doc_id,grantee,role) VALUES (?,?,?,?)
   ON CONFLICT(material_id,doc_id,grantee) DO NOTHING`);
 const bind=db.prepare(`UPDATE native_homework_grants SET permission_id=? WHERE material_id=? AND doc_id=? AND grantee=?`);
 const forget=db.prepare(`DELETE FROM native_homework_grants WHERE material_id=? AND doc_id=? AND grantee=?`);
 const pending=db.prepare(`INSERT INTO native_homework_delivery(material_id,student_id,doc_id,ready,access_mode) VALUES (?,?,?,0,?)
   ON CONFLICT(material_id) DO UPDATE SET student_id=excluded.student_id,doc_id=excluded.doc_id,ready=CASE WHEN native_homework_delivery.doc_id=excluded.doc_id
    AND native_homework_delivery.access_mode=excluded.access_mode THEN native_homework_delivery.ready ELSE 0 END,
   access_mode=excluded.access_mode`);
 const ready=db.prepare('UPDATE native_homework_delivery SET ready=1,resource_key=? WHERE material_id=?');
 const hide=db.prepare('UPDATE native_homework_delivery SET ready=0 WHERE material_id=?');
 const grantRows=db.prepare('SELECT grantee,role,permission_id FROM native_homework_grants WHERE material_id=? AND doc_id=?');
 const decodeGrant=(row:Record<string,unknown>):HomeworkGrant=>({
  role:row.role as Role|null,permissionId:row.permission_id as string|null,
 });
 const failed=new Set<string>();
 for(const old of db.prepare('SELECT material_id FROM native_homework_delivery').all()){
  if(!desired.has(String(old.material_id)))hide.run(old.material_id);
 }
 async function revoke(id:string,doc:string,grantee:string,grant:HomeworkGrant){
  if(!registeredDoc(id,doc))throw Error('unverified_homework_grant');
  if(await input.api.revoke(doc,grantee,grant))out.revoked++;
  forget.run(id,doc,grantee);
 }
 for(const row of db.prepare('SELECT material_id,doc_id,grantee,role,permission_id FROM native_homework_grants').all()){
  const id=String(row.material_id),doc=String(row.doc_id),grantee=String(row.grantee),grant=decodeGrant(row);
  if(grant.role&&snapshot.targets.get(id)?.docId===doc&&desired.get(id)?.get(grantee)===grant.role)continue;
  hide.run(id);
  try{await revoke(id,doc,grantee,grant);}
  catch(e){failed.add(id);out.failed++;out.problems.push(`${id}: revoke ${safeCode(e)}`);}
 }
 for(const [id,grants] of desired){
  if(failed.has(id))continue;
  const target=snapshot.targets.get(id)!;
  pending.run(id,target.studentId,target.docId,grants.has(LINK)?'link':'named');
  const checkCurrent=async()=>{
   // Read the approval again at the grant boundary, then check the current local identities.
   const current=eligibleHomework((await input.sheet.read()).grids).targets.get(id);
   if(JSON.stringify(current)!==JSON.stringify(target)||JSON.stringify([...(wanted(target.studentId)??[])])!==JSON.stringify([...grants])){
    throw Error('homework_approval_changed');
   }
  };
  let grantAttempted=false;
  let recoveringGrant=false;
  try{
   const parentId=await input.api.place(target);
   const prior=new Map(grantRows.all(id,target.docId).map(row=>[String(row.grantee),decodeGrant(row)]));
   recoveringGrant=[...prior.values()].some(grant=>!grant.permissionId);
   await input.api.restrictSharing(target.docId,parentId,grants,prior);
   for(const [grantee,role] of grants){
    const result=await input.api.ensure(target.docId,parentId,grantee,role,prior.get(grantee),checkCurrent,()=>{
     record.run(id,target.docId,grantee,role);
     grantAttempted=true;
    });
    bind.run(result.permissionId,id,target.docId,grantee);
    if(result.created)out.shared++;
   }
   const key=await input.api.verifyDelivery(target.docId,parentId,grants);
   const current=currentJob(Number(/^native-(\d+)-homework$/.exec(id)?.[1]));
   if(grantAttempted||recoveringGrant)await checkCurrent();
   else if(current?.state!=='review'||JSON.stringify([...(wanted(target.studentId)??[])])!==JSON.stringify([...grants]))throw Error('homework_approval_changed');
   ready.run(key,id);
  }catch(e){
   hide.run(id);out.failed++;out.problems.push(`${id}: ${safeCode(e)}`);
   // Even if Drive lost its response, stop an obsolete grant from surviving the failed publication pass.
   let withdraw=['homework_approval_changed','homework_role_conflict','privacy'].includes(safeCode(e));
   if((grantAttempted||recoveringGrant)&&!withdraw){
    try{await checkCurrent();}catch{withdraw=true;}
   }
   if(withdraw){
    for(const row of grantRows.all(id,target.docId)){
     try{await revoke(id,target.docId,String(row.grantee),decodeGrant(row));}
     catch(error){out.problems.push(`${id}: revoke ${safeCode(error)}`);}
    }
   }
  }
 }

 return out;
}

/** The parent preview of the student board never receives forwardable links. */
export function studentHomeworkLinks(access:FamilyAccess,studentId:number) {
 if(!access.students.some(student=>student.id===studentId))return [];
 const parentPreview=access.identity.kind!=='student'&&!access.isSelf;
 const parentEmail=parentPreview?parentGoogleEmail(studentId)?.toLowerCase():null;
 if(parentPreview&&!parentEmail)return [];
 return handle().prepare(`SELECT d.doc_id,d.access_mode,d.resource_key FROM native_homework_delivery d
  JOIN native_lesson_jobs j ON d.material_id='native-'||j.id||'-homework' AND j.student_id=d.student_id
  JOIN bookings_v2 b ON b.id=j.booking_id AND b.student_id=j.student_id
  WHERE d.student_id=? AND d.ready=1 AND b.status='confirmed' AND j.state='review' AND json_extract(j.bundle,'$.homework.id')=d.doc_id
  AND (?=0 OR (d.access_mode='named' AND EXISTS (
    SELECT 1 FROM native_homework_grants g WHERE g.material_id=d.material_id AND g.doc_id=d.doc_id
    AND g.grantee=? AND g.role='reader' AND g.permission_id IS NOT NULL
  ))) ORDER BY j.id DESC`).all(studentId,Number(parentPreview),parentEmail??null)
  .filter(r=>idPattern.test(String(r.doc_id))&&(r.access_mode==='named')===Boolean(studentGoogleEmail(studentId)))
  .map(r=>{
   const forwardable=r.access_mode==='link';
   const url=new URL(`https://docs.google.com/document/d/${r.doc_id}/${parentPreview?'view':'edit'}`);
   if(forwardable&&typeof r.resource_key==='string')url.searchParams.set('resourcekey',r.resource_key);
   return {url:url.href,forwardable};
  });
}
