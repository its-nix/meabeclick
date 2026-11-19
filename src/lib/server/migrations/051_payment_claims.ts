/**
 * Migration 051 - payer claims and confirmation provenance.
 *
 *  - claimed_at / claim_note: the payer pressed "I paid". A claim is only a
 *    claim; it never changes `status`.
 *  - paid_source / paid_reference: how a charge came to be paid ('manual' by
 *    the tutor, or 'processor' with the processor's reference). The unique
 *    index on paid_reference is what makes a repeated processor callback
 *    idempotent at the database level.
 */
export const sql = `
ALTER TABLE payments ADD COLUMN claimed_at TEXT;
ALTER TABLE payments ADD COLUMN claim_note TEXT;
ALTER TABLE payments ADD COLUMN paid_source TEXT;
ALTER TABLE payments ADD COLUMN paid_reference TEXT;
CREATE UNIQUE INDEX idx_payments_paid_reference ON payments(paid_reference) WHERE paid_reference IS NOT NULL;
`;
