import { error } from '@sveltejs/kit';
import { requireAuth } from '$server/auth.ts';
import { assignedExperience } from '$server/learning-store.ts';
import { renderPresenterNotes } from '$server/presenter-notes.ts';
import { documentHeaders } from '$server/document-policy.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = event => {
  requireAuth(event);
  const lesson = assignedExperience(event.params.slug);
  if (!lesson) error(404, 'השיעור עדיין לא מוכן');
  return new Response(renderPresenterNotes(lesson.experience, event.params.slug,{plan:lesson.plan}), {
    headers: { ...documentHeaders(), 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' },
  });
};
