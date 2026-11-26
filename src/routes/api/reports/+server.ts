/**
 * Filing (or correcting) one lesson's report. Tutor-only.
 *
 * Returns the refreshed plan view alongside the report, so the page that
 * posted it can show what the report moved without a second request — and
 * so nothing on screen is ever a guess about what was written.
 */
import { json } from '@sveltejs/kit';
import { apiAuthDenied } from '$server/auth.ts';
import { readJson } from '$server/http.ts';
import { STATUSES, type SkillStatus } from '$lib/plan-status.ts';
import { nativeReportSource } from '$server/reports/native-source.ts';
import { coverageInput, ReportConflict } from '$server/reports/coverage.ts';
import { fileReport, reportForBooking, bookingForReport, planForReport } from '$server/reports/store.ts';
import { planData, nodeInPlan, lastLessonAt } from '$server/plans/store.ts';
import { buildTree } from '$server/plans/view.ts';
import { emailFamilyAfterReport } from '$server/notices.ts';
import type { RequestHandler } from './$types';

const NOT_FOUND = { error: 'לא נמצא' };
const MAX_NOTE = 2000;

export const POST: RequestHandler = async (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;

  const parsed = await readJson(event.request);
  if (parsed instanceof Response) return parsed;
  const body = parsed as Record<string, unknown>;

  const booking = bookingForReport(Number(body.bookingId));
  if (!booking) return json(NOT_FOUND, { status: 404 });
  if (booking.status !== 'confirmed') return json({ error: 'השיעור בוטל' }, { status: 400 });
  // booking.end keeps the client's original offset (e.g. +03:00), not
  // normalized to UTC — comparing it against toISOString()'s always-Z
  // string with `>` is a lexicographic compare of two different formats,
  // not a comparison of instants. new Date(...).getTime() parses both
  // correctly regardless of which offset each carries.
  if (new Date(booking.end).getTime() > Date.now()) {
    return json({ error: 'אי אפשר לדווח על שיעור שטרם הסתיים' }, { status: 400 });
  }

  const note = body.note == null ? null : String(body.note);
  if (note !== null && note.length > MAX_NOTE) return json({ error: 'ההערה ארוכה מדי' }, { status: 400 });

  const plan = planForReport(booking);

  const raw = Array.isArray(body.entries) ? body.entries : [];
  const coveredSkillIds = body.coveredSkillIds;
  if (coveredSkillIds !== undefined &&
      (!Array.isArray(coveredSkillIds) || !coveredSkillIds.every(id => Number.isSafeInteger(id) && id > 0))) {
    return json({ error: 'רשימת היכולות שנלמדו אינה תקינה' }, { status: 400 });
  }
  // Legacy bookings can have no enrollment. Free-text reports still work.
  if ((raw.length > 0 || (coveredSkillIds?.length ?? 0) > 0) && !plan) {
    return json({ error: 'לשיעור הזה אין תכנית לימודים — אפשר לדווח רק הערה' }, { status: 400 });
  }

  const entries: { nodeId: number; status: SkillStatus }[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return json({ error: 'רשומה לא תקינה' }, { status: 400 });
    const { nodeId, status } = item as Record<string, unknown>;
    const id = Number(nodeId);
    if (!Number.isInteger(id)) return json({ error: 'רשומה לא תקינה' }, { status: 400 });
    if (!STATUSES.includes(String(status) as SkillStatus)) {
      return json({ error: 'צריך לבחור מצב לכל יכולת שסומנה' }, { status: 400 });
    }
    // The node must belong to THIS lesson's plan: a report speaks for one
    // student, and an id from elsewhere is not a typo worth guessing about.
    // plan is non-null here (checked above whenever raw is non-empty).
    if (!plan || !nodeInPlan(plan.id, id)) return json(NOT_FOUND, { status: 404 });
    entries.push({ nodeId: id, status: String(status) as SkillStatus });
  }

  for (const id of coveredSkillIds ?? []) {
    const node = plan && nodeInPlan(plan.id, id);
    if (!node) return json(NOT_FOUND, { status: 404 });
    if (node.kind !== 'skill') return json({ error: 'אפשר לסמן רק יכולת מהתכנית' }, { status: 400 });
  }

  try {
    const selection = body.coverage === undefined ? null : coverageInput(body.coverage);
    const verifiedNative = selection?.source === 'native' && selection.selection === 'current' &&
      selection.confirmed === true && typeof selection.token === 'string' && /^[a-f0-9]{64}$/.test(selection.token)
      ? await nativeReportSource(booking) : undefined;
    fileReport({ bookingId: booking.id, note, entries, coveredSkillIds, expectedFiling: body.expectedFiling,
      coverage: body.coverage, verifiedNative });
  } catch (err) {
    if (err instanceof ReportConflict) {
      return json({ error: 'הדיווח או גרסת המצגת השתנו או אינם זמינים. העתיקו את השינויים ורעננו את העמוד.' }, { status: 409 });
    }
    console.error('[reports] file failed:', (err as Error).message);
    return json({ error: 'אי אפשר לשמור את הדיווח הזה' }, { status: 400 });
  }

  /* The family's "lesson reported" email. Not awaited, once per lesson. */
  emailFamilyAfterReport(booking.id)
    .catch(err => console.error('[reports] family email failed:', (err as Error).message));

  const report = reportForBooking(booking.id);
  if (!plan) return json({ report, plan: null, tree: [], events: [] });

  const fresh = planData(plan.id);
  return json({
    report,
    plan: fresh.plan,
    tree: buildTree(fresh.nodes, fresh.prereqs, fresh.events, lastLessonAt(booking.student_id)),
    events: fresh.events,
  });
};
