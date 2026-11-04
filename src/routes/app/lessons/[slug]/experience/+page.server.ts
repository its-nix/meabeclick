import { error } from '@sveltejs/kit';
import { requireAuth } from '$server/auth.ts';
import { editBase } from '$server/lesson/editing.ts';
import { learningMaterialSlug, learningAccess, assignedExperience, learningProgress } from '$server/learning-store.ts';
import type { LearningExperience } from '$lib/learning/model.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = event => {
  requireAuth(event);
  const materialSlug=learningMaterialSlug(event.params.slug);
  const row=editBase(materialSlug);
  if (!row) error(404,'השיעור לא נמצא');
  const plan=row.plan;
  if (!plan.learning) error(404,'לשיעור הזה אין מרחב למידה אינטראקטיבי');
  const access=learningAccess(event.params.slug,event.locals);
  const published=assignedExperience(event.params.slug);
  const progress=access && published ? learningProgress(access.studentId,event.params.slug,published.fingerprint) : {};
  const studentLearning=access && published ? {
    title:published.experience.title,
    questions:published.experience.scenes.filter(s=>s.check).map(s=>({
      id:s.id,question:s.check!.question,...(progress[s.id]??{attempts:0,hints:0,solved:false,visited:false}),
    })),
  } : null;
  return {slug:event.params.slug,materialSlug,version:row.version,pendingRegeneration:row.pendingRegeneration,learning:plan.learning as LearningExperience,studentLearning};
};
