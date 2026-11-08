import { error } from '@sveltejs/kit';
import { requireAuth } from '$server/auth.ts';
import { handle } from '$server/db.ts';
import { safeTutorReturn } from '$lib/tutor-return.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = event => {
  requireAuth(event);
  event.setHeaders({ 'Cache-Control': 'private, no-store' });
  const lesson = handle().prepare('SELECT title, topic FROM lessons WHERE slug = ?').get(event.params.slug) as { title: string | null; topic: string | null } | undefined;
  if (!lesson) error(404, 'השיעור לא נמצא');
  const returnTo = safeTutorReturn(event.url.searchParams.get('returnTo'), event.url.origin, '/app/library');
  return { slug: event.params.slug, title: lesson.title || lesson.topic || 'מצגת', returnTo };
};
