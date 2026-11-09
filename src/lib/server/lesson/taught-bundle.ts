import {randomUUID}from'node:crypto';
import type{LessonPlan,HomeworkItem}from'./prep.ts';
import type{TaughtTask,generateTaughtHomework}from'./homework.ts';
import{handle,inTransaction}from'../db.ts';
import{latestPublished,recordGenerated}from'../materials.ts';
import{replaceHeld}from'../lessons.ts';
import{bookingForReport}from'../reports/store.ts';
import{enrollmentsForStudent}from'../entities.ts';
import{nodeInPlan,planForEnrollment}from'../plans/store.ts';
import{experienceProblems}from'../learning-render.ts';
import{homeworkExperience}from'../teaching-display.ts';
export interface TaughtHomeworkMaterial {kind:'taught-homework-v2';title:string;homework:HomeworkItem[];minutes:number;coveredObjectiveIds:string[];sourceQuestionIds:string[];independentRefs:string[]}
export function preparedHomework(plan:LessonPlan,coveredObjectiveIds:string[]):HomeworkItem[]{
 const allowed=new Set(coveredObjectiveIds);
 return plan.homework.filter((_,i)=>plan.teaching?.practice.some(p=>p.asset==='homework'&&p.ref===`homework-${i+1}`&&allowed.has(p.objectiveId)));
}
/** Handle only held v2 assignments. Old released work and v1 report behaviour are untouched. */
export async function afterV2Report(input:{bookingId:number;nodeIds:number[];note:string|null;coveredObjectiveIds?:string[];teachingTarget?:{slug:string;version:number}},generate:typeof generateTaughtHomework,clock:()=>string,notify?: (text:string)=>Promise<void>|void){
 const now=clock();
 const rows=handle().prepare("SELECT lesson_slug,student_id,node_id FROM learning_assignments WHERE booking_id=? AND practice_state='held' AND held_until>? ORDER BY rowid DESC").all(input.bookingId,now)as Array<{lesson_slug:string;student_id:number;node_id:number|null}>;
 const row=rows.find(r=>{if(input.teachingTarget&&r.lesson_slug!==input.teachingTarget.slug)return false;try{return JSON.parse(latestPublished(r.lesson_slug,'plan')?.content??'{}').teaching?.version===2;}catch{return false;}});
 if(!row)return input.teachingTarget?'none' as const:undefined;
 if(input.teachingTarget&&latestPublished(row.lesson_slug,'plan')?.version!==input.teachingTarget.version)return 'obsolete' as const;
 const original=JSON.parse(latestPublished(row.lesson_slug,'plan')!.content)as LessonPlan;
 const targetStamp=JSON.stringify({teaching:original.teaching,homework:original.homework});
 const reportRevision=()=>((handle().prepare('SELECT MAX(n.id) AS revision FROM lesson_report_notes n JOIN lesson_reports r ON r.id=n.report_id WHERE r.booking_id=?').get(input.bookingId)as {revision:number|null}).revision);
 const startedRevision=reportRevision();
 const matches=!input.nodeIds.length||row.node_id!==null&&input.nodeIds.includes(row.node_id);
 const preparedFallback=input.coveredObjectiveIds===undefined&&!input.nodeIds.length;
 let covered=input.coveredObjectiveIds??[],tasks:TaughtTask[]=[],reusedPrepared=false;
 const eligible=()=>preparedFallback?original.teaching!.objectives.map(o=>o.id):covered;
 if(matches&&(!input.note?.trim()||!input.nodeIds.length)){tasks=preparedHomework(original,eligible()).map(h=>({...h,nodeId:row.node_id??0,answer:h.answer??null}));reusedPrepared=true;}
 else{
  const booking=bookingForReport(input.bookingId),plan=booking?.enrollment_id?planForEnrollment(booking.enrollment_id):null;
  const enrollment=booking?enrollmentsForStudent(booking.student_id).find(e=>e.id===booking.enrollment_id):null;
  const skills=plan?[...new Set(input.nodeIds)].flatMap(id=>{const n=nodeInPlan(plan.id,id);return n?.kind==='skill'?[{key:n.key,title:n.title,nodeId:n.id}]:[];}):[];
  covered=matches?covered:skills.map(s=>`node-${s.nodeId}`);
  try{if(!enrollment||!skills.length)throw Error('No covered skill');tasks=await generate({subject:enrollment.subject,level:enrollment.level??'',skills,note:input.note,coveredObjectiveIds:covered,teachingContext:{...original.teaching!.context!,request:input.note??'',skill:skills.map(s=>s.title).join(', '),history:original.teaching!.context?.history??[]}});}
  catch{if(matches){tasks=preparedHomework(original,eligible()).map(h=>({...h,nodeId:row.node_id??0,answer:h.answer??null}));reusedPrepared=true;}await Promise.resolve(notify?.(matches?'לא ניתן להתאים תרגול נוסף להערה. נשמר התרגול המאומת על היעדים שסומנו.':'לא ניתן להכין תרגול על החומר שסומן. חומר שלא נלמד נשאר בהכנה ולא נשלח כשיעורי בית.')).catch(()=>{});}
 }
 const homework=tasks.map(t=>({task:t.task,why:t.why??'חזרה על מה שנלמד',answer:t.answer??'',check:t.check??null}));
 if(homework.length&&experienceProblems(homeworkExperience({title:original.title,homework}),{mode:'homework'}).length)throw Error('Invalid taught homework');
 return inTransaction(()=>{
  const completedAt=clock();
  const current=handle().prepare("SELECT 1 FROM learning_assignments WHERE lesson_slug=? AND practice_state='held' AND held_until>?").get(row.lesson_slug,completedAt);
  const latest=JSON.parse(latestPublished(row.lesson_slug,'plan')?.content??'{}')as LessonPlan;
  if(startedRevision!==reportRevision()||targetStamp!==JSON.stringify({teaching:latest.teaching,homework:latest.homework})||input.teachingTarget&&latestPublished(row.lesson_slug,'plan')?.version!==input.teachingTarget.version)return 'obsolete' as const;
  if(!current||!replaceHeld(input.bookingId,row.student_id,tasks.map(t=>({...t,nodeId:t.nodeId||null})),completedAt))return 'none' as const;
  let target:string|null=null;
  if(homework.length){
   target=`${row.lesson_slug}--practice-${randomUUID().slice(0,8)}`;
   const sources=reusedPrepared?original.teaching!.sources.filter(s=>s.asset==='homework'&&preparedHomework(original,eligible()).includes(original.homework[Number(s.ref.slice(9))-1])).map(s=>s.questionId):[];
   const independentRefs=reusedPrepared?preparedHomework(original,eligible()).flatMap((h,i)=>original.teaching!.practice.some(p=>p.asset==='homework'&&p.ref===`homework-${original.homework.indexOf(h)+1}`&&p.support==='independent')?[`homework-${i+1}`]:[]):homework.flatMap((h,i)=>h.check?[`homework-${i+1}`]:[]);
   const material:TaughtHomeworkMaterial={kind:'taught-homework-v2',title:original.title,minutes:original.teaching!.homeworkMinutes,homework,coveredObjectiveIds:covered,sourceQuestionIds:sources,independentRefs};
   recordGenerated(target,{plan:JSON.stringify(material)});
  }
  handle().prepare('UPDATE learning_assignments SET practice_state=?,practice_material_slug=?,held_until=NULL WHERE lesson_slug=?').run(target?'assigned':'withdrawn',target,row.lesson_slug);
  handle().prepare("UPDATE learning_assignments SET practice_state='withdrawn',practice_material_slug=NULL,held_until=NULL WHERE booking_id=? AND lesson_slug<>? AND practice_state='held' AND held_until>?").run(input.bookingId,row.lesson_slug,completedAt);
  return homework.length?'replaced' as const:'released-after-failure' as const;
 });
}
