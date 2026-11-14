/**
 * Port of pages/app/dashboard.html. Requires a tutor session (spec §6) —
 * this is the page the characterization suite's one previously-failing test
 * targets: an unauthenticated GET here must 302 to /login. requireAuth
 * (src/lib/server/auth.ts) does exactly that for page routes.
 *
 * The old page carried its own client-side lock screen (a PASSWORD constant
 * literally readable in page source, gated further by sessionStorage) as a
 * fallback for opening the file directly with no server. That fallback no
 * longer applies — reaching this route at all now means the request already
 * passed the real server-side session check, so the lock screen is dropped
 * entirely rather than ported as dead code.
 */
import { requireAuth } from '$server/auth.ts';
import { roster, enrollmentsForStudent, listTeachers } from '$server/entities.ts';
import { tutorCardView } from '$server/tutor-settings.ts';
import { webClientFromEnv } from '$server/google-meet-setup.ts';
import { lessonsAwaitingReport } from '$server/reports/store.ts';
import { planForEnrollment, planData, lastLessonAt } from '$server/plans/store.ts';
import { buildTree } from '$server/plans/view.ts';
import { error, type RequestEvent } from '@sveltejs/kit';
import { engineAlert } from '$server/lesson/engine-health.ts';
import {centralLearningSync} from '$server/central-drive/sync.ts';
import {nativeWorkspace} from '$server/learning-archive.ts';
import {listNativeLessonJobs} from '$server/native-learning/jobs.ts';
import {NATIVE_PREPARATION_REASONS} from '$server/native-learning/worker.ts';
import {NORMAL_REVIEW_CONTEXT,supportedNativeContext} from '$server/native-learning/context.ts';

/** One guarded loader for the overview and the tutor's student detail page. */
export async function loadTutorWorkspace(event: RequestEvent, selectedStudentCode: string | null = null) {
  requireAuth(event);
  event.setHeaders({ 'Cache-Control': 'private, no-store' });
  // The learning-plan link lives on this roster row (task 7), and the design
  // spec calls this panel "already server-backed, unlike the student cards" —
  // it was not, until now: `realStudents` used to start empty and fill in
  // only from onMount's client-side GET /api/students, so a plain GET of
  // this route (no JS run) could never see the row, let alone the link
  // beside it. Seeding it here makes that true without removing the client
  // refresh below, which still keeps the panel live after a link is minted.
  //
  // Pending reports (task 5): a two-week window, same as the fixed inputs
  // the store's own tests use — old enough to catch a lesson she forgot
  // about, not so old the queue fills with lessons nobody will ever report.
  const now = new Date();
  const since = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const allRows = roster();
  const selected = selectedStudentCode ? allRows.find(s => s.code === selectedStudentCode) : null;
  if (selectedStudentCode && !selected) error(404, 'התלמיד/ה לא נמצא/ה');
  const rows = selected ? [selected] : allRows;
  const learningPlans = Object.fromEntries(rows.map(student => {
    // The dashboard has one learning-plan panel per student. Use the first
    // enrollment with an existing plan as its preview; the dedicated plan
    // page remains the place to switch subjects.
    const plan = enrollmentsForStudent(student.id)
      .map(enrollment => planForEnrollment(enrollment.id))
      .find(Boolean) ?? null;
    if (!plan) return [student.code, null];
    const { nodes, prereqs, events } = planData(plan.id);
    return [student.code, { planId: plan.id, topics: buildTree(nodes, prereqs, events, lastLessonAt(student.id)) }];
  }));
  return {
    selectedStudentCode,
    roster: rows, learningPlans,
    pendingReports: lessonsAwaitingReport(since, now.toISOString()).filter(l => !selected || l.studentId === selected.id),
    /* Null while the engine is up; see engine-health.ts. */
    engineAlert: engineAlert(now),
    /* The "מורים" card: each tutor's room and booking settings — the busy
       addresses only as a count (tutorCardView). Never setup_hash. */
    tutors: listTeachers().filter(t => t.active).map(tutorCardView),
    googleReady: webClientFromEnv() !== null,
    centralDrive:centralLearningSync().view(),
    nativeWorkspace:nativeWorkspace(),
    nativeReviewContext:NORMAL_REVIEW_CONTEXT,
    nativeAuthoringEnabled:process.env.NATIVE_LESSON_AUTHORING_ENABLED==='true',
    nativePreparations:listNativeLessonJobs(selected?{studentId:selected.id}:{}).map(job=>({bookingId:job.bookingId,studentId:job.studentId,studentName:allRows.find(s=>s.id===job.studentId)?.name??'תלמיד/ה',state:job.state,start:job.snapshot.start,canBind:['queued','failed','needs-preparation'].includes(job.state)&&supportedNativeContext({...job.snapshot,context:NORMAL_REVIEW_CONTEXT}),reason:job.reason?NATIVE_PREPARATION_REASONS[job.reason]??'נדרשת הכנת מורה.':null,error:job.errorCode?'ההכנה לא הושלמה. בדקו את חיבור Google ואת חומרי המקור.':null})),
  };
}
