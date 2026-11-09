import {error,redirect} from '@sveltejs/kit';
import {learningAccess,learningMaterialSlug} from '$server/learning-store.ts';
import {latestPublished} from '$server/materials.ts';
import {sourceCaption,officialQuestion} from '$server/lesson/official-questions.ts';
import type {RequestHandler} from './$types';
/** Excerpt-only endpoint: no unlicensed full PDFs and no private solution/verification fields. */
export const GET:RequestHandler=({params,locals})=>{
 if(!locals.family&&!locals.authenticated)redirect(303,'/portal');
 if(!locals.authenticated&&!learningAccess(params.slug,locals))error(404,'המקור לא נמצא');
 const row=latestPublished(learningMaterialSlug(params.slug),'plan');
 let references:string[]=[];try{references=JSON.parse(row?.content??'{}').teaching.sources.map((s:{questionId:string})=>s.questionId);}catch{}
 const q=officialQuestion(params.questionId),caption=sourceCaption(params.questionId);
 if(!q||!caption||!references.includes(q.id))error(404,'המקור לא נמצא');
 return Response.json({...caption,transcript:q.use==='excerpt'?q.transcript:undefined,accessibleText:q.accessibleText},{headers:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow'}});
};
