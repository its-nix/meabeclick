import {error,redirect}from'@sveltejs/kit';
import {learningAccess,assignedExperience,homeworkReleased}from'$server/learning-store.ts';
import {renderLearningDocument}from'$server/learning-render.ts';
import{homeworkSourceIds}from'$server/teaching-display.ts';
import {documentHeaders}from'$server/document-policy.ts';
import type{RequestHandler}from'./$types';
export const GET:RequestHandler=({params,locals,url})=>{
 if(!locals.family&&!locals.authenticated)redirect(303,'/portal');
 const access=learningAccess(params.slug,locals);
 if(!locals.authenticated&&(!access||!homeworkReleased(params.slug)))error(404,'התרגול עדיין לא זמין');
 const lesson=assignedExperience(params.slug,'homework');if(!lesson)error(404,'התרגול לא נמצא');
 const solutions=url.searchParams.get('solutions')==='1';if(solutions&&!locals.authenticated)error(403,'התשובון מיועד למורה');
 return new Response(renderLearningDocument(lesson.experience,{slug:params.slug,variant:'homework',sourceIds:homeworkSourceIds(lesson.plan),solutions,preview:locals.authenticated,storageScope:locals.authenticated?`teacher:${params.slug}`:access?.code,backUrl:`/app/learn/${encodeURIComponent(params.slug)}`}),{headers:{...documentHeaders(),'Cache-Control':'private, no-store'}});
};
