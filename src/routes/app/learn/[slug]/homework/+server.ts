import {error,redirect}from'@sveltejs/kit';
import {learningAccess,assignedExperience,homeworkReleased}from'$server/learning-store.ts';
import {renderLearningDocument}from'$server/learning-render.ts';
import {documentHeaders}from'$server/document-policy.ts';
import type{RequestHandler}from'./$types';
export const GET:RequestHandler=({params,locals})=>{
 if(!locals.family&&!locals.authenticated)redirect(303,'/portal');
 const access=learningAccess(params.slug,locals);
 if(!locals.authenticated&&(!access||!homeworkReleased(params.slug)))error(404,'התרגול עדיין לא זמין');
 const lesson=assignedExperience(params.slug,'homework');if(!lesson)error(404,'התרגול לא נמצא');
 return new Response(renderLearningDocument(lesson.experience,{slug:params.slug,variant:'homework',preview:locals.authenticated,storageScope:locals.authenticated?`teacher:${params.slug}`:access?.code,backUrl:`/app/learn/${encodeURIComponent(params.slug)}`}),{headers:{...documentHeaders(),'Cache-Control':'private, no-store'}});
};
