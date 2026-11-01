import { handle } from './db.ts';
import { HEARD_FROM_VALUES } from '../marketing-labels.ts';

/** Null means no recorded default (including genuinely unknown legacy data). */
export function familyAcquisitionSource(accountId: number): string | null {
  const row = handle().prepare('SELECT source FROM family_acquisition_sources WHERE account_id = ?')
    .get(accountId) as { source: string } | undefined;
  return row?.source ?? null;
}

/** Called only after a booking succeeds. An omitted answer may initialize
 * an unknown default, but never overwrites a newer answer from another tab. */
export function recordFamilyAcquisitionSource(accountId: number, source: string, explicitAnswer: boolean): void {
  if (!HEARD_FROM_VALUES.has(source)) throw new Error('Invalid acquisition source');
  const conflict = explicitAnswer
    ? 'DO UPDATE SET source = excluded.source, updated_at = excluded.updated_at'
    : 'DO NOTHING';
  handle().prepare(`
    INSERT INTO family_acquisition_sources (account_id, source, updated_at)
    VALUES (?, ?, ?) ON CONFLICT(account_id) ` + conflict)
    .run(accountId, source, new Date().toISOString());
}
