import { handle, inTransaction } from './db.ts';
import { recordGenerated } from './materials.ts';
import type { LearningExperience } from '../learning/model.ts';
import { experienceProblems, renderLearningDocument } from './learning-render.ts';

export function assignLearning(slug: string, studentId: number, hold: {
  bookingId: number | null; heldUntil: string | null; nodeId: number | null;
} = { bookingId: null, heldUntil: null, nodeId: null }): void {
  if (hold.bookingId !== null && !handle().prepare('SELECT 1 FROM bookings_v2 WHERE id=? AND student_id=?').get(hold.bookingId,studentId)) throw new Error('learning booking does not belong to student');
  if (hold.nodeId !== null && !handle().prepare(`SELECT 1 FROM plan_nodes n JOIN plans p ON p.id=n.plan_id
    WHERE n.id=? AND n.kind='skill' AND p.student_id=?`).get(hold.nodeId,studentId)) throw new Error('learning skill does not belong to student');
  // A lesson's ownership never changes when regenerated.
  handle().prepare(`INSERT INTO learning_assignments (lesson_slug,student_id,booking_id,node_id,held_until,practice_state)
    VALUES (?,?,?,?,?,?) ON CONFLICT(lesson_slug) DO NOTHING`)
    .run(slug,studentId,hold.bookingId,hold.nodeId,hold.heldUntil,hold.bookingId && hold.heldUntil ? 'held' : 'assigned');
}

/** A report replaces only unreleased practice. Late filings never retract a child's work. */
export function releaseLearningForReport(bookingId: number, nodeIds: number[], replacements: Array<{
  nodeId: number; experience: LearningExperience;
}>, now = new Date().toISOString()): void {
  inTransaction(() => {
    const rows = handle().prepare(`SELECT lesson_slug,node_id FROM learning_assignments
      WHERE booking_id=? AND practice_state='held' AND held_until>?`).all(bookingId,now) as Array<{lesson_slug:string;node_id:number|null}>;
    for (const row of rows) {
      const matches = !nodeIds.length || (row.node_id !== null && nodeIds.includes(row.node_id));
      const replacement = !matches ? replacements.find(r => !experienceProblems(r.experience).length) : undefined;
      // Unknown/untaught material stays preparation rather than becoming homework.
      const materialSlug = replacement ? `${row.lesson_slug}--practice` : null;
      if (replacement && materialSlug) {
        const plan = {title:replacement.experience.title,gradeContext:'',slides:[],examples:[],homework:[],games:{},learning:replacement.experience};
        recordGenerated(materialSlug,{plan:JSON.stringify(plan),slides:renderLearningDocument(replacement.experience)});
      }
      handle().prepare(`UPDATE learning_assignments SET practice_state=?,practice_material_slug=?,node_id=?,held_until=NULL WHERE lesson_slug=?`)
        .run(matches || replacement ? 'assigned' : 'withdrawn',materialSlug,
          replacement?.nodeId ?? row.node_id,row.lesson_slug);
    }
  });
}
