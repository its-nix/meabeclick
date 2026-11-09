import { error, json } from '@sveltejs/kit';
import { requireAuth } from '$server/auth.ts';
import { addMaterial } from '$server/materials.ts';
import { inTransaction } from '$server/db.ts';
import { editBase, publishPlan } from '$server/lesson/editing.ts';
import { experienceProblems, renderLearningDocument } from '$server/learning-render.ts';
import { documentHeaders } from '$server/document-policy.ts';
import type { LearningExperience } from '$lib/learning/model.ts';
import {teachingDisplay,homeworkIndependentIds} from '$server/teaching-display.ts';
import {teachingProblems} from '$lib/learning/teaching.ts';
import { learningMaterialSlug,presentationMaterialSlug } from '$server/learning-store.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async event => {
  requireAuth(event);
  const form = await event.request.formData();
  let experience: LearningExperience;
  try { experience = JSON.parse(String(form.get('learning'))); } catch { error(400, 'תוכן לא תקין'); }
  const variant=form.get('variant')==='homework'?'homework':undefined;
  const problems = experienceProblems(experience,{mode:variant});
  if (problems.length) return new Response(problems.join('\n'), { status:400 });
  const target=event.url.searchParams.get('view')==='homework'?learningMaterialSlug(event.params.slug):presentationMaterialSlug(event.params.slug);
  const base=editBase(target)?.plan;
  return new Response(renderLearningDocument(experience, { preview:true,variant,teaching:base?.teaching?teachingDisplay({...base,learning:experience},event.params.slug):undefined,independentSceneIds:variant&&base?homeworkIndependentIds(base):undefined }), {headers:{...documentHeaders(),'Cache-Control':'no-store'}});
};

export const PUT: RequestHandler = async event => {
  requireAuth(event);
  let body: Record<string, unknown>;
  try { body = await event.request.json(); } catch { return json({error:'תוכן לא תקין'},{status:400}); }
  if (!body || !['draft','publish'].includes(String(body.action))) return json({error:'פעולה לא תקינה'},{status:400});
  return inTransaction(() => {
    const target=event.url.searchParams.get('view')==='homework'?learningMaterialSlug(event.params.slug):presentationMaterialSlug(event.params.slug);
    if (body.expectedTarget !== target) return json({error:'התרגול לשיעור עודכן. רעננו לפני שמירה.'},{status:409});
    const base=editBase(target);
    if (!base) return json({error:'השיעור לא נמצא'},{status:404});
    if (body.expectedVersion !== base.version) return json({error:'השיעור עודכן בחלון אחר. רעננו לפני שמירה.'},{status:409});
    const variant=(base.plan as unknown as {kind?:string}).kind==='taught-homework-v2'?'homework':undefined;
    const problems=experienceProblems(body.learning,{mode:variant});if(problems.length)return json({error:problems.join(' · ')},{status:400});
    if(variant){
      const learning=body.learning as LearningExperience;
      if(learning.scenes.length!==base.plan.homework.length||learning.scenes.some((s,i)=>s.id!==`homework-${i+1}`))return json({error:'יש לשמור את מזהי משימות הבית ואת מספרן'},{status:400});
      const plan={...base.plan,title:learning.title.replace(/^תרגול בבית · /,''),minutes:learning.minutes,homework:learning.scenes.map((s,i)=>({...base.plan.homework[i],task:s.check?.question??s.frames[0].caption,why:s.takeaway,check:s.check??null,answer:s.check?.solution??base.plan.homework[i].answer}))};
      const saved=addMaterial({slug:target,kind:'plan',content:JSON.stringify(plan),teacherOnly:base.teacherOnly,origin:'edited',publish:body.action==='publish'});
      if(body.action==='publish')addMaterial({slug:target,kind:'slides',content:renderLearningDocument(learning,{variant:'homework'}),origin:'edited',publish:true});
      return json({version:saved.version,published:!!saved.published_at});
    }
    const plan={...base.plan,learning:body.learning as LearningExperience};
    if(plan.teaching){const teachingErrors=teachingProblems(plan.teaching,plan);if(teachingErrors.length)return json({error:teachingErrors.join(' · ')},{status:400});}
    const saved=body.action==='publish'
      ? publishPlan(target,plan,base.teacherOnly).plan
      : addMaterial({slug:target,kind:'plan',content:JSON.stringify(plan),teacherOnly:base.teacherOnly,origin:'edited'});
    return json({version:saved.version,published:!!saved.published_at});
  });
};
