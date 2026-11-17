/**
 * The parent's sharing control for one of their children: a link to forward.
 *
 * It is minted here rather than on the page, because it is an access token —
 * a page that could construct it would have to be trusted with the signing
 * secret.
 *
 * Only an account session reaches this. A student session must never be
 * able to mint another student's link, or re-share its own to a wider
 * audience, so `canSeeParentView` gates the whole endpoint.
 */
import { json } from '@sveltejs/kit';
import { resolveFamilyAccess, studentInScope } from '$server/family.ts';
import { issueStudentCredentials } from '$server/access-credentials.ts';
import { readJson } from '$server/http.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.family) return json({ error: 'אין גישה' }, { status: 401 });

  const access = resolveFamilyAccess(locals.family);
  if (!access || !access.canSeeParentView) return json({ error: 'אין גישה' }, { status: 401 });

  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;

  const code = String((parsed as Record<string, unknown>)?.code ?? '');
  const student = studentInScope(access, code);
  if (!student) return json({ error: 'אין גישה' }, { status: 401 });

  const credential = issueStudentCredentials(student.id, { type: 'parent', id: access.account.id });

  return json({
    name: student.name,
    link: credential.link,
  }, { headers: { 'Cache-Control': 'no-store' } });
};
