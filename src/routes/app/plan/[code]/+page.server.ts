/**
 * The learning plan, for the tutor alone.
 *
 * Rendered server-side rather than fetched after mount: the tree is the whole
 * point of the page, and a spinner in front of it buys nothing. Everything the
 * page can show is decided here, including which templates could start a plan
 * for a subject that has none.
 */
import { error } from '@sveltejs/kit';
import { requireAuth } from '$server/auth.ts';
import { getStudentByCode, enrollmentsForStudent } from '$server/entities.ts';
import { templatesForSubject, templateById, templateFitsLevel } from '$server/plans/templates.ts';
import { planForEnrollment, planData, lastLessonAt } from '$server/plans/store.ts';
import { buildTree } from '$server/plans/view.ts';
import { FILTER_VALUES, type FilterKind } from '$lib/plan-status.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  requireAuth(event);

  const student = getStudentByCode(event.params.code);
  if (!student) error(404, 'לא נמצא');

  const enrollments = enrollmentsForStudent(student.id);
  const wanted = event.url.searchParams.get('subject');
  const current = enrollments.find(e => e.subject === wanted) ?? enrollments[0] ?? null;

  const plan = current ? planForEnrollment(current.id) : null;
  const lesson = lastLessonAt(student.id);

  // The report form navigates here with ?filter=changed so the tutor lands
  // on exactly what her report just moved (design spec §6, "after
  // submitting"). Read here rather than trusted client-side, the same way
  // `subject` already is — an invalid or absent value falls back to 'all',
  // the page's own default.
  const wantedFilter = event.url.searchParams.get('filter');
  const filter: FilterKind = FILTER_VALUES.includes(wantedFilter as FilterKind)
    ? (wantedFilter as FilterKind)
    : 'all';

  return {
    student: { code: student.code, name: student.name },
    subjects: enrollments.map(e => ({ id: e.id, subject: e.subject, level: e.level })),
    current: current ? { id: current.id, subject: current.subject, level: current.level } : null,
    filter,
    // events rides along beside the tree — buildTree already collapses it
    // into "current status" and "changed", but the skill sheet's history
    // list ("history newest first", spec §7) needs the raw log, and neither
    // write endpoint returns it (both answer { plan, tree }). It never
    // leaves this one plan's rows, so exposing it here costs nothing the
    // tutor doesn't already see one event at a time as she works.
    plan: plan
      ? (() => {
          const { nodes, prereqs, events } = planData(plan.id);
          return {
            row: plan,
            tree: buildTree(nodes, prereqs, events, lesson),
            events,
            templateReviewed: templateById(plan.template_id)?.reviewed ?? null,
          };
        })()
      : null,
    // Every template for the subject, never filtered down — the tutor must
    // still be able to choose deliberately even when it doesn't fit the
    // enrollment's level (a grade never determines a bagrut track; see the
    // page component for what it does with `fitsLevel`).
    templates: current
      ? templatesForSubject(current.subject).map(t => ({
          id: t.id,
          track: t.track,
          reviewed: t.reviewed,
          fitsLevel: templateFitsLevel(t, current.level),
        }))
      : [],
  };
};
