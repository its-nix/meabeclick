/** Exact historical source preview. Tutor-only, independently authorized to this booking. */
import { error } from '@sveltejs/kit';
import { requireAuth } from '$server/auth.ts';
import { reportSourceMaterial } from '$server/reports/topics.ts';
import { documentHeaders } from '$server/document-policy.ts';
import { renderSlides, type LessonPlan } from '$server/lesson/prep.ts';
import { renderLearningDocument } from '$server/learning-render.ts';
import type { RequestHandler } from './$types';

export const GET:RequestHandler=(event)=>{
 requireAuth(event);
 const bookingId=Number(event.params.booking),materialId=Number(event.url.searchParams.get('materialId'));
 if(!Number.isSafeInteger(bookingId)||!Number.isSafeInteger(materialId))error(404,'לא נמצא');
 const row=reportSourceMaterial(bookingId,materialId);if(!row)error(404,'לא נמצא');
 let plan:LessonPlan;try{plan=JSON.parse(row.content);}catch{error(404,'לא נמצא');}
 const body=plan.learning ? renderLearningDocument(plan.learning,{slug:row.lesson_slug,preview:true,storageScope:`report-source:${row.id}`,backUrl:`/app/report/${bookingId}`}) : renderSlides(plan,{subject:'',level:''});
 return new Response(body,{headers:{...documentHeaders(),'Cache-Control':'no-store'}});
};
