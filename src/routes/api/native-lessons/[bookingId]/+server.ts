import {json} from '@sveltejs/kit';
import {apiAuthDenied} from '$server/auth.ts';
import {readJson} from '$server/http.ts';
import {getNativeLessonJob} from '$server/native-learning/jobs.ts';
import {bindNativePreparation} from '$server/native-learning/context.ts';
import {queueNativeLessonWork} from '$server/native-learning/worker.ts';
import type {RequestHandler} from './$types';
export const GET:RequestHandler=event=>{
 const denied=apiAuthDenied(event);if(denied)return denied;
 const id=Number(event.params.bookingId),job=Number.isSafeInteger(id)?getNativeLessonJob(id):null;
 return job?json({job},{headers:{'Cache-Control':'private, no-store'}}):json({error:'השיעור לא נמצא'},{status:404});
};
export const POST:RequestHandler=async event=>{
 const denied=apiAuthDenied(event);if(denied)return denied;
 const body=await readJson(event.request);if(body instanceof Response)return body;
 if(!body||typeof body!=='object'||Array.isArray(body))return json({error:'בקשה לא תקינה'},{status:400});
 const input=body as Record<string,unknown>,bookingId=Number(event.params.bookingId),studentId=input.studentId;
 if(!Number.isSafeInteger(bookingId)||typeof studentId!=='number'||!Number.isSafeInteger(studentId))return json({error:'בקשה לא תקינה'},{status:400});
 const preparation=input.preparation;
 if(!preparation||typeof preparation!=='object'||Array.isArray(preparation))return json({error:'בקשה לא תקינה'},{status:400});
 try{const job=bindNativePreparation({bookingId,studentId,request:(preparation as Record<string,unknown>).request,priorKnowledge:(preparation as Record<string,unknown>).priorKnowledge});queueNativeLessonWork();return json({job},{headers:{'Cache-Control':'private, no-store'}});}
 catch{return json({error:'מצב השיעור או פרטי ההזמנה אינם מאפשרים הכנה כעת.'},{status:409});}
};
