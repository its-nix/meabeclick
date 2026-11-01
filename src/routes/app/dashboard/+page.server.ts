import { loadTutorWorkspace } from '$server/tutor-workspace.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = event => loadTutorWorkspace(event);
