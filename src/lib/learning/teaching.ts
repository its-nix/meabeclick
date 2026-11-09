import type {LessonPlan} from '../server/lesson/prep.ts';
import {TEACHING_RULE_VERSION,type TeachingProfile} from './teaching-rules.ts';
export interface TeachingContext extends TeachingProfile {
 request:string; skill:string; curriculum:string; questionnaire:string; durationMin:45|90|135;
 history:Array<{kind:'taught'|'practice';topic:string;summary:string;independent:boolean;at:string}>;
 sourceQuestionIds?:string[]; requiredQuestionId?:string;
}
export type ActivityKind='scene'|'game'|'homework'|'discussion';
export interface TeachingPlan {
 version:2;ruleVersion:string;durationMin:number;homeworkMinutes:number;context?:TeachingContext;
 objectives:Array<{id:string;title:string;evidence:string}>;
 agenda:Array<{id:string;title:string;minutes:number;objectiveId:string;kind:ActivityKind;ref:string}>;
 practice:Array<{asset:'scene'|'game'|'homework';ref:string;objectiveId:string;problemId:string;misconception:string;support:'guided'|'independent';grading:'checked'|'tutor-review'}>;
 branches:Array<{id:string;title:string;replaces:string;refs:string[]}>;
 sources:Array<{questionId:string;kind:'official'|'adapted'}>;
}
const text=(v:unknown,max=400):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=max;
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-z0-9][a-z0-9_-]{0,79}$/.test(v);
export function teachingProblems(raw:unknown,plan:LessonPlan,context?:TeachingContext):string[]{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return ['חסר מתווה שיעור'];
 const t=raw as TeachingPlan,errors:string[]=[];
 const homework=Array.isArray(plan.homework)?plan.homework:[];const need=(yes:unknown,message:string)=>{if(!yes)errors.push(message);};
 need(t.version===2&&t.ruleVersion===TEACHING_RULE_VERSION,'גרסת מתווה לא נתמכת');
 need([45,90,135].includes(t.durationMin)&&Number.isFinite(t.homeworkMinutes)&&t.homeworkMinutes>=5&&t.homeworkMinutes<=30,'זמן שיעור או תרגול לא תקין');
 need(t.context&&typeof t.context==='object','חסר הקשר הוראה');
 if(context)need(JSON.stringify(t.context)===JSON.stringify(context),'הקשר ההוראה אינו תואם לבקשה');
 need(!t.context||t.durationMin===t.context.durationMin,'זמן המתווה אינו תואם להזמנה');
 if(!Array.isArray(t.objectives)||t.objectives.length<1||t.objectives.length>4)return [...errors,'נדרשים 1–4 יעדים'];
 const objectives=new Set<string>();for(const o of t.objectives){need(o&&id(o.id)&&!objectives.has(o.id)&&text(o.title,160)&&text(o.evidence,350),'יעד לא תקין');if(o)objectives.add(o.id);}
 const scenes=new Map(plan.learning?.scenes?.map(s=>[s.id,s])??[]);
 const exists=(kind:string,ref:string)=>kind==='scene'?scenes.has(ref):kind==='game'?!!plan.games?.[ref as keyof typeof plan.games]:kind==='homework'?/^homework-[1-9]\d*$/.test(ref)&&Number(ref.slice(9))<=homework.length:kind==='discussion'&&ref==='';
 const validateRef=(kind:string,ref:string)=>need(exists(kind,ref),'הפניה לפעילות חסרה');
 if(!Array.isArray(t.agenda)||t.agenda.length<1||t.agenda.length>30)return [...errors,'חסר מתווה פעילויות'];
 const agendaIds=new Set<string>();let minutes=0;
 for(const a of t.agenda){
  if(!a||typeof a!=='object'){errors.push('פעילות לא תקינה');continue;}
  need(id(a.id)&&!agendaIds.has(a.id)&&text(a.title,160)&&objectives.has(a.objectiveId),'פעילות או יעד לא תקינים');agendaIds.add(a.id);
  need(Number.isInteger(a.minutes)&&a.minutes>0&&a.minutes<=135,'זמן פעילות לא תקין');minutes+=a.minutes;
  validateRef(a.kind,a.ref);
 }
 need(minutes===t.durationMin,'זמן הפעילויות אינו שווה למשך ההזמנה');
 if(!Array.isArray(t.practice)||t.practice.length<2||t.practice.length>70)return [...errors,'חסרים קישורי תרגול'];
 const links=new Set<string>(),problems=new Set<string>();
 for(const p of t.practice){
  if(!p||typeof p!=='object'){errors.push('קישור תרגול לא תקין');continue;}
  validateRef(p.asset,p.ref);const key=p.asset+':'+p.ref;
  need(!links.has(key)&&objectives.has(p.objectiveId)&&id(p.problemId)&&!problems.has(p.problemId)&&text(p.misconception,350),'יעד או מזהה תרגול לא תקין');links.add(key);problems.add(p.problemId);
  need(['guided','independent'].includes(p.support)&&['checked','tutor-review'].includes(p.grading),'סוג תמיכה או בדיקה לא תקינים');
  if(p.grading==='checked'){
   if(p.asset==='scene')need(!!scenes.get(p.ref)?.check,'תרגול ללא בדיקה נתמכת');
   if(p.asset==='homework'){
    const c=homework[Number(p.ref.slice(9))-1]?.check;
    need(c&&['number','choice'].includes(c.kind)&&typeof c.answer==='number'&&Number.isFinite(c.answer)&&text(c.question)&&text(c.solution,1400),'משימת בית ללא בדיקה אמינה');
    if(c?.kind==='choice')need(Array.isArray(c.options)&&c.options.length>=2&&c.options.length<=4&&c.options.every(o=>text(o,200))&&new Set(c.options).size===c.options.length&&Number.isInteger(c.answer)&&Number(c.answer)>=0&&Number(c.answer)<c.options.length,'אפשרויות בדיקה לא תקינות');
   }
  }
 }
 for(const scene of scenes.values())if(scene.check)need(links.has('scene:'+scene.id),'תרגול במצגת ללא יעד');
 for(const key of Object.keys(plan.games??{}))if(plan.games[key as keyof typeof plan.games])need(links.has('game:'+key),'משחק ללא יעד');
 homework.forEach((_,i)=>need(links.has('homework:homework-'+(i+1)),'משימת בית ללא יעד'));
 for(const o of objectives)need(t.practice.some(p=>p?.objectiveId===o&&p.support==='independent'),'יעד ללא בדיקה עצמאית');
 for(const scene of scenes.values()){
  const n=scene.presenterNotes;need(n&&Number.isFinite(n.minutes)&&Number(n.minutes)>0&&text(n.misconception,500)&&text(n.transition,400)&&Array.isArray(n.sources)&&n.sources.every(id),'חסרות הערות מורה מורחבות');
  if(scene.check)need(text(scene.check.solution,1400),'חסר פתרון מודרך פרטי');
 }
 need(Array.isArray(t.branches)&&t.branches.length<=6,'הסתעפויות לא תקינות');
 for(const b of Array.isArray(t.branches)?t.branches:[]){if(!b||typeof b!=='object'){errors.push('הסתעפות לא תקינה');continue;}need(b&&id(b.id)&&text(b.title,160)&&agendaIds.has(b.replaces)&&Array.isArray(b.refs)&&b.refs.length>0,'הסתעפות לא תקינה');for(const ref of Array.isArray(b.refs)?b.refs:[]){if(typeof ref!=='string'){errors.push('הפניה לא תקינה');continue;}const [kind,key]=ref.split(':');validateRef(kind,key);}}
 need(Array.isArray(t.sources)&&t.sources.length<=4,'מקורות לא תקינים');
 for(const s of Array.isArray(t.sources)?t.sources:[])need(s&&id(s.questionId)&&['official','adapted'].includes(s.kind)&&t.context?.sourceQuestionIds?.includes(s.questionId),'מקור רשמי אינו מאומת בהקשר');
 if(t.context?.requiredQuestionId)need(t.sources?.some(s=>s.questionId===t.context!.requiredQuestionId),'השאלה המבוקשת לא נפתרה');
 return [...new Set(errors)];
}
/** Explicit allowlist: neither private context nor grading/solution data can be spread into public output. */
export function publicTeaching(t:TeachingPlan){return {durationMin:t.durationMin,objectives:t.objectives.map(({id,title})=>({id,title})),agenda:t.agenda.map(({id,title,minutes,kind,ref})=>({id,title,minutes,kind,ref}))};}
