import { json } from '@sveltejs/kit';
import { peekLinkCredential } from '$server/access-credentials.ts';
import { resolveFamilyAccess, studentInScope } from '$server/family.ts';
import { allowAccessAttempt } from '$server/access-rate-limit.ts';
import { readJson } from '$server/http.ts';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
  const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
  if (!allowAccessAttempt(getClientAddress())) return json({ valid: false }, { status: 429, headers });
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const credential = peekLinkCredential((body as Record<string, unknown>)?.token);
  const access = credential ? resolveFamilyAccess(credential.identity) : null;
  if (!access) return json({ valid: false }, { status: 401, headers });
  const current = locals.family ? resolveFamilyAccess(locals.family) : null;
  const student = access.student;
  // A parent previews their child's board using existing authorization; no credential is consumed.
  const preview = student && current?.canSeeParentView && studentInScope(current, student.code);
  return json({ valid: true, kind: credential!.identity.kind, studentName: student?.name ?? null,
    previewDestination: preview ? `/app/student?s=${encodeURIComponent(student.code)}` : null,
  }, { headers });
};
