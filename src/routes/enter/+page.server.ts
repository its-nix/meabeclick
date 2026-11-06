import { googleEnabled } from '$server/google-login.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ setHeaders }) => {
  setHeaders({
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'same-origin',
  });
  return { googleEnabled: googleEnabled() };
};
