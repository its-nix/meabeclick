/**
 * The prepared library for one plan template (tutor only):
 * GET /api/library?template=math-8. See library/view.ts.
 */
import { json } from '@sveltejs/kit';
import { apiAuthDenied } from '$server/auth.ts';
import { libraryView, libraryTableView } from '$server/library/view.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;
  if (event.url.searchParams.get('all') === '1') {
    return json(libraryTableView(), { headers: { 'Cache-Control': 'private, no-store' } });
  }
  const view = libraryView(event.url.searchParams.get('template') ?? '');
  if (!view) return json({ error: 'אין תבנית כזו' }, { status: 404 });
  return json(view, { headers: { 'Cache-Control': 'no-store' } });
};
