import { handle } from './db.ts';
import { israelDay } from '../dates.ts';

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
});

const calendarFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
});

export type MarketingDay = {
  date: string;
  visitors: number;
  bookings: number;
  paidAgorot: number;
  owedAgorot: number;
};

/** Anonymous daily activity, grouped by Israel's calendar (including DST).
 * Visitor IDs stay on the server. A returning visitor counts once each day;
 * daily visitor counts must not be summed into the window's unique total.
 * Payments use their charge date and current status, not a collection date.
 */
export function marketingTrends(sinceIso: string, untilIso: string): MarketingDay[] {
  const first = israelDay(sinceIso);
  const last = israelDay(untilIso);
  const days = new Map<string, MarketingDay>();
  for (let date = first; date <= last;) {
    days.set(date, { date, visitors: 0, bookings: 0, paidAgorot: 0, owedAgorot: 0 });
    // Advance a date-only key, independently of the length of an Israel DST day.
    date = calendarFormatter.format(new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000));
  }
  const visitors = new Map<string, Set<string>>();
  const events = handle().prepare(`
    SELECT at, event, visitor_id FROM marketing_events
    WHERE at >= ? AND at <= ? AND event IN ('landing_visit', 'lesson_scheduled')
  `).all(sinceIso, untilIso) as { at: string; event: string; visitor_id: string | null }[];
  for (const event of events) {
    const date = dayFormatter.format(new Date(event.at));
    const day = days.get(date);
    if (!day) continue;
    if (event.event === 'lesson_scheduled') day.bookings++;
    else if (event.visitor_id) {
      const seen = visitors.get(date) ?? new Set<string>();
      seen.add(event.visitor_id);
      visitors.set(date, seen);
      day.visitors = seen.size;
    }
  }
  const payments = handle().prepare(`
    SELECT date, status, SUM(amount_agorot) AS amount FROM payments
    WHERE date >= ? AND date <= ? AND status IN ('paid', 'owed')
    GROUP BY date, status
  `).all(first, last) as { date: string; status: string; amount: number }[];
  for (const payment of payments) {
    const day = days.get(payment.date);
    if (!day) continue;
    if (payment.status === 'paid') day.paidAgorot = payment.amount;
    else day.owedAgorot = payment.amount;
  }
  return [...days.values()];
}
