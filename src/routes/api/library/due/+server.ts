/**
 * GET /api/library/due?ahead=N — the skills students will need within
 * their next N (default 3), and whether each is ready (library/due.ts
 * dueAhead). For preparing the library ahead from the tutor's machine
 * (scripts/library-local.mjs --due), which reads it on the box with the
 * cron key; the tutor's session works too. Names no student.
 */
import { json } from '@sveltejs/kit';
import {nativeWorkspace,NATIVE_AUTHORING_MESSAGE} from '$server/learning-archive.ts';
import { apiAuthDenied } from '$server/auth.ts';
import { authorizedCronRequest } from '$server/cron-auth.ts';
import { dueAhead } from '$server/library/due.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => {
  if (!authorizedCronRequest(event.request.headers.get('x-cron-key'))) {
    const denied = apiAuthDenied(event);
    if (denied) return denied;
  }
  if(nativeWorkspace())return json({due:[],message:NATIVE_AUTHORING_MESSAGE,workspaceUrl:'/app/library'},{headers:{'Cache-Control':'private, no-store'}});
  const n = Number(event.url.searchParams.get('ahead') ?? 3);
  const ahead = Number.isInteger(n) && n > 0 ? Math.min(n, 20) : 3;
  return json({ due: dueAhead(ahead) }, { headers: { 'Cache-Control': 'no-store' } });
};
