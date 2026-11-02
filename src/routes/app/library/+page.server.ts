/**
 * The prepared library — see docs/superpowers/specs/2026-09-28-prepared-library-design.md.
 * Tutor only; the template comes from ?template=, maths grade 8 by default
 * (the trial's).
 */
import { error } from '@sveltejs/kit';
import { requireAuth } from '$server/auth.ts';
import { libraryTableView } from '$server/library/view.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
  requireAuth(event);
  event.setHeaders({ 'Cache-Control': 'private, no-store' });
  const view = libraryTableView();
  const selectedTemplate = event.url.searchParams.get('template') ?? '';
  if (selectedTemplate && !view.templates.some(t => t.id === selectedTemplate)) error(404, 'אין תבנית כזו');
  return { ...view, selectedTemplate, filters: {
    topic: event.url.searchParams.get('topic') ?? '',
    status: event.url.searchParams.get('status') ?? '',
    search: event.url.searchParams.get('search') ?? '',
    page: Number(event.url.searchParams.get('page') ?? 1),
  } };
};
