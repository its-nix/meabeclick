import { redirect } from '@sveltejs/kit';
import { googleEnabled, startGoogleFlow, GOOGLE_FLOW_COOKIE } from '$server/google-login.ts';
import { peekLinkCredential } from '$server/access-credentials.ts';
import { resolveFamilyAccess } from '$server/family.ts';
import { allowAccessAttempt } from '$server/access-rate-limit.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, cookies, locals, getClientAddress }) => {
  if (!googleEnabled()) redirect(303, '/portal?authError=unavailable');
  if (!allowAccessAttempt(getClientAddress())) redirect(303, '/portal?authError=google');
  let form: FormData;
  try { form = await request.formData(); } catch { redirect(303, '/portal?authError=google'); }
  const intent = form.get('intent');
  const token = form.get('token');
  let options: Parameters<typeof startGoogleFlow>[0] = { intent: 'login', next: form.get('next') };
  if (token) {
    const invitation = peekLinkCredential(token);
    if (!invitation || !resolveFamilyAccess(invitation.identity)) redirect(303, '/portal?authError=expired');
    options = { ...options, intent: 'invite', credentialId: invitation.credentialId };
  } else if (intent === 'link') {
    if (!locals.family || !resolveFamilyAccess(locals.family)) redirect(303, '/portal?authError=expired');
    options = { ...options, intent: 'link', identity: locals.family };
  } else if (intent === 'tutor') {
    options = { ...options, intent: 'tutor' };
  }
  const flow = startGoogleFlow(options);
  cookies.set(GOOGLE_FLOW_COOKIE, flow.browser, { path: '/auth/google', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 600 });
  redirect(303, flow.url);
};
