import type{LessonPlan}from'./lesson/prep.ts';
import{TEMPLATE_FILES}from'./lesson/prep.ts';
import{teachingDisplay}from'./teaching-display.ts';
import{lessonGamesForLesson}from'./lesson-games.ts';
import{gameUrl}from'./urls.ts';
export function assignedTeachingDisplay(plan:LessonPlan,slug:string,materialSlug:string,options:{student?:string;preview?:boolean}={}){
 const gameUrls:Record<string,string>={};
 for(const game of lessonGamesForLesson(materialSlug)){
  const key=Object.keys(TEMPLATE_FILES).find(k=>TEMPLATE_FILES[k]===game.template);if(!key||game.status==='archived')continue;
  if(options.preview)gameUrls[key]=`/app/play/${game.template}?preview=${encodeURIComponent(game.id)}`;
  else if(options.student&&game.status==='published'&&game.publishedDataId)gameUrls[key]=gameUrl({template:game.template,dataId:game.publishedDataId,student:options.student});
 }
 return teachingDisplay(plan,slug,{gameUrls});
}
