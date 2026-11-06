import { error, redirect } from '@sveltejs/kit';
import { learningAccess, assignedExperience } from '$server/learning-store.ts';
import { renderLearningDocument } from '$server/learning-render.ts';
import { documentHeaders } from '$server/document-policy.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params, locals, url }) => {
  if (!locals.family && !locals.authenticated) redirect(303, '/portal');
  const access = learningAccess(params.slug, locals);
  if (!access && !locals.authenticated) error(404, 'השיעור לא נמצא');
  const lesson = assignedExperience(params.slug);
  if (!lesson) error(404, 'השיעור עדיין לא מוכן');
  const solutions = url.searchParams.get('solutions') === '1';
  if (solutions && !locals.authenticated) error(403, 'התשובון מיועד למורה');
  return new Response(renderLearningDocument(lesson.experience, {
    slug: params.slug, storageScope: locals.authenticated ? `teacher:${params.slug}` : access?.code, solutions, preview: locals.authenticated,
    presenterUrl: locals.authenticated ? `/app/lessons/${encodeURIComponent(params.slug)}/presenter` : undefined,
    backUrl: locals.authenticated ? '/app/dashboard' : `/app/student?s=${encodeURIComponent(access!.code)}`,
  }), { headers: { ...documentHeaders(), 'Cache-Control': 'no-store' } });
};
