/**
 * Payer claims "I paid" (POST, family session) and the tutor rejects a claim
 * (DELETE, tutor session). A claim never marks a charge paid; the tutor
 * confirms through /api/payments/mark -> confirmPayment.
 *
 * Only the payer of record may claim: an account session, or the learner's
 * own session when the account is self-paying (accounts.is_self). A child
 * inside a family account is refused, and so is a charge of another family.
 */
import { json } from '@sveltejs/kit';
import { apiAuthDenied } from '$server/auth.ts';
import { readJson } from '$server/http.ts';
import { resolveFamilyAccess } from '$server/family.ts';
import { paymentById } from '$server/payments.ts';
import { claimPayment, clearClaims, allowClaimAttempt } from '$server/payments/claim.ts';
import type { RequestHandler } from './$types';

const NO_STORE = { 'Cache-Control': 'no-store' };

export const POST: RequestHandler = async ({ request, locals }) => {
  const access = locals.family ? resolveFamilyAccess(locals.family) : null;
  if (!access || !(access.canSeeParentView || access.isSelf)) {
    return json({ error: 'אין גישה' }, { status: 401, headers: NO_STORE });
  }
  if (!allowClaimAttempt(`account:${access.account.id}`)) {
    return json({ error: 'יותר מדי ניסיונות, נסו שוב בעוד דקה' }, { status: 429, headers: NO_STORE });
  }
  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;
  const body = parsed as { id?: unknown; note?: unknown };
  if (!Number.isInteger(body.id)) return json({ error: 'מזהה לא תקין' }, { status: 400, headers: NO_STORE });
  const charge = paymentById(body.id as number);
  /* Same answer for "missing" and "not yours": no probing of other ids. */
  if (!charge || charge.account_id !== access.account.id || !access.students.some(s => s.id === charge.student_id)) {
    return json({ error: 'לא נמצא' }, { status: 404, headers: NO_STORE });
  }
  const result = claimPayment(charge.id, typeof body.note === 'string' ? body.note : null);
  if (result === 'not_claimable') return json({ error: 'לא ניתן לדווח על החיוב הזה' }, { status: 409, headers: NO_STORE });
  return json({ result }, { headers: NO_STORE });
};

export const DELETE: RequestHandler = async (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;
  const parsed = await readJson(event.request);
  if (parsed instanceof Response) return parsed;
  const ids = (parsed as { ids?: unknown }).ids;
  if (!Array.isArray(ids) || !ids.length || !ids.every(Number.isInteger)) {
    return json({ error: 'no payment ids' }, { status: 400 });
  }
  return json({ cleared: clearClaims(ids as number[]) });
};
