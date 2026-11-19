/**
 * Sets the status of one or more charges. Tutor-only.
 *
 * Every id is checked to exist before anything is written, so a batch
 * naming one bad id changes nothing at all. Half-applying an update to a
 * ledger leaves the tutor with a figure she cannot reconcile and no way to
 * tell which rows moved.
 */
import { json } from '@sveltejs/kit';
import { apiAuthDenied } from '$server/auth.ts';
import { readJson } from '$server/http.ts';
import { setPaymentStatus, paymentsExist, paymentById } from '$server/payments.ts';
import { confirmPayment } from '$server/payments/confirmation.ts';
import { inTransaction } from '$server/db.ts';
import type { RequestHandler } from './$types';

const STATUSES = new Set(['owed', 'paid', 'void']);

export const POST: RequestHandler = async (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;

  const parsed = await readJson(event.request);
  if (parsed instanceof Response) return parsed;
  const body = parsed as { ids?: unknown; status?: unknown };

  const ids = Array.isArray(body.ids) ? body.ids.filter(Number.isInteger) as number[] : [];
  const status = String(body.status ?? '');

  if (!ids.length) return json({ error: 'no payment ids' }, { status: 400 });
  if (ids.length !== (body.ids as unknown[]).length) {
    return json({ error: 'every id must be an integer' }, { status: 400 });
  }
  if (!STATUSES.has(status)) return json({ error: 'unknown status' }, { status: 400 });
  if (!paymentsExist(ids)) return json({ error: 'unknown payment' }, { status: 400 });

  if (status === 'paid') {
    /* The tutor's hand confirmation. confirmPayment is the only code that
       sets a charge paid; one bad row rolls the whole batch back. */
    try {
      const updated = inTransaction(() => ids.reduce((n, id) => {
        const charge = paymentById(id)!;
        return n + (confirmPayment({ chargeId: id, source: 'manual', amountAgorot: charge.amount_agorot }).changed ? 1 : 0);
      }, 0));
      return json({ updated });
    } catch { return json({ error: 'cannot confirm payment' }, { status: 400 }); }
  }
  return json({ updated: setPaymentStatus(ids, status as 'owed' | 'void') });
};
