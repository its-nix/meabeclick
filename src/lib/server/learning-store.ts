import { handle, inTransaction } from './db.ts';
import { latestPublished, recordGenerated } from './materials.ts';
import { getStudentById } from './entities.ts';
import { resolveFamilyAccess } from './family.ts';
import { gradeLearningCheck, type LearningExperience } from '../learning/model.ts';
import { experienceProblems, learningFingerprint, renderLearningDocument } from './learning-render.ts';
import type { LearningProgress } from '../learning/runtime.ts';
import type {LessonPlan} from './lesson/prep.ts';
import {homeworkExperience} from './teaching-display.ts';

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

function releaseDueLearning(now: string): void {
  handle().prepare(`UPDATE learning_assignments SET practice_state='assigned',held_until=NULL
    WHERE practice_state='held' AND held_until<=? AND NOT EXISTS (
      SELECT 1 FROM bookings_v2 b WHERE b.id=learning_assignments.booking_id AND b.status='cancelled'
    )`).run(now);
}
export function homeworkReleased(slug:string):boolean{
 releaseDueLearning(new Date().toISOString());
 return !!handle().prepare("SELECT 1 FROM learning_assignments WHERE lesson_slug=? AND practice_state='assigned'").get(slug);
}

/** Replacement practice has its own append-only editing history. */
export function learningMaterialSlug(slug: string): string {
  const row = handle().prepare('SELECT practice_material_slug FROM learning_assignments WHERE lesson_slug=?').get(slug) as {practice_material_slug:string|null}|undefined;
  return row?.practice_material_slug ?? slug;
}

export function assignedExperience(slug: string,mode?:'homework'): ReturnType<typeof publishedExperience> {
  return publishedExperience(learningMaterialSlug(slug),mode);
}

export function publishedExperience(slug: string,mode?:'homework'): { experience: LearningExperience; fingerprint: string;plan:LessonPlan } | null {
  const row = latestPublished(slug, 'plan');
  if (!row) return null;
  try {
    const plan = JSON.parse(row.content) as LessonPlan;
    if((plan as unknown as {kind?:string}).kind==='taught-homework-v2'){
      if(mode!=='homework')return null;
      const experience=homeworkExperience(plan);
      if(experienceProblems(experience,{mode:'homework'}).length)return null;
      return {experience,fingerprint:learningFingerprint(experience),plan};
    }
    if(!plan.learning||experienceProblems(plan.learning).length)return null;
    if(mode==='homework'&&!plan.teaching)return null;
    const experience=mode==='homework'?homeworkExperience(plan):plan.learning;
    if(experienceProblems(experience,{mode}).length)return null;
    return {experience, fingerprint:learningFingerprint(experience),plan};
  } catch { return null; }
}

export function learningAccess(slug: string, locals: App.Locals): { studentId: number; code: string } | null {
  const row = handle().prepare('SELECT student_id FROM learning_assignments WHERE lesson_slug = ?').get(slug) as { student_id: number } | undefined;
  if (!row) return null;
  const student = getStudentById(row.student_id);
  if (!student) return null;
  if (locals.authenticated) return { studentId: student.id, code: student.code };
  const access = locals.family ? resolveFamilyAccess(locals.family) : null;
  return access?.students.some(s => s.id === student.id) ? { studentId: student.id, code: student.code } : null;
}

export function learningProgress(studentId: number, slug: string, fingerprint: string): Record<string, LearningProgress> {
  const rows = handle().prepare(`SELECT p.scene_id,p.attempts,p.hints,p.solved,p.visited,EXISTS(SELECT 1 FROM learning_events e WHERE e.student_id=p.student_id AND e.lesson_slug=p.lesson_slug AND e.fingerprint=p.fingerprint AND e.scene_id=p.scene_id AND e.action='solution') AS revealed FROM learning_progress p WHERE student_id=? AND lesson_slug=? AND fingerprint=?`)
    .all(studentId, slug, fingerprint) as Array<{ scene_id: string; attempts: number; hints: number; solved: number; visited: number;revealed:number }>;
  return Object.fromEntries(rows.map(r => [r.scene_id, { attempts: r.attempts, hints: r.hints, solved: !!r.solved, visited: !!r.visited,...(r.revealed?{revealed:true}:{}) }]));
}

export function recordLearning(input: {
  id: string; studentId: number; slug: string; fingerprint: string; sceneId: string;
  action: 'answer' | 'hint' | 'visit' | 'solution'; value?: unknown; experience: LearningExperience;
}): { correct: boolean | null; feedback: string;solution?:string; progress: Record<string, LearningProgress> } {
  const { studentId, slug, fingerprint, sceneId, action, experience } = input;
  const scene = experience.scenes.find(s => s.id === sceneId);
  if (!scene) throw new Error('unknown scene');
  if (action!=='visit' && !scene.check) throw new Error('scene has no question');
  return inTransaction(() => {
    const previous = handle().prepare('SELECT student_id, lesson_slug, fingerprint, scene_id, action, correct FROM learning_events WHERE id=?').get(input.id) as {
      student_id: number; lesson_slug: string; fingerprint: string; scene_id: string; action: string; correct: number | null;
    } | undefined;
    if (previous && (previous.student_id !== studentId || previous.lesson_slug !== slug || previous.fingerprint !== fingerprint || previous.scene_id !== sceneId || previous.action !== action)) throw new Error('event conflict');
    if(action==='solution'&&(!scene.check?.solution||!learningProgress(studentId,slug,fingerprint)[sceneId]?.attempts))throw new Error('an attempt is required before a solution');
    const correct = previous ? previous.correct === null ? null : !!previous.correct : action === 'answer' ? gradeLearningCheck(scene.check!, input.value) : null;
    if (!previous) {
      const now = new Date().toISOString();
      handle().prepare('INSERT INTO learning_events (id,student_id,lesson_slug,fingerprint,scene_id,action,correct,created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(input.id, studentId, slug, fingerprint, sceneId, action, correct === null ? null : Number(correct), now);
      handle().prepare(`INSERT INTO learning_progress (student_id,lesson_slug,fingerprint,scene_id,attempts,hints,solved,visited,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(student_id,lesson_slug,fingerprint,scene_id) DO UPDATE SET
        attempts=learning_progress.attempts+excluded.attempts,
        hints=MIN(?,learning_progress.hints+excluded.hints),
        solved=MAX(learning_progress.solved,excluded.solved),
        visited=MAX(learning_progress.visited,excluded.visited),updated_at=excluded.updated_at`)
        .run(studentId, slug, fingerprint, sceneId, action === 'answer' ? 1 : 0, action === 'hint' ? 1 : 0, correct ? 1 : 0, 1, now, scene.check?.hints.length ?? 0);
    }
    return { correct, feedback: correct === null ? '' : correct ? scene.check!.success : scene.check!.retry,...(action==='solution'?{solution:scene.check!.solution}:{}), progress: learningProgress(studentId, slug, fingerprint) };
  });
}

export function learningForStudent(studentId: number, mode: 'practice'|'preparation' = 'practice', now = new Date().toISOString()): Array<{ slug: string; title: string; url: string; solved: number; total: number }> {
  releaseDueLearning(now);
  const assignments = handle().prepare(`SELECT lesson_slug FROM learning_assignments a WHERE student_id=? AND practice_state=?
    AND NOT EXISTS (SELECT 1 FROM bookings_v2 b WHERE b.id=a.booking_id AND b.status='cancelled')
    ORDER BY rowid DESC LIMIT 20`).all(studentId,mode==='practice'?'assigned':'held') as { lesson_slug: string }[];
  return assignments.flatMap(a => {
    const normal=mode==='practice' ? assignedExperience(a.lesson_slug) : publishedExperience(a.lesson_slug);
    const lesson=normal??(mode==='practice'?assignedExperience(a.lesson_slug,'homework'):null);
    if (!lesson) return [];
    const progress = learningProgress(studentId, a.lesson_slug, lesson.fingerprint);
    return [{ slug: a.lesson_slug, title: lesson.experience.title, url: `/app/learn/${encodeURIComponent(a.lesson_slug)}${normal?'':'/homework'}`, solved: lesson.experience.scenes.filter(s => s.check && progress[s.id]?.solved).length, total: lesson.experience.scenes.filter(s => s.check).length }];
  });
}
