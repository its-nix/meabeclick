import { json } from '@sveltejs/kit';
import { consumeLinkCredential } from '$server/access-credentials.ts';
import { setFamilySession, readFamilySession } from '$server/family-auth.ts';
import { resolveFamilyAccess, studentInScope } from '$server/family.ts';
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

  if (identity.kind === 'student') {
    const held = readFamilySession(cookies);
    const heldAccess = held?.kind === 'account' ? resolveFamilyAccess(held) : null;
    if (heldAccess && access.student && studentInScope(heldAccess, access.student.code)) {
      return json({ ok: true, destination: `/app/student?s=${encodeURIComponent(access.student.code)}` }, { headers });
    }
  }

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
