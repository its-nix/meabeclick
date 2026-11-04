import { error, json } from '@sveltejs/kit';
import { requireAuth } from '$server/auth.ts';
import { addMaterial } from '$server/materials.ts';
import { inTransaction } from '$server/db.ts';
import { editBase, publishPlan } from '$server/lesson/editing.ts';
import { experienceProblems, renderLearningDocument } from '$server/learning-render.ts';
import { documentHeaders } from '$server/document-policy.ts';
import type { LearningExperience } from '$lib/learning/model.ts';
import { learningMaterialSlug } from '$server/learning-store.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async event => {
  requireAuth(event);
  const form = await event.request.formData();
  let experience: LearningExperience;
  try { experience = JSON.parse(String(form.get('learning'))); } catch { error(400, 'תוכן לא תקין'); }
  const problems = experienceProblems(experience);
  if (problems.length) return new Response(problems.join('\n'), { status:400 });
  return new Response(renderLearningDocument(experience, { preview:true }), {headers:{...documentHeaders(),'Cache-Control':'no-store'}});
};

export const PUT: RequestHandler = async event => {
  requireAuth(event);
  let body: Record<string, unknown>;
  try { body = await event.request.json(); } catch { return json({error:'תוכן לא תקין'},{status:400}); }
  if (!body || !['draft','publish'].includes(String(body.action))) return json({error:'פעולה לא תקינה'},{status:400});
  const problems = experienceProblems(body.learning);
  if (problems.length) return json({error:problems.join(' · ')},{status:400});
  return inTransaction(() => {
    const target=learningMaterialSlug(event.params.slug);
    if (body.expectedTarget !== target) return json({error:'התרגול לשיעור עודכן. רעננו לפני שמירה.'},{status:409});
    const base=editBase(target);
    if (!base) return json({error:'השיעור לא נמצא'},{status:404});
    if (body.expectedVersion !== base.version) return json({error:'השיעור עודכן בחלון אחר. רעננו לפני שמירה.'},{status:409});
    const plan={...base.plan,learning:body.learning as LearningExperience};
    const saved=body.action==='publish'
      ? publishPlan(target,plan,base.teacherOnly).plan
      : addMaterial({slug:target,kind:'plan',content:JSON.stringify(plan),teacherOnly:base.teacherOnly,origin:'edited'});
    return json({version:saved.version,published:!!saved.published_at});
  });
};
