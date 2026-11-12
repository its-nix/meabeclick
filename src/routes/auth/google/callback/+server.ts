import { redirect } from '@sveltejs/kit';
import { claimGoogleFlow, exchangeGoogleCode, completeGoogleIdentity, familyDestination, tutorGoogleAllowed,
  savePendingProfile, GOOGLE_FLOW_COOKIE, GOOGLE_PENDING_COOKIE, GOOGLE_ERRORS } from '$server/google-login.ts';
import { setFamilySession } from '$server/family-auth.ts';
import { COOKIE_NAME, makeToken } from '$server/auth.ts';
import {learningService,LEARNING_FLOW_COOKIE,LEARNING_CONNECTION_PATH,LEARNING_GOOGLE_ERRORS} from '$server/learning-google.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies, locals, setHeaders }) => {
  setHeaders({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  if((url.searchParams.get('state')??'').startsWith('learning.')){
    const browser=cookies.get(LEARNING_FLOW_COOKIE)??'';
    cookies.delete(LEARNING_FLOW_COOKIE,{path:'/auth/google'});
    if(!locals.authenticated)redirect(303,`/login?next=${encodeURIComponent(LEARNING_CONNECTION_PATH)}`);
    try{
      await learningService().finish({state:url.searchParams.get('state')??'',browser,session:cookies.get(COOKIE_NAME)??'',authCode:url.searchParams.get('code'),pickedFileIds:url.searchParams.get('picked_file_ids'),error:url.searchParams.get('error')});
    }catch(e){
      const reason=e instanceof Error&&LEARNING_GOOGLE_ERRORS[e.message]?e.message:'google';
      redirect(303,`${LEARNING_CONNECTION_PATH}?connectionError=${reason}`);
    }
    redirect(303,LEARNING_CONNECTION_PATH);
  }
  const flow = claimGoogleFlow(url.searchParams.get('state') ?? '', cookies.get(GOOGLE_FLOW_COOKIE) ?? '');
  cookies.delete(GOOGLE_FLOW_COOKIE, { path: '/auth/google' });
  if (!flow) redirect(303, '/portal?authError=expired');
  const errorPage = flow.intent === 'tutor' ? '/login' : '/portal';
  if (url.searchParams.has('error')) redirect(303, `${errorPage}?authError=cancelled`);
  let destination: string;
  try {
    const code = url.searchParams.get('code');
    if (!code || code.length > 4096) throw new Error('google');
    // A link action cannot outlive a switch/logout of the authorizing family session.
    if (flow.intent === 'link' && (!locals.family || locals.family.kind !== flow.scope_kind || locals.family.id !== flow.scope_id)) throw new Error('expired');
    const profile = await exchangeGoogleCode(code, flow);
    if (flow.intent === 'tutor') {
      if (!tutorGoogleAllowed(profile)) throw new Error('tutor');
      cookies.set(COOKIE_NAME, makeToken(), { path: '/', httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:', maxAge: 30 * 86400 });
      destination = flow.next_path.startsWith('/app/') ? flow.next_path : '/app/dashboard';
    } else {
      const identity = completeGoogleIdentity(profile, flow);
      if (identity) {
        setFamilySession(cookies, identity);
        destination = familyDestination(identity, flow.next_path);
      } else {
        const pending = savePendingProfile(flow, profile);
        cookies.set(GOOGLE_PENDING_COOKIE, pending, { path: '/onboarding', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 600 });
        destination = '/onboarding';
      }
    }
  } catch (error) {
    const reason = error instanceof Error && GOOGLE_ERRORS[error.message] ? error.message : 'google';
    // No provider response, tokens, profile, or callback URL in logs/errors.
    redirect(303, `${errorPage}?authError=${reason}`);
  }
  redirect(303, destination);
};
