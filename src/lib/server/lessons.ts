/**
 * Lessons and homework.
 *
 * One lessons table holds both halves of a lesson: the generator fills
 * title/context/slides/status, the tutor fills summary, and either may be
 * empty. They describe the same event, and keeping them apart is what
 * produced two sources of truth (the lessons table and portal/<code>.json).
 */
import { handle } from './db.ts';

export type LessonRow = {
  id: number; student_id: number; enrollment_id: number | null;
  teacher_id: number | null; slug: string; topic: string | null;
  title: string | null; context: string | null; summary: string | null;
  status: string; problem: string | null; slides_path: string | null;
  lesson_at: string | null; created_at: string;
};
export type HomeworkGrade = 'ok' | 'partial' | 'redo';
export const HOMEWORK_GRADES: HomeworkGrade[] = ['ok', 'partial', 'redo'];

export type HomeworkRow = {
  id: number; lesson_id: number | null; student_id: number; task: string;
  assigned_at: string; due_at: string | null;
  submitted_at: string | null; submitted_by: string | null;
  graded_at: string | null; grade: HomeworkGrade | null; graded_by: string | null;
  node_id: number | null;
  /** Which lesson's homework this is, and until when families do not see
   *  it — migration 018. Both NULL on every row older than it. */
  booking_id: number | null;
  held_until: string | null;
  /** The answer key, for the tutor only (migration 022). */
  answer: string | null;
};

/** The columns a caller needs from a generated lesson, whichever table it
 *  is currently stored in. */
export type LessonForStudent = {
  id: number; slug: string; title: string | null; topic: string | null;
  status: string; lesson_at: string | null;
};

/**
 * This student's generated lessons, from the table generation actually
 * writes.
 *
 * This used to read lessons_v2, which no production code has ever written
 * to — generation uses db.ts against the legacy `lessons`. So it answered
 * an empty list for every student, and an empty list reads as "no lessons
 * yet" rather than as a bug. The tutor's student card showed nothing while
 * four finished lessons sat in the database.
 *
 * The legacy table keys a lesson to a student by display NAME, which is not
 * safe to match on: production holds two different students called נוגה on
 * different accounts, so a name join would show one family another's
 * lessons. The booking is the unambiguous link — bookings_v2 carries
 * student_id, and a generated lesson carries the booked time it was
 * generated for.
 *
 * Lessons from before bookings_v2 have no row to join to and are not
 * returned. That is the honest outcome: there is no way to attribute them
 * to a student that is not a guess, and guessing here attributes one
 * child's work to another.
 *
 * See src/lib/server/storage-inventory.ts for why this reads `lessons` and
 * not the table that looks newer.
 */
export function lessonsForStudent(studentId: number): LessonForStudent[] {
  return handle().prepare(`
    SELECT l.id, l.slug, l.title, l.topic, l.status, l.lesson_at
    FROM lessons l
    JOIN bookings_v2 b ON b.start = l.lesson_at
    WHERE b.student_id = ?
    ORDER BY l.lesson_at DESC
  `).all(studentId) as LessonForStudent[];
}

export function addHomework(h: {
  lessonId?: number | null; studentId: number; task: string;
  dueAt?: string | null;
  /** The plan skill this task practises, when the lesson targeted one.
   *  Null means "not evidence about any skill" — see
   *  migration 014. */
  nodeId?: number | null;
  /** The answer key — the tutor's, never shown to the family. */
  answer?: string | null;
  /** One stamp for a whole batch. Lists sort newest first, and a batch whose
   *  tasks each read the clock came out in a different order whenever a
   *  millisecond ticked mid-batch; with a shared stamp, ties fall back to
   *  the order the tasks were written in (homeworkForStudent's id ASC). */
  assignedAt?: string;
}): number {
  /* No submission and no grade: a task starts life as neither finished nor
     judged, which is the only honest state for work nobody has done yet. */
  const info = handle().prepare(`
    INSERT INTO homework (lesson_id, student_id, task, assigned_at, due_at, node_id, answer)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(h.lessonId ?? null, h.studentId, h.task,
         h.assignedAt ?? new Date().toISOString(), h.dueAt ?? null,
         h.nodeId ?? null, h.answer ?? null);
  return Number(info.lastInsertRowid);
}

/**
 * Stage one: the student says they finished it.
 *
 * `by` records who pressed it, because the tutor will often do it on the
 * child's behalf — "she told me she did it" — and that is a different
 * statement from the child saying so themselves.
 *
 * Reversible. A child who taps it by accident has to be able to take it
 * back, and a submission is not a judgement, so nothing is lost by undoing
 * one.
 */
export function setHomeworkSubmitted(
  id: number, submitted: boolean, by: 'student' | 'teacher',
): void {
  handle().prepare(
    `UPDATE homework SET submitted_at = ?, submitted_by = ? WHERE id = ?`
  ).run(submitted ? new Date().toISOString() : null, submitted ? by : null, id);
}

/**
 * Stage two: someone judged it.
 *
 * `by` is 'teacher' today and exists so a machine can fill this in later
 * without a schema change — and so the difference stays visible afterwards.
 * A mark the tutor gave and a mark a program produced are not the same
 * claim, and a parent is entitled to tell them apart.
 *
 * Grading also records the submission if nobody did, because a tutor who
 * has looked at the work has established the stronger fact: it exists.
 */
export function gradeHomework(
  id: number, grade: HomeworkGrade | null, by: 'teacher' | 'auto' = 'teacher',
): void {
  const db = handle();
  const at = new Date().toISOString();
  if (grade === null) {
    db.prepare(`UPDATE homework SET graded_at = NULL, grade = NULL, graded_by = NULL WHERE id = ?`).run(id);
    return;
  }
  db.prepare(`
    UPDATE homework
       SET graded_at = ?, grade = ?, graded_by = ?,
           submitted_at = COALESCE(submitted_at, ?),
           submitted_by = COALESCE(submitted_by, ?)
     WHERE id = ?
  `).run(at, grade, by, at, by === 'auto' ? 'student' : 'teacher', id);
}

export function deleteHomework(id: number): void {
  handle().prepare(`DELETE FROM homework WHERE id = ?`).run(id);
}

/**
 * Homework with both stages resolved.
 *
 * Homework is a Google Doc, so there is no play to derive a submission from:
 * it is submitted by hand, which is what setHomeworkSubmitted exists for.
 */
export function homeworkForStudent(
  studentId: number,
): (HomeworkRow & {
  submitted: boolean; graded: boolean;
  /** The skill it practises, by name. Null when none is linked, or when the
   *  tutor hid that skill from the plan. */
  skill: string | null;
})[] {
  const rows = handle().prepare(`
    SELECT h.*,
           (h.submitted_at IS NOT NULL) AS submitted_flag,
           (SELECT pn.title FROM plan_nodes pn
             WHERE pn.visibility != 'hidden' AND pn.id = h.node_id
           ) AS skill
    FROM homework h
    WHERE h.student_id = ?
    ORDER BY h.assigned_at DESC, h.id ASC
  `).all(studentId) as (HomeworkRow & { submitted_flag: number; skill: string | null })[];

  return rows.map(({ submitted_flag, ...row }) => ({
    ...row,
    submitted: submitted_flag === 1,
    graded: row.graded_at !== null,
  }));
}
