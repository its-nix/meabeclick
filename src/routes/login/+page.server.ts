import { tutorGoogleEnabled, GOOGLE_ERRORS } from '$server/google-login.ts';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = ({ url }) => ({
  googleEnabled: tutorGoogleEnabled(),
  authError: GOOGLE_ERRORS[url.searchParams.get('authError') ?? ''] ?? '',
});
