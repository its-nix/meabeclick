import { getAccount, type StudentRow } from './entities.ts';
import { balanceForAccount, chargesForStudent, todayInIsrael, type AccountBalance, type PaymentRow } from './payments.ts';

/**
 * Payment status for a student who is the payer of record (accounts.is_self = 1:
 * an adult paying for their own lessons). Same data functions the parent view
 * uses. A child in a family account gets null: their parent pays and sees it.
 */
export function selfPayerFinance(student: Pick<StudentRow, 'id' | 'account_id'> | null): { balance: AccountBalance; charges: PaymentRow[] } | null {
  if (!student) return null;
  const account = getAccount(student.account_id);
  if (!account || account.is_self !== 1) return null;
  return { balance: balanceForAccount(account.id, todayInIsrael()), charges: chargesForStudent(student.id) };
}
