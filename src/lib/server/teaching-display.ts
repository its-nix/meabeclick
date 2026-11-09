import type {LessonPlan} from './lesson/prep.ts';
import {TEMPLATE_FILES} from './lesson/prep.ts';
import {publicTeaching} from '../learning/teaching.ts';
import type {LearningExperience} from '../learning/model.ts';
import {sourceCaption} from './lesson/official-questions.ts';
import {escapeHtml as esc,mathText} from '../learning/math.ts';
import {gameUrl} from './urls.ts';
import {lessonGamesForLesson} from './lesson-games.ts';
export function teachingDisplay(plan:LessonPlan,slug:string,options:{student?:string;gameUrls?:Record<string,string>;homeworkUrl?:string}={}){
 if(!plan.teaching)return undefined;
 const gameLinks:Record<string,string>={};for(const key of Object.keys(plan.games??{})){
  if(options.gameUrls?.[key])gameLinks[key]=options.gameUrls[key];
  else if(options.student&&TEMPLATE_FILES[key])gameLinks[key]=gameUrl({template:TEMPLATE_FILES[key],dataId:`${slug}-${TEMPLATE_FILES[key]}`,student:options.student});
 }
 return {...publicTeaching(plan.teaching),gameLinks,homeworkUrl:options.homeworkUrl??(slug?`/app/learn/${encodeURIComponent(slug)}/homework`:''),sources:plan.teaching.sources.map(s=>sourceCaption(s.questionId)).filter(s=>s!==null)};
}
export type TeachingDisplay=NonNullable<ReturnType<typeof teachingDisplay>>;
export function assignedTeachingDisplay(plan:LessonPlan,slug:string,materialSlug:string,options:{student?:string;preview?:boolean}={}){
 const gameUrls:Record<string,string>={};
 for(const game of lessonGamesForLesson(materialSlug)){
  const key=Object.keys(TEMPLATE_FILES).find(k=>TEMPLATE_FILES[k]===game.template);if(!key||game.status==='archived')continue;
  if(options.preview)gameUrls[key]=`/app/play/${game.template}?preview=${encodeURIComponent(game.id)}`;
  else if(options.student&&game.status==='published'&&game.publishedDataId)gameUrls[key]=gameUrl({template:game.template,dataId:game.publishedDataId,student:options.student});
 }
 return teachingDisplay(plan,slug,{gameUrls});
}
export function renderTeachingAgenda(t:TeachingDisplay|undefined):string{
 if(!t)return '';
 const agenda=t.agenda.map(a=>{const url=a.kind==='scene'?`#scene=${encodeURIComponent(a.ref)}`:a.kind==='game'?t.gameLinks[a.ref]:a.kind==='homework'&&t.homeworkUrl?`${t.homeworkUrl}#scene=${encodeURIComponent(a.ref)}`:undefined;return `<li><span>${a.minutes} דקות</span>${url?`<a href="${esc(url)}">${esc(a.title)}</a>`:esc(a.title)}</li>`;}).join('');
 return `<details class="teaching-agenda" data-agenda><summary>מה נעשה היום? · ${t.durationMin} דקות</summary><p>${t.objectives.map(o=>esc(o.title)).join(' · ')}</p><ol>${agenda}</ol><div class="source-captions">${t.sources.length?t.sources.map(s=>`<p><a href="${esc(s.url)}#page=${s.page}" target="_blank" rel="noopener">${esc(s.label)} ↗</a></p>`).join(''):'<small>התרגול נכתב לשיעור הזה · אינו שאלה רשמית מבחינה</small>'}</div></details>`;
}
/** Homework is rendered by the same trusted scene engine and server grader. */
export function homeworkExperience(plan:LessonPlan):LearningExperience{
 return {version:1,title:`תרגול בבית · ${plan.title}`,subtitle:'מנסים, מקבלים רמז, ומסבירים את הדרך',objective:'חוזרים על מה שתרגלנו בשיעור',minutes:plan.teaching?.homeworkMinutes??12,scenes:plan.homework.map((h,i)=>({
  id:`homework-${i+1}`,phase:'practice',title:`משימה ${i+1}`,prompt:h.check?'נסו בעצמכם. אפשר לבקש רמז כשצריך.':'כתבו את הדרך שלכם; המורה תעבור על הנימוק.',takeaway:h.why,
  visual:'steps',xDomain:[-5,5],yDomain:[-5,5],frames:[{values:[],tex:'\\square',caption:h.task}],check:h.check??null,tutorReview:!h.check
 }))};
}
export function renderHomeworkAnswers(plan:LessonPlan){return plan.homework.map((h,i)=>`<section><h2>משימה ${i+1}</h2><p>${mathText(h.task)}</p><p>${mathText(h.check?.solution??h.answer??'')}</p></section>`).join('');}
