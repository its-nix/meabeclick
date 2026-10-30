import { requireAuth } from '$server/auth.ts';
import type { PageServerLoad } from './$types';

/** Approved Option C shell: deliberately no DB, aggregate or service imports. */
export const load: PageServerLoad = (event) => {
  requireAuth(event);
  event.setHeaders({ 'cache-control': 'private, no-store' });
  return {};
};
