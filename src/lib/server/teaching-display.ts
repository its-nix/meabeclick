import type {LessonPlan} from './lesson/prep.ts';
import {publicTeaching} from '../learning/teaching.ts';
import type {LearningExperience} from '../learning/model.ts';
import {sourceCaption} from './lesson/official-questions.ts';
import {escapeHtml as esc,mathText} from '../learning/math.ts';
export function teachingDisplay(plan:LessonPlan,slug:string,options:{gameUrls?:Record<string,string>;homeworkUrl?:string}={}){
 if(!plan.teaching)return undefined;
 const gameLinks:Record<string,string>={};for(const key of Object.keys(plan.games??{})){
  if(options.gameUrls?.[key])gameLinks[key]=options.gameUrls[key];
 }
 return {...publicTeaching(plan.teaching),independentSceneIds:plan.teaching.practice.filter(p=>p.asset==='scene'&&p.support==='independent').map(p=>p.ref),guidedSceneIds:plan.teaching.practice.filter(p=>p.asset==='scene'&&p.support==='guided').map(p=>p.ref),homeworkMinutes:plan.teaching.homeworkMinutes,gameTitles:Object.fromEntries(Object.entries(plan.games??{}).filter(([,g])=>g).map(([k,g])=>[k,String(g?.title??'משחק נוסף')])),gameLinks,homeworkUrl:options.homeworkUrl??(slug?`/app/learn/${encodeURIComponent(slug)}/homework`:''),sources:plan.teaching.sources.map(s=>sourceCaption(s.questionId)).filter(s=>s!==null)};
}
export type TeachingDisplay=NonNullable<ReturnType<typeof teachingDisplay>>;
export function homeworkSourceIds(plan:LessonPlan):string[]{
 const material=plan as unknown as {kind?:string;sourceQuestionIds?:unknown};
 if(material.kind==='taught-homework-v2')return Array.isArray(material.sourceQuestionIds)?material.sourceQuestionIds.filter((id):id is string=>typeof id==='string'&&!!sourceCaption(id)):[];
 return plan.teaching?.sources.filter(s=>s.asset==='homework').map(s=>s.questionId)??[];
}
export function homeworkIndependentIds(plan:LessonPlan):string[]{
 const material=plan as unknown as {kind?:string;independentRefs?:string[]};
 if(material.kind==='taught-homework-v2')return material.independentRefs??plan.homework.flatMap((h,i)=>h.check?[`homework-${i+1}`]:[]);
 return plan.teaching?.practice.filter(p=>p.asset==='homework'&&p.support==='independent').map(p=>p.ref)??[];
}
export function renderSourceCredits(ids:string[]):string{
 const sources=ids.map(sourceCaption).filter(s=>s!==null);
 return `<div class="source-captions">${sources.length?sources.map(s=>`<p><a href="${esc(s.url)}#page=${s.page}" target="_blank" rel="noopener">${esc(s.label)} ↗</a></p>`).join(''):'<small>התרגול נכתב לשיעור הזה · אינו שאלה רשמית מבחינה</small>'}</div>`;
}
export function renderTeachingAgenda(t:TeachingDisplay|undefined):string{
 if(!t)return '';
 const agenda=t.agenda.map(a=>{const url=a.kind==='scene'?`#scene=${encodeURIComponent(a.ref)}`:a.kind==='game'?t.gameLinks[a.ref]:a.kind==='homework'&&t.homeworkUrl?`${t.homeworkUrl}#scene=${encodeURIComponent(a.ref)}`:undefined;return `<li><span>${a.minutes} דקות</span>${url?`<a href="${esc(url)}">${esc(a.title)}</a>`:esc(a.title)}</li>`;}).join('');
 return `<details class="teaching-agenda" data-agenda><summary>מה נעשה היום? · ${t.durationMin} דקות</summary><p>${t.objectives.map(o=>esc(o.title)).join(' · ')}</p><ol>${agenda}</ol><nav class="bundle-links" aria-label="פעילויות השיעור">${Object.entries(t.gameLinks).map(([key,url])=>`<a href="${esc(url)}">${esc(t.gameTitles[key]??'משחק נוסף')} ↗</a>`).join('')}${t.homeworkUrl?`<a href="${esc(t.homeworkUrl)}">תרגול בבית · כ־${t.homeworkMinutes} דקות ↗</a>`:''}</nav><div class="source-captions">${t.sources.length?t.sources.map(s=>`<p><a href="${esc(s.url)}#page=${s.page}" target="_blank" rel="noopener">${esc(s.label)} ↗</a></p>`).join(''):'<small>התרגול נכתב לשיעור הזה · אינו שאלה רשמית מבחינה</small>'}</div></details>`;
}
/** Homework is rendered by the same trusted scene engine and server grader. */
export function homeworkExperience(plan:Pick<LessonPlan,'title'|'homework'>&{minutes?:number;teaching?:Pick<NonNullable<LessonPlan['teaching']>,'homeworkMinutes'>}):LearningExperience{
 return {version:1,title:`תרגול בבית · ${plan.title}`,subtitle:'מנסים, מקבלים רמז, ומסבירים את הדרך',objective:'מיישמים את הרעיונות בתרגול חדש',minutes:plan.teaching?.homeworkMinutes??plan.minutes??12,scenes:plan.homework.map((h,i)=>({
  id:`homework-${i+1}`,phase:'practice',title:`משימה ${i+1}`,prompt:h.check?'נסו בעצמכם. אפשר לבקש רמז כשצריך.':'כתבו את הדרך שלכם; המורה תעבור על הנימוק.',takeaway:h.why,
  visual:'steps',xDomain:[-5,5],yDomain:[-5,5],frames:[{values:[],tex:'\\square',caption:h.task}],check:h.check??null,tutorReview:!h.check
 }))};
}
export function renderHomeworkAnswers(plan:LessonPlan){return plan.homework.map((h,i)=>`<section><h2>משימה ${i+1}</h2><p>${mathText(h.task)}</p><p>${mathText(h.check?.solution??h.answer??'')}</p></section>`).join('');}
