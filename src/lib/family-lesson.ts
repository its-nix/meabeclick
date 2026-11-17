/**
 * A lesson as the family pages get it from /api/portal/[code] — the shape
 * declared once (pages import the type; the portal API builds it).
 *
 * Pre-launch review, 2026-09-28: generation at BOOKING time wrote the
 * lesson dated today with the plan's gradeContext — a note written for the
 * tutor — as its "summary", so a lesson counted as done before it happened.
 *
 * Families get no presentation link (Nikol, 2026-11-16): the old site-made
 * decks are retired, and native Google Slides are private teacher decks with
 * speaker notes and solutions. A student-safe view is a later task.
 */
export interface FamilyLesson {
  date: string;
  topic: string;
  /** Only an imported lesson's summary, written for the family. */
  summary: string | null;
  /** Not yet happened (Israel date after today): shown as coming, not counted. */
  upcoming: boolean;
}

/** `today` is the Israel date, 'YYYY-MM-DD'. */
export function toFamilyLesson(
  raw: { date?: unknown; topic?: unknown; summary?: unknown; slug?: unknown },
  today: string,
): FamilyLesson {
  const date = String(raw.date ?? '');
  const slug = typeof raw.slug === 'string' ? raw.slug : null;
  return {
    date,
    topic: String(raw.topic ?? ''),
    /* A generated lesson (it has a slug) carried gradeContext here — for the
       tutor. Lessons from the old ledger have no slug, and their summary is
       what was learned, written for the family. */
    summary: slug ? null : (typeof raw.summary === 'string' && raw.summary.trim() ? raw.summary : null),
    upcoming: date > today,
  };
}
