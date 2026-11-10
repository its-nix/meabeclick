import {mathText,mathFormula} from '../math.ts';
import {numericAnswer,type PresenterNotes} from '../model.ts';

export const VISUAL_RULE_VERSION='mea-visual-v1';
export const DECK_LAYOUTS=['cover','visual','split','compare','source','working','challenge','recap'] as const;
export interface NormalState {mean:number;sd:number;lowerZ:number|null;upperZ:number|null;pointZ:number|null;hideZ:number|null}
export interface NormalModel {mode:'population'|'curve'|'spread'|'bands'|'cumulative'|'axis'|'position';interactive:'none'|'spread'|'region'|'position';showProbability:boolean;states:NormalState[]}
export interface DeckBlock {type:'copy'|'equation'|'model'|'source'|'callout';text:string;model:NormalModel|null;sourceId:string|null;reveal:number}
export interface DeckTask {id:string;title:string;prompt:string;givens:string;objectiveId:string;support:'guided'|'independent';grading:'checked'|'tutor-review';model:NormalModel|null;check:{kind:'number'|'choice'|'region';answer:number|number[];options:string[]}|null;hints:string[];solution:string;success:string;retry:string}
export interface DeckSlide {id:string;title:string;kicker:string;prompt:string;objectiveId:string;layout:typeof DECK_LAYOUTS[number];blocks:DeckBlock[];taskId:string|null;presenterNotes:PresenterNotes}
export interface VisualLesson {version:1;ruleVersion:string;title:string;subtitle:string;durationMin:number;homeworkMinutes:number;objectives:{id:string;title:string}[];agenda:{title:string;minutes:number;slideId:string}[];slides:DeckSlide[];tasks:DeckTask[];homework:DeckTask[];games:{id:string;title:string;intro:string;kind:'region'|'axis';rounds:DeckTask[]}[];sourceSolutions:{questionId:string;part:string;slideId:string;answer:string}[]}
export interface DeckValidation {durationMin?:number;sourceAnswers?:Record<string,Record<string,string>>}
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown,max=600,empty=false)=>typeof v==='string'&&v.length<=max&&(empty||!!v.trim())&&!mathText(v).includes('data-math-error');
const id=(v:unknown)=>typeof v==='string'&&/^[a-z0-9-]{1,80}$/.test(v);
const finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=10000;
export function visualLessonProblems(raw:unknown,options:DeckValidation={}):string[]{
 const errors:string[]=[],need=(v:unknown,msg:string)=>{if(!v)errors.push(msg);};
 if(!object(raw))return ['חבילת המצגת אינה אובייקט'];const p=raw;
 need(p.version===1&&p.ruleVersion===VISUAL_RULE_VERSION,'גרסת מצגת לא נתמכת');
 need(text(p.title,140)&&text(p.subtitle,240),'כותרת מצגת לא תקינה');need([45,90,135].includes(p.durationMin)&&(!options.durationMin||p.durationMin===options.durationMin),'משך שיעור לא תקין');
 need(finite(p.homeworkMinutes)&&p.homeworkMinutes>=10&&p.homeworkMinutes<=15,'משך שיעורי הבית לא תקין');
 const list=(v:unknown,max:number,min=1):any[]=>{if(!Array.isArray(v)||v.length<min||v.length>max){errors.push('רשימת מצגת חסרה או ארוכה מדי');return [];}return v;};
 const objectives=list(p.objectives,4),slides=list(p.slides,p.durationMin===90?30:40,p.durationMin===90?20:8),tasks=list(p.tasks,12),homework=list(p.homework,6),games=list(p.games,2,2),agenda=list(p.agenda,12);
 const goals=new Set<string>(),slideIds=new Set<string>(),taskIds=new Set<string>(),sourceIds=new Set<string>();
 for(const o of objectives){need(object(o)&&id(o.id)&&text(o.title,180)&&!goals.has(o.id),'יעד לא תקין');if(object(o))goals.add(o.id);}
 const model=(m:unknown)=>{
  if(!object(m)){errors.push('מודל מתמטי לא תקין');return;}
  need(['population','curve','spread','bands','cumulative','axis','position'].includes(m.mode)&&['none','spread','region','position'].includes(m.interactive)&&typeof m.showProbability==='boolean','מצב המחשה לא נתמך');
  for(const s of list(m.states,5)){
   if(!object(s)){errors.push('מצב המחשה לא תקין');continue;}
   need(finite(s.mean)&&finite(s.sd)&&s.sd>=.1&&s.sd<=100,'פרמטרי התפלגות לא תקינים');
   for(const k of ['lowerZ','upperZ','pointZ','hideZ'])need(s[k]===null||finite(s[k])&&Math.abs(s[k])<=4,'מיקום על ההתפלגות לא תקין');
   need((s.lowerZ===null&&s.upperZ===null)||(finite(s.lowerZ)&&finite(s.upperZ)&&s.lowerZ<s.upperZ),'תחום צביעה לא תקין');
  }
 };
 for(const s of slides){
  if(!object(s)){errors.push('שקף לא תקין');continue;}
  need(id(s.id)&&!slideIds.has(s.id),'מזהי שקפים חייבים להיות ייחודיים');slideIds.add(s.id);
  need(text(s.title,130)&&text(s.kicker,90)&&text(s.prompt,300,true)&&goals.has(s.objectiveId)&&DECK_LAYOUTS.includes(s.layout),'טקסט או פריסה לא תקינים');
  for(const b of list(s.blocks,5)){
   if(!object(b)){errors.push('תוכן שקף לא תקין');continue;}
   need(['copy','equation','model','source','callout'].includes(b.type)&&text(b.text,600,true)&&Number.isInteger(b.reveal)&&b.reveal>=0&&b.reveal<=4,'בלוק מצגת לא תקין');
   if(b.type==='model')model(b.model);
   if(b.type==='equation'){try{mathFormula(b.text);}catch{errors.push('נוסחת שקף לא תקינה');}}
   if(b.type==='source'){need(id(b.sourceId)&&Object.hasOwn(options.sourceAnswers??{},b.sourceId),'מקור שקף לא מאומת');sourceIds.add(b.sourceId);}
  }
  const n=s.presenterNotes;need(object(n)&&['explanation','ask','expectedAnswer','ifStuck','misconception','transition'].every(k=>text(n[k],900))&&finite(n.minutes)&&n.minutes>0&&n.minutes<=20&&Array.isArray(n.sources)&&n.sources.every(id),'חסרות הערות מורה מלאות');
 }
 need(new Set(slides.filter(object).map(s=>s.layout)).size>=4,'המצגת דורשת פריסות מגוונות');
 let total=0;for(const a of agenda){need(object(a)&&text(a.title,140)&&Number.isInteger(a.minutes)&&a.minutes>0&&slideIds.has(a.slideId),'סדר שיעור לא תקין');if(object(a)&&finite(a.minutes))total+=a.minutes;}
 need(total===p.durationMin,'זמן סדר השיעור אינו שווה למשך השיעור');
 const checkTask=(t:unknown)=>{
  if(!object(t)){errors.push('משימה לא תקינה');return;}
  need(id(t.id)&&!taskIds.has(t.id),'מזהי משימות חייבים להיות ייחודיים');taskIds.add(t.id);
  need(text(t.title,140)&&text(t.prompt,900)&&text(t.givens,1000)&&goals.has(t.objectiveId)&&['guided','independent'].includes(t.support),'נתוני משימה חסרים');
  need(['checked','tutor-review'].includes(t.grading)&&text(t.solution,1800)&&text(t.success,350)&&text(t.retry,350),'משוב משימה לא תקין');
  need(Array.isArray(t.hints)&&t.hints.length>=1&&t.hints.length<=3&&t.hints.every((h:unknown)=>text(h,450)),'חסרים רמזים מדורגים');
  if(t.model!==null){model(t.model);need(t.model?.showProbability===false&&t.model?.interactive==='none','מודל שאלה אינו יכול לחשוף תשובה או לאפשר פתרון חופשי');}
  const c=t.check;
  if(t.grading==='tutor-review'){need(c===null,'נימוק פתוח נבדק בידי מורה');return;}
  if(!object(c)){errors.push('חסרה בדיקת משימה');return;}
  need(Array.isArray(c.options)&&c.options.every((v:unknown)=>text(v,220)),'אפשרויות משימה לא תקינות');
  if(c.kind==='number')need(finite(c.answer),'מפתח מספרי לא תקין');
  else if(c.kind==='choice')need(Number.isInteger(c.answer)&&c.options?.length>=2&&c.options.length<=4&&c.answer>=0&&c.answer<c.options.length,'מפתח בחירה לא תקין');
  else if(c.kind==='region')need(t.model&&Array.isArray(c.answer)&&c.answer.length===2&&c.answer.every((v:unknown)=>finite(v)&&Math.abs(Number(v))<=4)&&c.answer[0]<c.answer[1],'מפתח תחום לא תקין');
  else errors.push('סוג בדיקה לא נתמך');
 };
 for(const t of [...tasks,...homework])checkTask(t);
 const gameIds=new Set<string>();for(const g of games){if(!object(g)){errors.push('משחק לא תקין');continue;}need(id(g.id)&&!gameIds.has(g.id)&&text(g.title,120)&&text(g.intro,300)&&['region','axis'].includes(g.kind),'משחק לא תקין');gameIds.add(g.id);for(const t of list(g.rounds,8,3))checkTask(t);}
 for(const s of slides.filter(object))need(s.taskId===null||taskIds.has(s.taskId),'שקף מפנה למשימה חסרה');
 for(const goal of goals)need([...tasks,...homework].some(t=>object(t)&&t.objectiveId===goal&&t.support==='independent'),'יעד ללא בדיקה עצמאית חדשה');
 const solutions=list(p.sourceSolutions,20,0);
 for(const s of solutions)need(object(s)&&slideIds.has(s.slideId)&&typeof s.answer==='string'&&options.sourceAnswers?.[s.questionId]?.[s.part]===s.answer,'פתרון מקור לא מאומת');
 for(const [qid,parts] of Object.entries(options.sourceAnswers??{})){need(sourceIds.has(qid),'השאלה הרשמית חסרה');for(const part of Object.keys(parts))need(solutions.some(s=>object(s)&&s.questionId===qid&&s.part===part),'סעיף מקור ללא פתרון');}
 return [...new Set(errors)];
}

export function gradeDeckTask(task:DeckTask,input:unknown):boolean{
 const c=task.check;if(!c||task.grading!=='checked')return false;
 if(c.kind==='region')return Array.isArray(input)&&input.length===2&&Array.isArray(c.answer)&&c.answer.every((v,i)=>typeof input[i]==='number'&&Number.isFinite(input[i])&&Math.abs(input[i]-v)<1e-7);
 const n=numericAnswer(input);return n!==null&&typeof c.answer==='number'&&(c.kind==='choice'?Number.isInteger(n)&&n===c.answer:Math.abs(n-c.answer)<1e-7);
}

/** Public data is rebuilt, including nested models; arbitrary generated properties never cross this boundary. */
export function publicVisualLesson(p:VisualLesson){
 const model=(m:NormalModel|null)=>m?{mode:m.mode,interactive:m.interactive,showProbability:m.showProbability,states:m.states.map(s=>({mean:s.mean,sd:s.sd,lowerZ:s.lowerZ,upperZ:s.upperZ,pointZ:s.pointZ,hideZ:s.hideZ}))}:null;
 const task=(t:DeckTask)=>({id:t.id,title:t.title,prompt:t.prompt,givens:t.givens,objectiveId:t.objectiveId,support:t.support,grading:t.grading,model:model(t.model),check:t.check?{kind:t.check.kind,options:[...t.check.options]}:null});
 return {version:p.version,ruleVersion:p.ruleVersion,title:p.title,subtitle:p.subtitle,durationMin:p.durationMin,homeworkMinutes:p.homeworkMinutes,objectives:p.objectives.map(o=>({id:o.id,title:o.title})),agenda:p.agenda.map(a=>({title:a.title,minutes:a.minutes,slideId:a.slideId})),slides:p.slides.map(s=>({id:s.id,title:s.title,kicker:s.kicker,prompt:s.prompt,objectiveId:s.objectiveId,layout:s.layout,taskId:s.taskId,blocks:s.blocks.map(b=>({type:b.type,text:b.text,model:model(b.model),sourceId:b.sourceId,reveal:b.reveal}))})),tasks:p.tasks.map(task),homework:p.homework.map(task),games:p.games.map(g=>({id:g.id,title:g.title,intro:g.intro,kind:g.kind,rounds:g.rounds.map(task)}))};
}
