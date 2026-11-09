import {getStudentByCode,enrollmentsForStudent} from '../entities.ts';
import {handle} from '../db.ts';
import {templateById} from '../plans/templates.ts';
import {teachingProblems,type TeachingContext} from '../../learning/teaching.ts';
import type {Booking} from './queue.ts';
import type {TargetSkill} from './targeting.ts';
import type {LessonPlan,LessonRequest} from './prep.ts';
import{suppliedQuestionId,suppliedSourceIntent}from'./official-questions.ts';
const clipped=(s:unknown,max=500)=>typeof s==='string'?s.trim().slice(0,max):'';
export function teachingContextFor(booking:Booking,studentCode:string|null,target:Pick<TargetSkill,'templateId'|'title'|'key'>|null):TeachingContext{
 const student=studentCode?getStudentByCode(studentCode):null;
 const enrollment=student?enrollmentsForStudent(student.id).find(e=>e.subject===booking.subject):null;
 const template=target?templateById(target.templateId):null;
 const level=clipped(booking.level||enrollment?.level,160);
 const grade=level.match(/כיתה\s+[א-ת׳״"']+/u)?.[0]??((!/יח/.test(level)?level:'')||(template?.grades?.length===1?template.grades[0]:''));
 const track=level.match(/[345]\s*יח(?:ידות|["״']?ל)?/u)?.[0]??template?.track??'';
 const context:TeachingContext={grade,track,notation:'standard',request:clipped(booking.request,1500),skill:clipped(target?.title,160),curriculum:template?`${template.id}@${template.version}`:'',questionnaire:template?.questionnaires?.join(',')??'',durationMin:booking.durationMin===90||booking.durationMin===135?booking.durationMin:45,history:[]};
 context.purpose='booking';if(target)context.skillKey=target.key;if(template?.grades?.length)context.applicableGrades=template.grades;
 const intent=suppliedSourceIntent(context.request);if(intent)context.sourceIntent=intent;
 const supplied=suppliedQuestionId(context.request,intent);if(supplied)context.requiredQuestionId=supplied;
 if(/^3(?:\D|$)/.test(track)&&/נורמל/.test(context.skill+' '+context.request))context.notation='school-normal-s';
 if(!student)return context;
 context.preferences={goals:clipped(student.goals),style:clipped(student.style),notes:clipped(student.notes)};
 const rows=handle().prepare(`SELECT pn.title AS topic,pe.status,pe.note,pe.at FROM plan_events pe JOIN plans p ON p.id=pe.plan_id JOIN enrollments e ON e.id=p.enrollment_id JOIN plan_nodes pn ON pn.id=pe.node_id WHERE e.student_id=? AND e.subject=? AND pe.type='status' AND pn.visibility!='hidden' ORDER BY pe.at DESC,pe.id DESC LIMIT 6`).all(student.id,booking.subject) as Array<{topic:string;status:string;note:string|null;at:string}>;
 context.history=rows.map(r=>({kind:'taught',topic:clipped(r.topic,160),summary:clipped(`${r.status}${r.note?' — '+r.note:''}`),independent:r.status==='independent',at:r.at}));
 const practice=handle().prepare(`SELECT l.title,lp.attempts,lp.hints,lp.solved,lp.updated_at FROM learning_progress lp JOIN lessons l ON l.slug=lp.lesson_slug WHERE lp.student_id=? AND l.subject=? ORDER BY lp.updated_at DESC LIMIT 4`).all(student.id,booking.subject) as Array<{title:string;attempts:number;hints:number;solved:number;updated_at:string}>;
 context.history.push(...practice.map(r=>({kind:'practice' as const,topic:clipped(r.title,160)||'תרגול קודם',summary:`${r.attempts} ניסיונות, ${r.hints} רמזים, ${r.solved?'נפתר':'טרם נפתר'}`,independent:false,at:r.updated_at})));
 const materials=handle().prepare(`SELECT m.content FROM learning_assignments a JOIN lessons l ON l.slug=a.lesson_slug JOIN lesson_materials m ON m.lesson_slug IN(a.lesson_slug,a.practice_material_slug) WHERE a.student_id=? AND l.subject=? AND m.kind='plan' AND m.published_at IS NOT NULL AND m.version=(SELECT MAX(v.version) FROM lesson_materials v WHERE v.lesson_slug=m.lesson_slug AND v.kind='plan' AND v.published_at IS NOT NULL) ORDER BY m.created_at DESC LIMIT 8`).all(student.id,booking.subject)as Array<{content:string}>;
 const used=new Set<string>();for(const m of materials)try{const p=JSON.parse(m.content);for(const id of p.kind==='taught-homework-v2'?p.sourceQuestionIds??[]:p.teaching?.sources?.map((s:{questionId:string})=>s.questionId)??[])if(typeof id==='string')used.add(id);}catch{}
 if(used.size)context.usedQuestionIds=[...used].slice(0,12);
 return context;
}
export function canReuseTeachingPlan(plan:LessonPlan,request:LessonRequest):boolean{
 const actual=plan.teaching?.context,expected=request.teachingContext;
 if(!plan.teaching||!actual||!expected||actual.purpose==='review'||teachingProblems(plan.teaching,plan).length)return false;
 if(plan.teaching.sources.some(s=>expected.usedQuestionIds?.includes(s.questionId)&&s.questionId!==expected.requiredQuestionId))return false;
 const gradeFits=actual.grade===expected.grade||actual.purpose==='library'&&!actual.grade&&actual.applicableGrades?.includes(expected.grade??'');
 const requestFits=actual.request===expected.request||actual.purpose==='library'&&!expected.request.trim()&&!!actual.skillKey&&actual.skillKey===expected.skillKey;
 const keys=['track','notation','skill','skillKey','curriculum','questionnaire','durationMin','requiredQuestionId','sourceIntent'] as const;
 const preferences=(p:TeachingContext['preferences'])=>JSON.stringify(Object.entries(p??{}).filter(([,v])=>v.trim()).sort(([a],[b])=>a.localeCompare(b)));
 return !!gradeFits&&requestFits&&keys.every(k=>(actual[k]??'')===(expected[k]??''))&&preferences(actual.preferences)===preferences(expected.preferences)&&JSON.stringify(actual.history)===JSON.stringify(expected.history)&&JSON.stringify(actual.sourceQuestionIds??[])===JSON.stringify(expected.sourceQuestionIds??[]);
}
