import {getStudentByCode,enrollmentsForStudent} from '../entities.ts';
import {handle} from '../db.ts';
import {templateById} from '../plans/templates.ts';
import {teachingProblems,type TeachingContext} from '../../learning/teaching.ts';
import type {Booking} from './queue.ts';
import type {TargetSkill} from './targeting.ts';
import type {LessonPlan,LessonRequest} from './prep.ts';
const clipped=(s:unknown,max=500)=>typeof s==='string'?s.trim().slice(0,max):'';
export function teachingContextFor(booking:Booking,studentCode:string|null,target:Pick<TargetSkill,'templateId'|'title'|'key'>|null):TeachingContext{
 const student=studentCode?getStudentByCode(studentCode):null;
 const enrollment=student?enrollmentsForStudent(student.id).find(e=>e.subject===booking.subject):null;
 const template=target?templateById(target.templateId):null;
 const level=clipped(booking.level||enrollment?.level,160);
 const grade=level.match(/כיתה\s+[א-ת׳״"']+/u)?.[0]??(!/יח/.test(level)?level:'');
 const track=level.match(/[345]\s*יח(?:ידות|["״']?ל)?/u)?.[0]??template?.track??'';
 const context:TeachingContext={grade,track,notation:'standard',request:clipped(booking.request,1500),skill:clipped(target?.title,160),curriculum:template?`${template.id}@${template.version}`:'',questionnaire:template?.questionnaires?.join(',')??'',durationMin:booking.durationMin===90||booking.durationMin===135?booking.durationMin:45,history:[]};
 if(!student)return context;
 context.preferences={goals:clipped(student.goals),style:clipped(student.style),notes:clipped(student.notes)};
 const rows=handle().prepare(`SELECT pn.title AS topic,pe.status,pe.note,pe.at FROM plan_events pe JOIN plans p ON p.id=pe.plan_id JOIN enrollments e ON e.id=p.enrollment_id JOIN plan_nodes pn ON pn.id=pe.node_id WHERE e.student_id=? AND e.subject=? AND pe.type='status' AND pn.visibility!='hidden' ORDER BY pe.at DESC,pe.id DESC LIMIT 6`).all(student.id,booking.subject) as Array<{topic:string;status:string;note:string|null;at:string}>;
 context.history=rows.map(r=>({kind:'taught',topic:clipped(r.topic,160),summary:clipped(`${r.status}${r.note?' — '+r.note:''}`),independent:r.status==='independent',at:r.at}));
 const practice=handle().prepare(`SELECT l.title,lp.attempts,lp.hints,lp.solved,lp.updated_at FROM learning_progress lp JOIN lessons l ON l.slug=lp.lesson_slug WHERE lp.student_id=? AND l.subject=? ORDER BY lp.updated_at DESC LIMIT 4`).all(student.id,booking.subject) as Array<{title:string;attempts:number;hints:number;solved:number;updated_at:string}>;
 context.history.push(...practice.map(r=>({kind:'practice' as const,topic:clipped(r.title,160)||'תרגול קודם',summary:`${r.attempts} ניסיונות, ${r.hints} רמזים, ${r.solved?'נפתר':'טרם נפתר'}`,independent:false,at:r.updated_at})));
 return context;
}
export function canReuseTeachingPlan(plan:LessonPlan,request:LessonRequest):boolean{
 const actual=plan.teaching?.context,expected=request.teachingContext;
 if(!plan.teaching||!actual||!expected||teachingProblems(plan.teaching,plan).length)return false;
 const keys=['grade','track','notation','request','skill','curriculum','questionnaire','durationMin','requiredQuestionId'] as const;
 return keys.every(k=>(actual[k]??'')===(expected[k]??''))&&JSON.stringify(actual.preferences??{})===JSON.stringify(expected.preferences??{})&&JSON.stringify(actual.history)===JSON.stringify(expected.history)&&JSON.stringify(actual.sourceQuestionIds??[])===JSON.stringify(expected.sourceQuestionIds??[]);
}
