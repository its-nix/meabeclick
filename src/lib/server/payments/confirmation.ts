/**
 * The ONLY place a charge becomes paid.
 *
 * Every path that settles money goes through `confirmPayment`: the tutor's
 * hand-marking on the dashboard (source 'manual') today, and a payment
 * processor's webhook (source 'processor') later. A payer's "I paid" claim
 * (./claim.ts) never reaches here; it only flags the charge for the tutor.
 *
 * ## How a processor webhook must call this (NOT integrated yet)
 *
 * 1. Read the RAW request body and verify the provider's signature over it
 *    (HMAC or public-key, with the provider's timestamp tolerance) BEFORE
 *    parsing or trusting any field. Reject unsigned or stale requests with
 *    401 and call nothing.
 * 2. Map the provider's order/metadata to our `chargeId` and its settled
 *    amount to integer agorot. Never take the amount from the browser.
 * 3. Call `confirmPayment({ chargeId, source: 'processor', reference,
 *    amountAgorot })` where `reference` is the provider's unique transaction
 *    id. Redelivery is expected: the same reference on the same charge is a
 *    no-op (`changed: false`), so answer 200 either way. A reference seen on
 *    a different charge, a different reference on an already-paid charge, a
 *    void charge, or an amount mismatch throws: answer non-2xx and alert the
 *    tutor, since that is a real reconciliation problem, not a retry.
 * 4. Respond only after this returns, so the provider retries on failure.
 *
 * Idempotency by reference is enforced here and by the unique index on
 * `payments.paid_reference` (migration 051).
 */
import { handle, inTransaction } from '../db.ts';

export type ConfirmSource = 'manual' | 'processor';

export type ConfirmInput = {
  chargeId: number;
  source: ConfirmSource;
  /** Processor transaction id. Required for 'processor'; optional for 'manual'. */
  reference?: string | null;
  /** Must equal the charge's amount exactly. */
  amountAgorot: number;
};

export type ConfirmResult = { chargeId: number; changed: boolean };

type Row = { id: number; status: string; amount_agorot: number; paid_reference: string | null };

export function confirmPayment(input: ConfirmInput): ConfirmResult {
  const { chargeId, source, amountAgorot } = input;
  const reference = input.reference?.trim() || null;
  if (source !== 'manual' && source !== 'processor') throw new TypeError(`confirmPayment: unknown source ${String(source)}`);
  if (!Number.isInteger(chargeId)) throw new TypeError('confirmPayment: chargeId must be an integer');
  if (!Number.isInteger(amountAgorot)) throw new TypeError('confirmPayment: amountAgorot must be an integer number of agorot');
  if (source === 'processor' && !reference) throw new TypeError('confirmPayment: a processor confirmation needs a reference');

  return inTransaction(() => {
    const db = handle();
    const row = db.prepare(`SELECT id, status, amount_agorot, paid_reference FROM payments WHERE id = ?`).get(chargeId) as Row | undefined;
    if (!row) throw new Error(`confirmPayment: unknown charge ${chargeId}`);
    if (row.status === 'void') throw new Error(`confirmPayment: charge ${chargeId} is void`);
    if (amountAgorot !== row.amount_agorot) {
      throw new Error(`confirmPayment: amount ${amountAgorot} does not match charge ${chargeId} (${row.amount_agorot})`);
    }
    if (row.status === 'paid') {
      if (source === 'processor' && row.paid_reference !== reference) {
        throw new Error(`confirmPayment: charge ${chargeId} is already paid under a different reference`);
      }
      return { chargeId, changed: false };
    }
    if (reference) {
      const used = db.prepare(`SELECT id FROM payments WHERE paid_reference = ? AND id <> ?`).get(reference, chargeId);
      if (used) throw new Error(`confirmPayment: reference already used by another charge`);
    }
    db.prepare(
      `UPDATE payments SET status = 'paid', paid_source = ?, paid_reference = ?, claimed_at = NULL, claim_note = NULL WHERE id = ?`
    ).run(source, reference, chargeId);
    return { chargeId, changed: true };
  });
}
