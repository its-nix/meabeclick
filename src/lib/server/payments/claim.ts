/**
 * A payer's "I paid" claim. It records that the payer says they paid; it
 * never marks anything paid (only ./confirmation.ts does). The tutor
 * confirms with the normal mark-paid path or rejects the claim.
 */
import { handle } from '../db.ts';

export type ClaimResult = 'claimed' | 'already_claimed' | 'already_paid' | 'not_claimable';

export function claimPayment(chargeId: number, note?: string | null): ClaimResult {
  const db = handle();
  const row = db.prepare(`SELECT status, claimed_at FROM payments WHERE id = ?`).get(chargeId) as { status: string; claimed_at: string | null } | undefined;
  if (!row || row.status === 'void') return 'not_claimable';
  if (row.status === 'paid') return 'already_paid';
  if (row.claimed_at) return 'already_claimed';
  db.prepare(`UPDATE payments SET claimed_at = ?, claim_note = ? WHERE id = ? AND status = 'owed' AND claimed_at IS NULL`)
    .run(new Date().toISOString(), note?.trim().slice(0, 200) || null, chargeId);
  return 'claimed';
}

/** Tutor rejects (or a confirmation clears) claims. Returns rows changed. */
export function clearClaims(ids: number[]): number {
  const stmt = handle().prepare(`UPDATE payments SET claimed_at = NULL, claim_note = NULL WHERE id = ? AND claimed_at IS NOT NULL`);
  let n = 0;
  for (const id of ids) n += Number(stmt.run(id).changes);
  return n;
}

const WINDOW_MS = 60_000;
const PER_KEY = 10;
const hits = new Map<string, number[]>();

/** In-memory per-session limiter (production is one Node process). */
export function allowClaimAttempt(key: string, now = Date.now()): boolean {
  const fresh = (hits.get(key) ?? []).filter(t => now - t < WINDOW_MS);
  fresh.push(now);
  hits.set(key, fresh);
  if (hits.size > 2000) for (const [k, v] of hits) if (!v.some(t => now - t < WINDOW_MS)) hits.delete(k);
  return fresh.length <= PER_KEY;
}
