import { json } from '@sveltejs/kit';
import { consumeLinkCredential } from '$server/access-credentials.ts';
import { setFamilySession } from '$server/family-auth.ts';
import { resolveFamilyAccess } from '$server/family.ts';
import { readJson } from '$server/http.ts';
import { allowAccessAttempt } from '$server/access-rate-limit.ts';
import type { RequestHandler } from './$types';

const headers = { 'Cache-Control': 'no-store' };
const invalid = () => json({ error: 'הקישור כבר לא תקף. אפשר לבקש קישור אישי חדש — בלי לחכות למורה.' }, { status: 401, headers });

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
  if (!allowAccessAttempt(getClientAddress())) return invalid();
  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;

  const identity = consumeLinkCredential((parsed as Record<string, unknown>)?.token);
  if (!identity) return invalid();
  const access = resolveFamilyAccess(identity);
  if (!access) return invalid();

  // The redeemed credential is the requested identity. Always replace any
  // cookie already on the device: retaining an account session after a child
  // redeems their link would leave parent, sibling, and payment scope active.
  setFamilySession(cookies, identity);
  if (access.canSeeParentView && !access.isSelf) {
    return json({ ok: true, destination: '/app/parent' }, { headers });
  }
  const student = access.student ?? access.students[0];
  return json({
    ok: true,
    destination: student ? `/app/student?s=${encodeURIComponent(student.code)}` : '/app/parent',
  }, { headers });
};
