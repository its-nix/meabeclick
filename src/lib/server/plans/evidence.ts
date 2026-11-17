/**
 * What a skill actually has behind it.
 *
 * The read half of the link added in #98. Game plays reach a skill through
 * `native_results.skill_node_id`; written work through `homework.node_id`. plans/suggest.ts is pure and consumes this.
 *
 * ## The rule this module exists to enforce
 *
 * **Evidence belongs to the child who produced it.** Both queries are
 * scoped by `student_id`, so one child's score can never land under
 * another child's skill.
 *
 * Ordered oldest-first so a trend reads forwards; suggest.ts sorts again
 * rather than trusting this, because a caller assembling evidence by hand
 * is a caller who can get the order wrong.
 */
import { handle } from '../db.ts';
import { nativePlaysForSkill } from '../native-learning/results.ts';
import type { SkillEvidence, HomeworkEvidence } from './suggest.ts';

export function evidenceForSkill(studentId: number, nodeId: number): SkillEvidence {
  const db = handle();

  /* `submitted` follows the same definition the student's page uses: a row
     is submitted when they said so, or when grading established that the
     work exists. A grade without a submission is the tutor doing it on the
     child's behalf, which setHomeworkSubmitted already models. */
  const homework = db.prepare(`
    SELECT COALESCE(h.graded_at, h.submitted_at, h.assigned_at) AS at,
           h.grade AS grade,
           (h.submitted_at IS NOT NULL OR h.graded_at IS NOT NULL) AS submitted_flag
    FROM homework h
    WHERE h.student_id = ? AND h.node_id = ?
    ORDER BY at
  `).all(studentId, nodeId) as unknown as (Omit<HomeworkEvidence, 'submitted'> & { submitted_flag: number })[];

  return {
    plays: nativePlaysForSkill(studentId, nodeId).sort((a, b) => a.at.localeCompare(b.at)),
    homework: homework.map(({ submitted_flag, ...h }) => ({ ...h, submitted: submitted_flag === 1 })),
  };
}
