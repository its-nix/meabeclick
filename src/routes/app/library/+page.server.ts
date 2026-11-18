/**
 * The teaching workspace: the tutor's Google Drive library of lessons. Tutor only.
 */
import { requireAuth } from '$server/auth.ts';
import {nativeWorkspace} from '$server/learning-archive.ts';
import {centralLearningSync} from '$server/central-drive/sync.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
  requireAuth(event);
  event.setHeaders({ 'Cache-Control': 'private, no-store' });
  return { nativeWorkspace:nativeWorkspace(),centralDrive:centralLearningSync().view() };
};
