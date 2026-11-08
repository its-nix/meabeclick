export type PaymentFilter = 'all' | 'owed' | 'paid';
export type PaymentDateOrder = 'newest' | 'oldest';

/** A display-only view: never reorder or change the ledger used by mutations. */
export function paymentRows<T extends { id: number; date: string; status: string }>(
  charges: readonly T[],
  filter: PaymentFilter,
  order: PaymentDateOrder,
): T[] {
  return charges
    .filter(charge => filter === 'all' || charge.status === filter)
    .sort((a, b) => {
      const byDate = a.date.localeCompare(b.date);
      return (order === 'oldest' ? byDate : -byDate) || a.id - b.id;
    });
}
