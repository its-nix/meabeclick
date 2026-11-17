/**
 * Which skill a lesson is for.
 *
 * From docs/superpowers/specs/2026-09-21-progress-from-evidence-design.md
 * §2 and §6 step 3. The evidence already exists — native_results has the
 * outcome per round; homework has the task and whether it was done — and
 * the skill link is what makes it readable by the suggestion rules in §3.2.
 *
 * ## The model is never asked for an id
 *
 * The generator is told a skill's TITLE, as part of what to teach. The node
 * id stays here and is what the rows are tagged with. Asking a model to
 * echo an id invites one that does not exist, or one belonging to another
 * student's plan, and a wrong link is worse than no link: it becomes
 * evidence about a skill nobody practised. The pipeline already knows which
 * skill it asked about, so this is a fact rather than an output to trust.
 *
 * The model supplies content, never identity.
 */
import { getStudentByCode, enrollmentsForStudent } from '../entities.ts';
import { planForEnrollment, planData, lastLessonAt, nodeInPlan } from '../plans/store.ts';
import { buildTree, nextTargetSkill } from '../plans/view.ts';
import { handle } from '../db.ts';

export interface TargetSkill {
  id: number;
  title: string;
  /** The template's own key for the skill, and the template it came from:
   *  what the prepared library is keyed by (library/use.ts). */
  key: string;
  templateId: string;
}

/**
 * The skill this student's next lesson in this subject should target, or
 * null.
 *
 * Null is the ordinary case today and must stay cheap: almost no student
 * has a plan, and generation has to carry on exactly as it did before,
 * producing a lesson with no evidence link rather than refusing.
 *
 * Scoped to the SUBJECT. A student can be enrolled in maths and physics
 * with a plan for each, and tagging a physics lesson with a maths skill
 * would put evidence under a skill the child never practised.
 */
export function targetSkillFor(studentCode: string | null, subject: string): TargetSkill | null {
  if (!studentCode) return null;
  const student = getStudentByCode(studentCode);
  if (!student) return null;

  const enrollment = enrollmentsForStudent(student.id).find(e => e.subject === subject);
  if (!enrollment) return null;

  const plan = planForEnrollment(enrollment.id);
  if (!plan) return null;

  const { nodes, prereqs, events } = planData(plan.id);
  const next = nextTargetSkill(buildTree(nodes, prereqs, events, lastLessonAt(student.id)));
  if (!next) return null;
  const node = nodeInPlan(plan.id, next.id);
  return node ? { ...next, key: node.key, templateId: plan.template_id } : null;
}
