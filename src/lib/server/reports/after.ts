/**
 * What a filed lesson report does to that lesson's homework.
 *
 * Spec: docs/superpowers/specs/2026-09-25-homework-from-what-was-taught-design.md
 *
 *   held rows gone already       → nothing   (D4: a late report, or a
 *                                             second filing after a replace)
 *   no skills covered            → release   (D3: a note is not enough to
 *                                             write exercises from)
 *   skills covered, generation ok → replace  with homework from those skills
 *   generation failed, and a covered skill has a ready library lesson
 *                                 → replace  with that lesson's homework
 *   generation failed otherwise   → release, and tell the tutor
 *
 * Runs after fileReport() has committed, and is NOT awaited by the route:
 * a tutor filing a report must not wait minutes for an agent. Explicit
 * topic reports durably withhold broad preparation and require independently
 * assessed scoped practice; only legacy unknown reports retain the fallbacks above.
 */
import { handle, inTransaction } from '../db.ts';
import { addHomework } from '../lessons.ts';
import { latestTopicReport, type TopicReportRevision } from './topics.ts';
import { generateTopicHomework, assessTopicHomework, type TopicPracticeContext, type TopicTask, type TopicHomeworkAssessment } from './topic-homework.ts';
import { enrollmentsForStudent } from '../entities.ts';
import { heldHomeworkForBooking, lessonsForStudent, releaseHeld, replaceHeld } from '../lessons.ts';
import { nodeInPlan, planForEnrollment } from '../plans/store.ts';
import { generateTaughtHomework, type TaughtSkill, type TaughtTask } from '../lesson/homework.ts';
import { libraryPlanFor } from '../library/use.ts';
import { attachTaughtGames } from '../library/report-games.ts';
import { bookingForReport, reportForBooking } from './store.ts';
import { releaseLearningForReport } from '../learning-store.ts';

export type AfterReportOutcome = 'none' | 'released' | 'replaced' | 'replaced-from-library' | 'released-after-failure' | 'withheld';

const FAILED = '⚠️ לא הצלחנו להכין שיעורי בית ממה שנלמד — נשלחו שיעורי הבית שהוכנו מראש';
const FROM_LIBRARY = 'ℹ️ מנוע השיעורים לא זמין, ולכן שיעורי הבית ממה שנלמד נלקחו מהספרייה';
/** The same ceiling generateTaughtHomework keeps. */
const MAX_TASKS = 5;

/**
 * Homework for the covered skills from their ready library lessons, taken
 * in turn so each skill gets some before the ceiling — no engine needed.
 * Every master's homework was written for exactly that skill, with its
 * answer key. Found 2026-10-02: production's Codex was out until 12.10, so
 * every report's generation failed and the child got the homework planned
 * before the lesson instead of homework from what was taught.
 */
export function libraryHomework(templateId: string, skills: TaughtSkill[]): TaughtTask[] {
  const lists = skills.map(s => (libraryPlanFor(templateId, s.key)?.plan.homework ?? [])
    .filter(h => typeof h?.task === 'string' && h.task.trim())
    .map(h => ({ task: h.task, nodeId: s.nodeId, answer: typeof h.answer === 'string' && h.answer.trim() ? h.answer : null })));
  const out: TaughtTask[] = [];
  for (let i = 0; out.length < MAX_TASKS && lists.some(l => i < l.length); i++) {
    for (const l of lists) if (i < l.length && out.length < MAX_TASKS) out.push(l[i]);
  }
  return out;
}

/** Library games for the covered skills, into this booking's lesson (see
 *  library/report-games.ts). On every filing, whatever happens to the
 *  homework, and never in its way: a failure here is only logged. */
async function gamesForWhatWasTaught(bookingId: number, nodeIds: number[], expectedRevision:number): Promise<void> {
  if (!nodeIds.length) return;
  try {
    const booking = bookingForReport(bookingId);
    if (!booking?.enrollment_id) return;
    const plan = planForEnrollment(booking.enrollment_id);
    const lesson = lessonsForStudent(booking.student_id).find(l => l.lesson_at === booking.start);
    if (!plan || !lesson) return;
    const skills = [...new Set(nodeIds)].map(id => nodeInPlan(plan.id, id))
      .filter(n => n?.kind === 'skill').map(n => ({ key: n!.key, nodeId: n!.id }));
    await attachTaughtGames({ lessonSlug: lesson.slug, studentId: booking.student_id, templateId: plan.template_id, skills, canPublish:()=>!latestTopicReport(bookingId) && (reportForBooking(bookingId)?.filing_revision??0)===expectedRevision });
  } catch (err) {
    console.error(`[after-report] games for booking ${bookingId}: ${(err as Error).message}`);
  }
}

export async function afterReport(
  input: { bookingId: number; note: string | null; nodeIds: number[]; reportRevision?: number },
  deps: {
    generate?: typeof generateTaughtHomework;
    notify?: (text: string) => Promise<void> | void;
    now?: string;
    generateTopics?: typeof generateTopicHomework;
    assessTopics?: typeof assessTopicHomework;
  } = {},
): Promise<AfterReportOutcome> {
  const { generate = generateTaughtHomework, notify, now = new Date().toISOString() } = deps;

  const explicit=latestTopicReport(input.bookingId);
  if (explicit) return afterTopicReport(input.bookingId,input.reportRevision ?? explicit.revision,explicit,deps);

  const expectedRevision=input.reportRevision??reportForBooking(input.bookingId)?.filing_revision??0;
  const stillCurrent=()=>!latestTopicReport(input.bookingId) && (reportForBooking(input.bookingId)?.filing_revision??0)===expectedRevision;
  if(!stillCurrent())return 'none';
  await gamesForWhatWasTaught(input.bookingId, input.nodeIds,expectedRevision);
  if(!stillCurrent())return 'none';

  const learningBooking = bookingForReport(input.bookingId);
  const learningPlan = learningBooking?.enrollment_id ? planForEnrollment(learningBooking.enrollment_id) : null;
  const taught = learningPlan ? [...new Set(input.nodeIds)].flatMap(id => {
    const node = nodeInPlan(learningPlan.id,id);
    if (node?.kind !== 'skill') return [];
    const experience = libraryPlanFor(learningPlan.template_id,node.key)?.plan.learning;
    return experience ? [{nodeId:id,experience}] : [];
  }) : [];
  releaseLearningForReport(input.bookingId,input.nodeIds,taught,now);

  if (!heldHomeworkForBooking(input.bookingId, now).length) return 'none';
  if (!input.nodeIds.length) {
    releaseHeld(input.bookingId);
    return 'released';
  }

  const booking = bookingForReport(input.bookingId);
  /* Kept outside the try: the library fallback below needs them. */
  let templateId: string | null = null;
  const skills: TaughtSkill[] = [];
  try {
    if (!booking?.enrollment_id) throw new Error('booking has no enrollment');
    const enrollment = enrollmentsForStudent(booking.student_id).find(e => e.id === booking.enrollment_id);
    const plan = planForEnrollment(booking.enrollment_id);
    if (!enrollment || !plan) throw new Error('no enrollment plan for this booking');
    templateId = plan.template_id;

    for (const id of new Set(input.nodeIds)) {
      const node = nodeInPlan(plan.id, id);
      if (node?.kind === 'skill') skills.push({ key: node.key, title: node.title, nodeId: node.id });
    }
    if (!skills.length) throw new Error('no covered skill resolved');

    const tasks = await generate({
      subject: enrollment.subject, level: enrollment.level ?? '', skills, note: input.note,
    });
    /* False when the held rows went out while generating — another filing,
       a release, or the fallback. What the family already has stands. */
    return inTransaction(()=>stillCurrent() && replaceHeld(input.bookingId, booking.student_id, tasks)) ? 'replaced' : 'none';
  } catch (err) {
    if(!stillCurrent())return 'none';
    console.error(`[after-report] booking ${input.bookingId}: ${(err as Error).message}`);
    const fromLibrary = templateId && booking ? libraryHomework(templateId, skills) : [];
    if (fromLibrary.length && booking) {
      if (!inTransaction(()=>stillCurrent() && replaceHeld(input.bookingId, booking.student_id, fromLibrary))) return 'none';
      await Promise.resolve(notify?.(FROM_LIBRARY)).catch(() => {});
      return 'replaced-from-library';
    }
    releaseHeld(input.bookingId);
    await Promise.resolve(notify?.(FAILED)).catch(() => {});
    return 'released-after-failure';
  }
}


/** Explicit scope has no whole-skill game/library fallback, including on failure. */
async function afterTopicReport(bookingId:number, expected:number, report:TopicReportRevision, deps:{generateTopics?:typeof generateTopicHomework;assessTopics?:typeof assessTopicHomework}):Promise<AfterReportOutcome>{
 if(report.revision!==expected)return 'none';
 if(!report.topics.some(t=>t.covered))return 'withheld';
 const booking=bookingForReport(bookingId); if(!booking)return 'none';
 // A late correction cannot replace or duplicate practice already delivered.
 if(handle().prepare(`SELECT 1 FROM homework WHERE booking_id=? AND withheld_report_revision IS NULL AND (held_until IS NULL OR held_until<=?) LIMIT 1`).get(bookingId,new Date().toISOString()))return 'none';
 const enrollment=enrollmentsForStudent(booking.student_id).find(e=>e.id===booking.enrollment_id);
 const plan=booking.enrollment_id?planForEnrollment(booking.enrollment_id):null;
 const keys=new Set(report.topics.flatMap(t=>t.skillKeys));
 const skills=plan ? [...keys].flatMap(key=>{const n=handle().prepare(`SELECT id,title FROM plan_nodes WHERE plan_id=? AND key=? AND kind='skill'`).get(plan.id,key) as {id:number;title:string}|undefined;return n?[{key,title:n.title,nodeId:n.id}]:[];}) : [];
 const context:TopicPracticeContext={subject:enrollment?.subject??'',level:enrollment?.level??'',note:null,revision:report.revision,source:report.snapshot?{slug:report.snapshot.slug,hash:report.snapshot.hash}:null,topics:report.topics,skills};
 // Use this revision's note, not whichever correction happens to be current later.
 const note=handle().prepare(`SELECT n.note FROM lesson_report_notes n JOIN lesson_reports r ON r.id=n.report_id WHERE r.booking_id=? ORDER BY n.id DESC LIMIT 1`).get(bookingId) as {note:string|null}|undefined;
 context.note=note?.note??null;
 let tasks:TopicTask[]|undefined,assessment:TopicHomeworkAssessment;
 try{
  tasks=await (deps.generateTopics??generateTopicHomework)(context);
  assessment=await (deps.assessTopics??assessTopicHomework)(context,tasks);
 }catch{
  assessment={passed:false,mathematics:false,answerKeys:false,coveredScope:false,exclusions:false,studentVisibility:false,reason:'generation-or-assessment-failed'};
 }
 return inTransaction(()=>{
  if(latestTopicReport(bookingId)?.id!==report.id)return 'none';
  assessment={...assessment,passed:assessment.passed && assessment.studentVisibility===true};
  handle().prepare(`INSERT INTO lesson_report_assessments(revision_id,passed,assessment_json,created_at) VALUES(?,?,?,?)`).run(report.id,Number(assessment.passed),JSON.stringify(assessment),new Date().toISOString());
  if(!tasks?.length||!assessment.passed||!assessment.mathematics||!assessment.answerKeys||!assessment.coveredScope||!assessment.exclusions||assessment.studentVisibility!==true)return 'withheld';
  const allowed=new Set(report.topics.filter(t=>t.covered).map(t=>t.id));
  if(tasks.some(t=>!t.answer?.trim()||!t.topicIds.length||t.topicIds.some(id=>!allowed.has(id))))return 'withheld';
  if(handle().prepare(`SELECT 1 FROM homework WHERE booking_id=? AND withheld_report_revision IS NULL AND (held_until IS NULL OR held_until<=?) LIMIT 1`).get(bookingId,new Date().toISOString()))return 'none';
  const at=new Date().toISOString();
  for(const task of tasks){
   const id=addHomework({studentId:booking.student_id,bookingId,task:task.task,answer:task.answer,nodeId:task.nodeId,assignedAt:at});
   handle().prepare(`UPDATE homework SET topic_provenance=? WHERE id=?`).run(JSON.stringify({reportRevisionId:report.id,revision:report.revision,source:context.source,topicIds:task.topicIds}),id);
  }
  return 'replaced';
 });
}
