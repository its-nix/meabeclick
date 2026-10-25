import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ setHeaders }) => {
  setHeaders({
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  });
  return {};
};
