import { learningTopicProblems } from '../../learning/model.ts';
import type { ReportTopic, ReportMaterial, TopicChoice, TopicReportRevision as CoverageRevision } from '../../report-coverage.ts';
export type { ReportTopic, ReportMaterial, TopicChoice } from '../../report-coverage.ts';
import { createHash } from 'node:crypto';
import { handle } from '../db.ts';
import { latestPublished, byVersion } from '../materials.ts';
import { planData, planForEnrollment } from '../plans/store.ts';

export interface TopicReportRevision extends CoverageRevision { id: number }
export interface TopicCoverageInput { source: 'manual'|'material'; materialSlug?: string; materialId?: number; topics: TopicChoice[] }
const text = (v: unknown, max: number): v is string => typeof v==='string' && !!v.trim() && v.length<=max;
const strings = (v: unknown, max: number): v is string[] => Array.isArray(v) && v.length<=max && v.every(x=>text(x,120)) && new Set(v).size===v.length;
export class ReportRevisionConflict extends Error { constructor(){super('report revision conflict');} }

function skillsForBooking(bookingId: number): string[] {
 const b=handle().prepare('SELECT enrollment_id FROM bookings_v2 WHERE id=?').get(bookingId) as {enrollment_id:number|null}|undefined;
 const p=b?.enrollment_id ? planForEnrollment(b.enrollment_id) : null;
 return p ? planData(p.id).nodes.filter(n=>n.kind==='skill').map(n=>n.key) : [];
}
/** Assignments carry explicit booking/student IDs; legacy lessons need an unambiguous booked time. No title matching. */
export function eligibleReportMaterials(bookingId: number): ReportMaterial[] {
 const rows=handle().prepare(`SELECT DISTINCT a.lesson_slug FROM learning_assignments a JOIN bookings_v2 b ON b.id=a.booking_id AND b.student_id=a.student_id WHERE b.id=?
 UNION SELECT l.slug AS lesson_slug FROM lessons l JOIN bookings_v2 b ON b.start=l.lesson_at WHERE b.id=? AND b.status='confirmed' AND (SELECT count(*) FROM bookings_v2 other WHERE other.start=l.lesson_at AND other.status='confirmed')=1`).all(bookingId,bookingId) as {lesson_slug:string}[];
 const known=new Set(skillsForBooking(bookingId));
 return rows.flatMap(({lesson_slug:slug})=>{
  const row=latestPublished(slug,'plan'); if(!row)return [];
  try {const plan=JSON.parse(row.content);const sceneIds=Array.isArray(plan.learning?.scenes)?plan.learning.scenes.map((s:{id:string})=>s.id).filter((id:unknown)=>text(id,120)):[];
   const raw=plan.learning?.topics;let topics:ReportTopic[]=[];
   if(raw!=null){
    if(learningTopicProblems(plan.learning,[...known]).length)return [];
    topics=raw.map((t:ReportTopic)=>({id:t.id,title:t.title,sceneIds:t.sceneIds,skillKeys:t.skillKeys}));
   }
   return [{slug,materialId:row.id,version:row.version,hash:createHash('sha256').update(row.content).digest('hex'),title:typeof plan.title==='string'?plan.title:slug,sceneIds,topics}];
  }catch{return [];}
 });
}
export function topicReportHistory(bookingId: number): TopicReportRevision[] {
 const rows=handle().prepare(`SELECT v.* FROM lesson_report_revisions v JOIN lesson_reports r ON r.id=v.report_id WHERE r.booking_id=? ORDER BY v.revision`).all(bookingId) as {id:number;revision:number;source:'manual'|'material';snapshot_json:string|null;topics_json:string}[];
 return rows.map(r=>({id:r.id,revision:r.revision,source:r.source,snapshot:r.snapshot_json?JSON.parse(r.snapshot_json):null,topics:JSON.parse(r.topics_json)}));
}
export const latestTopicReport=(bookingId:number):TopicReportRevision|null=>topicReportHistory(bookingId).at(-1)??null;
export function validateTopicCoverage(bookingId:number, raw:unknown): Omit<TopicReportRevision,'id'|'revision'> {
 if(!raw||typeof raw!=='object')throw new Error('invalid coverage');
 const input=raw as TopicCoverageInput;
 if(!['manual','material'].includes(input.source)||!Array.isArray(input.topics)||input.topics.length>40)throw new Error('invalid coverage');
 const prior=latestTopicReport(bookingId);
 const pinned=prior?.snapshot;
 const snapshot=input.source==='material' ? (pinned && pinned.slug===input.materialSlug && (input.materialId===undefined || input.materialId===pinned.materialId) ? pinned : eligibleReportMaterials(bookingId).find(m=>m.slug===input.materialSlug && (input.materialId===undefined || m.materialId===input.materialId))) : null;
 if(input.source==='material'&&!snapshot)throw new Error('material not associated with booking');
 const known=new Set(skillsForBooking(bookingId)),ids=new Set<string>();
 const topics=input.topics.map(t=>{
  if(!t||!text(t.id,120)||ids.has(t.id)||!text(t.title,200)||!strings(t.sceneIds,12)||!strings(t.skillKeys,20)||typeof t.covered!=='boolean'||!(t.comment===null||typeof t.comment==='string'&&t.comment.length<=2000))throw new Error('invalid topic');
  ids.add(t.id);
  if(t.sceneIds.some(id=>!snapshot?.sceneIds.includes(id))||t.skillKeys.some(key=>!known.has(key)))throw new Error('foreign scene or skill');
  return {id:t.id,title:t.title,sceneIds:t.sceneIds,skillKeys:t.skillKeys,covered:t.covered,comment:t.comment};
 });
 if(snapshot?.topics.length){
  if(topics.length!==snapshot.topics.length||topics.some(t=>{const original=snapshot.topics.find(o=>o.id===t.id);return !original||JSON.stringify({...t,covered:undefined,comment:undefined})!==JSON.stringify(original);}))throw new Error('manifest mismatch');
 }
 return {source:input.source,snapshot:snapshot??null,topics};
}
export function persistTopicReport(reportId:number, value:Omit<TopicReportRevision,'id'|'revision'>,revision:number,at:string): void {
 const inserted=handle().prepare(`INSERT INTO lesson_report_revisions(report_id,revision,source,snapshot_json,topics_json,created_at) VALUES(?,?,?,?,?,?)`).run(reportId,revision,value.source,value.snapshot?JSON.stringify(value.snapshot):null,JSON.stringify(value.topics),at);
 const booking=(handle().prepare('SELECT booking_id FROM lesson_reports WHERE id=?').get(reportId) as {booking_id:number}).booking_id;
 handle().prepare(`UPDATE homework SET withheld_report_revision=? WHERE booking_id=? AND (withheld_report_revision IS NOT NULL OR held_until>?)`).run(Number(inserted.lastInsertRowid),booking,at);
 handle().prepare(`UPDATE learning_assignments SET practice_state='withdrawn',held_until=NULL WHERE booking_id=? AND practice_state='held' AND held_until>?`).run(booking,at);
}
/** Only the latest report in this enrollment informs preparation; this is scope, not mastery. */
export function latestPreparationCoverage(enrollmentId:number):TopicReportRevision|null {
 const r=handle().prepare(`SELECT booking_id FROM lesson_reports WHERE enrollment_id=? ORDER BY updated_at DESC,id DESC LIMIT 1`).get(enrollmentId) as {booking_id:number}|undefined;
 return r?latestTopicReport(r.booking_id):null;
}


/** Read only an eligible source or a historical snapshot authorized by this booking. */
export function reportSourceMaterial(bookingId:number,materialId:number):ReturnType<typeof byVersion>{
 const snapshots=[...eligibleReportMaterials(bookingId),...topicReportHistory(bookingId).flatMap(r=>r.snapshot?[r.snapshot]:[])];
 const source=snapshots.find(m=>m.materialId===materialId);if(!source)return null;
 const row=byVersion(source.slug,'plan',source.version);
 return row && row.id===source.materialId && createHash('sha256').update(row.content).digest('hex')===source.hash ? row : null;
}
