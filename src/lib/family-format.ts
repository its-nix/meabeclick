/**
 * What the parent view and the self-learner's home both say about lessons,
 * charges and progress. One source so the two pages cannot drift into
 * telling the same person two different things.
 */
import type { ProgressFacts } from './progress-facts.ts';

export type Audience = 'parent' | 'learner';

const MONTHS_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const DAYS_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export function formatDateHe(dateStr?: string | null): string {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${d} ${MONTHS_HE[m - 1]} ${y} (${DAYS_HE[date.getDay()]})`;
}

export const KIND_LABEL: Record<string, string> = { single: 'יחיד', double: 'כפול', triple: 'משולש' };
export const STATUS_LABEL: Record<string, string> = { owed: 'לתשלום', paid: 'שולם', void: 'בוטל' };

export interface Balance {
  owedAgorot: number; paidAgorot: number;
  dueAgorot: number; upcomingAgorot: number;
}
export interface Charge {
  id: number; date: string; kind: string; amount_agorot: number; status: string; claimed_at?: string | null;
}

/** What the progress figure counts, in words. Skills when anything is
 *  assessed, otherwise homework handed in — labelled as effort, never
 *  dressed up as understanding. */
export function progressWords(p: ProgressFacts | undefined | null, audience: Audience): string {
  if (!p || p.kind === 'none' || !p.total) {
    return audience === 'parent'
      ? 'עוד אין מה למדוד — זה יתחיל אחרי השיעור הראשון'
      : 'עוד אין מה למדוד — זה יתחיל אחרי השיעור הראשון.';
  }
  if (p.kind === 'skills') {
    return audience === 'parent'
      ? `${p.done} מתוך ${p.total} יכולות בתכנית הובנו`
      : `${p.done} מתוך ${p.total} יכולות בתכנית כבר בוצעו`;
  }
  return `${p.done} מתוך ${p.total} שיעורי בית הוגשו`;
}
