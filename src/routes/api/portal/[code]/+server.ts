/**
 * `GET /api/portal/:code` — one student's page.
 *
 * SECURITY-CRITICAL: a bad code format, a nonexistent student, a visitor
 * with no session, and a session scoped to a different student must ALL
 * answer with the identical 401 body. That uniform denial is what stops
 * this endpoint from being usable to discover which students exist. Keep
 * the single `deny()` helper rather than four separately-worded checks.
 *
 * A missing portal FILE is deliberately not in that list. Every denial
 * above is decided before the filesystem is touched, so by the time the
 * file is read the caller is already known to be entitled to this student
 * and can learn nothing new from the answer. Folding it in cost more than
 * it bought: a hand-added student had database rows and no file, and their
 * family followed a valid link straight into "you have no access".
 *
 * ## What replaced the pin
 *
 * This used to authenticate with `?pin=` in the query string — a shared
 * secret the parent invented at booking, sent as a URL parameter (and so
 * into access logs, browser history, and referrer headers), and typed on a
 * gate page whose input was `type="text"`, so it rendered in plaintext on
 * screen. One pin unlocked both the parent view and the student view,
 * which is the separation the PRD left open as "הפין משותף להורה+תלמיד —
 * זה מכוון או שצריך הפרדה?".
 *
 * Authorization is now the family session cookie, and the parent/student
 * split is real: `studentInScope` refuses a student token asking for a
 * sibling, and `canSeeParentView` refuses a student token asking for the
 * parent view of its own record.
 */
import { json } from '@sveltejs/kit';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { portalDir } from '$server/paths.ts';
import { balanceForAccount, chargesForStudent, todayInIsrael } from '$server/payments.ts';
import { selfPayerFinance } from '$server/self-payer-finance.ts';
import { resolveFamilyAccess, studentInScope } from '$server/family.ts';
import { getStudentByCode, nextBookingForStudent } from '$server/entities.ts';
import { lessonWhen, israelDay, israelToday } from '$lib/dates.ts';
import { toFamilyLesson } from '$lib/family-lesson.ts';
import { planFor } from '$lib/plans.ts';
import { homeworkForStudent } from '$server/lessons.ts';
import { progressFor } from '$server/progress.ts';
import type { RequestHandler } from './$types';

const CODE_FORMAT = /^[a-z0-9-]+$/;

export const GET: RequestHandler = async ({ params, url, locals }) => {
  const { code } = params;
  const kind = url.searchParams.get('kind') === 'parent' ? 'parent' : 'student';
  const deny = () =>
    json({ error: 'אין גישה לדף הזה' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });

  if (!CODE_FORMAT.test(code)) return deny();

  /* The tutor reads every student's page from her dashboard. Checked first
     and separately: her session is a different cookie with a different
     audience, and folding the two into one predicate is how a family
     session ends up satisfying a tutor-only guard. */
  if (!locals.authenticated) {
    if (!locals.family) return deny();

    const access = resolveFamilyAccess(locals.family);
    if (!access) return deny();

    // Both checks matter. The first stops a family reading another
    // family's page (and a child reading a sibling's); the second stops a
    // child opening the parent view of their own page, which carries the
    // balance.
    if (!studentInScope(access, code)) return deny();
    if (kind === 'parent' && !access.canSeeParentView) return deny();
  } else if (!getStudentByCode(code)) {
    return deny();
  }

  /* Past this point the caller is known to be entitled to this student, so
     a missing file is a server-side data problem, not an access decision.
     Answering 401 here told an authorized family "you have no access" for
     what is actually a broken deployment — and it is the same 500 an
     unparseable file already produces. Uniform denial is preserved where it
     matters: an unauthenticated or out-of-scope caller was refused above,
     before this line could distinguish anything. */
  const file = join(portalDir(), `${code}.json`);
  if (!existsSync(file)) {
    console.error('[portal] no file for an authorized student:', code);
    return json({ error: 'קובץ הדף פגום' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));

    // Every portal file enroll.ts's writePortalFile() creates has a `name`
    // — it's a required, always-set field, never derived or defaulted. A
    // file missing it is not a shape this route can safely serve: `name` is
    // what the parent/student views render as the child's display name, and
    // its absence means the file doesn't meet the shape this route promises
    // its callers. A file failing that contract is treated the same as
    // unparseable JSON: a visible 500, not a quietly incomplete 200 — the
    // failure-must-be-visible intent ruling P13 established still applies.
    if (typeof data.name !== 'string' || !data.name.trim()) {
      throw new Error('portal file missing name');
    }
    const authorizedStudent = getStudentByCode(code);

    /* Homework comes from the `homework` TABLE, not from this file.
     
       Both stores existed and neither worked: generated homework was
       written only into the file, so the tutor could not see or mark it,
       and homework she typed went only to the table, so the student never
       saw it. Verified before the change — a task added through the
       dashboard came back from /api/students/<code>/activity and was
       absent here.
     
       The file is still read when the table holds nothing for this student:
       portal files written before this change carry entries the table has
       not been given yet. Remove that fallback once
       scripts/backfill-homework-table.mjs has run everywhere — it is a
       migration aid, not a second source of truth, and it cannot produce
       duplicates because it only applies when the table is empty. */
    const student = authorizedStudent;
    const rows = student ? homeworkForStudent(student.id) : [];
    if (rows.length) {
      data.homework = rows.map(h => ({
        id: h.id,
        task: h.task,
        assigned: h.assigned_at ? israelDay(h.assigned_at) : null,
        due: h.due_at ?? null,
        /* Two stages, because they are different claims: the child says
           they finished it, and someone judged it. One boolean cannot say
           "she did it and nobody has looked yet", which is the state
           homework spends most of its life in. */
        submitted: h.submitted,
        graded: h.graded,
        grade: h.grade ?? null,
        gradedBy: h.graded_by ?? null,
        skill: h.skill ?? null,
      }));
    }

    /* Progress is computed, not read from the file. The file carried a
       hand-typed integer that was 0 for every student on production and
       always had been, so a child with a lesson, homework and three games
       was told they were at zero. See progress.ts for what replaces it. */
    data.progress = progressFor(code);

    /* Lessons in the one shape both family pages read: slides linked, the
       tutor's note hidden, and "coming" apart from "happened". */
    const todayIL = israelToday();
    data.lessons = (Array.isArray(data.lessons) ? data.lessons : [])
      .map((l: Record<string, unknown>) => toFamilyLesson(l ?? {}, todayIL));

    /* The next lesson from the bookings, not the value frozen into the file
       when the family booked: that one never changed, so after the lesson
       both boards kept announcing a date in the past as «השיעור הבא». */
    const next = student ? nextBookingForStudent(student.id) : null;
    data.nextLesson = next ? { ...lessonWhen(next.start), type: planFor(next.duration)?.name ?? '' } : null;

    /* Balance is a parent-facing concern, not the student's. It used to come
       from a Markdown table keyed on the student's display name — Latin in
       the file, Hebrew in the database — so it matched nothing and this
       section rendered empty for every family that ever had it. It is now
       the account's own rows, in agorot. */
    if (kind === 'parent') {
      const student = getStudentByCode(code);
      if (student) {
        data.balance = balanceForAccount(student.account_id, todayInIsrael());
        data.charges = chargesForStudent(student.id);
      }
    }

    /* A student who pays for themselves sees their own payment status on their
       page; a child in a family account never does (the parent view has it). */
    if (kind === 'student' && !locals.authenticated) {
      const finance = selfPayerFinance(getStudentByCode(code));
      if (finance) { data.balance = finance.balance; data.charges = finance.charges; }
    }

    return json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return json({ error: 'קובץ הדף פגום' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
};
