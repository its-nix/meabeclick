import type{LessonPlan}from'./lesson/prep.ts';
import{TEMPLATE_FILES}from'./lesson/prep.ts';
import{teachingDisplay}from'./teaching-display.ts';
import{lessonGamesForLesson}from'./lesson-games.ts';
import{gameUrl}from'./urls.ts';
import{readLessonsForSlugs}from'./db.ts';
/** Immutable identities written by automatic publication, scoped by lesson slug. */
type GeneratedGame={dataId:string;template:string;title:string};
export function generatedGamesForLesson(slug:string):GeneratedGame[]{
 return (readLessonsForSlugs([slug])[0]?.games??[]).filter((raw):raw is GeneratedGame=>{
  if(!raw||typeof raw!=='object')return false;const g=raw as Record<string,unknown>;
  return typeof g.dataId==='string'&&typeof g.template==='string'&&Object.values(TEMPLATE_FILES).includes(g.template)&&typeof g.title==='string';
 });
}
export function assignedTeachingDisplay(plan:LessonPlan,slug:string,materialSlug:string,options:{student?:string;preview?:boolean}={}){
 const gameUrls:Record<string,string>={},titles:Record<string,string>={};
 for(const game of generatedGamesForLesson(materialSlug)){
  const key=Object.keys(TEMPLATE_FILES).find(k=>TEMPLATE_FILES[k]===game.template)!;
  if(options.preview)gameUrls[key]=`/app/play/${game.template}?lesson=${encodeURIComponent(materialSlug)}`;
  else if(options.student)gameUrls[key]=gameUrl({template:game.template,dataId:game.dataId,student:options.student});
  titles[key]=String(game.title??'משחק');
 }
 const managed=lessonGamesForLesson(materialSlug);
 for(const [key,template]of Object.entries(TEMPLATE_FILES)){
  const matching=managed.filter(g=>g.template===template);
  const selected=options.preview?matching.findLast(g=>g.status!=='archived'):options.student?matching.findLast(g=>g.status==='published'&&!!g.publishedDataId):undefined;
  if(selected){gameUrls[key]=options.preview?`/app/play/${template}?preview=${encodeURIComponent(selected.id)}`:gameUrl({template,dataId:selected.publishedDataId!,student:options.student!});titles[key]=selected.title;}
  else if(matching.length&&matching.every(g=>g.status==='archived'))delete gameUrls[key];
 }
 const display=teachingDisplay(plan,slug,{gameUrls});if(display)Object.assign(display.gameTitles,titles);return display;
}
