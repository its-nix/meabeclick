import {handle} from '../db.ts';
import {latestPublished} from '../materials.ts';
import type {LessonPlan} from '../lesson/prep.ts';
export interface TeachingCoverage {lessonSlug:string;materialVersion:number;objectiveIds:string[]}
/** Only titles and immutable identities cross into the report form. */
export function teachingForBooking(bookingId:number){
 const rows=handle().prepare(`SELECT a.lesson_slug FROM learning_assignments a JOIN bookings_v2 b ON b.id=a.booking_id AND b.student_id=a.student_id WHERE b.id=? ORDER BY a.rowid DESC`).all(bookingId) as Array<{lesson_slug:string}>;
 for(const row of rows){
  const material=latestPublished(row.lesson_slug,'plan');if(!material)continue;
  let plan:LessonPlan;try{plan=JSON.parse(material.content);}catch{continue;}
  if(plan.teaching?.version!==2)continue;
  return {lessonSlug:row.lesson_slug,materialVersion:material.version,objectives:plan.teaching.objectives.map(({id,title})=>({id,title}))};
 }
 return null;
}
export class TeachingCoverageError extends Error {
 status:400|409;
 constructor(status:400|409,message:string){super(message);this.status=status;}
}
export function validateTeachingCoverage(bookingId:number,raw:unknown):TeachingCoverage|null{
 const target=teachingForBooking(bookingId);
 if(!target){if(raw!=null)throw new TeachingCoverageError(400,'יעדי השיעור אינם זמינים');return null;}
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new TeachingCoverageError(409,'יעדי השיעור עודכנו. רעננו את הדיווח לפני שליחה.');
 const c=raw as Record<string,unknown>;
 if(c.lessonSlug!==target.lessonSlug||c.materialVersion!==target.materialVersion)throw new TeachingCoverageError(409,'יעדי השיעור עודכנו. רעננו את הדיווח לפני שליחה.');
 if(!Array.isArray(c.objectiveIds)||c.objectiveIds.length>4||new Set(c.objectiveIds).size!==c.objectiveIds.length||c.objectiveIds.some(id=>typeof id!=='string'||!target.objectives.some(o=>o.id===id)))throw new TeachingCoverageError(400,'יש לבחור יעדים מתוך השיעור בלבד');
 return {lessonSlug:target.lessonSlug,materialVersion:target.materialVersion,objectiveIds:c.objectiveIds as string[]};
}
export function savedTeachingCoverage(bookingId:number):TeachingCoverage|null{
 const row=handle().prepare(`SELECT n.teaching_coverage FROM lesson_report_notes n JOIN lesson_reports r ON r.id=n.report_id WHERE r.booking_id=? ORDER BY n.id DESC LIMIT 1`).get(bookingId) as {teaching_coverage:string|null}|undefined;
 try{return row?.teaching_coverage?JSON.parse(row.teaching_coverage):null;}catch{return null;}
}
