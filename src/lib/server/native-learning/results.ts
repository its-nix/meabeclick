/**
 * Native game results (spec 2c): the runtime store is `native_results`, the
 * Sheet's Progress tab receives appended rows, and parent evidence reads here.
 *
 * Objective-to-skill trace (2026-11-17): a round carries `objectiveId`, an id
 * local to one bundle (`bundle.objectives[{id,title}]`). Nothing links it to
 * `plan_nodes`: plan nodes have a stable `key` and a `title`, and the bundle
 * is generated from a brief that only carries titles. So the node is resolved
 * on the server at record time by an exact key or exact title match against
 * the student's own visible skill nodes (same rule as assertSkillForStudent).
 * No match or an ambiguous match stores NULL: honest "no plan skill" rather
 * than a guess. The browser never supplies a skill.
 */
import { handle } from '../db.ts';
import type { WorkspaceRow } from '../../learning/workspace.ts';

export type NativeOutcome = 'correct' | 'assisted' | 'incorrect' | 'awaiting-review';
export type FinalOutcome = Exclude<NativeOutcome, 'awaiting-review'>;
export interface NativeResult {
 id: number; studentId: number; bookingId: number | null; gameId: string; roundId: string;
 skillNodeId: string | null; outcome: NativeOutcome; attempts: number; seconds: number | null; at: string;
}
const OUTCOMES: readonly string[] = ['correct', 'assisted', 'incorrect'];
const norm = (s: unknown) => String(s ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
const int = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

function decode(r: Record<string, unknown>): NativeResult {
 return { id: Number(r.id), studentId: Number(r.student_id), bookingId: r.booking_id === null ? null : Number(r.booking_id),
  gameId: String(r.game_id), roundId: String(r.round_id), skillNodeId: r.skill_node_id === null ? null : String(r.skill_node_id),
  outcome: r.outcome as NativeOutcome, attempts: Number(r.attempts), seconds: r.seconds === null ? null : Number(r.seconds), at: String(r.at) };
}

/** Finds the round in the approved copy (native_games), never in browser input. */
function approvedRound(studentId: number, bookingId: number, gameId: string, roundId: string) {
 const rows = handle().prepare(`SELECT content_json FROM native_games WHERE student_id=? AND booking_id=? AND game_id=?`)
  .all(studentId, bookingId, gameId);
 for (const row of rows) {
  const game = JSON.parse(String(row.content_json)) as { rounds?: Array<Record<string, unknown>> };
  const round = game.rounds?.find(r => r.id === roundId);
  if (round) return round;
 }
 return null;
}

/** Resolves a bundle objective to this student's plan skill node id, or null. */
export function resolveSkillNode(studentId: number, bookingId: number, objectiveId: string): string | null {
 const db = handle();
 const job = db.prepare(`SELECT bundle, snapshot FROM native_lesson_jobs WHERE booking_id=? AND student_id=?`).get(bookingId, studentId);
 let title = '';
 let enrollmentId: number | null = null;
 if (job) {
  try {
   const bundle = JSON.parse(String(job.bundle)) as { objectives?: Array<{ id: string; title: string }> };
   title = norm(bundle.objectives?.find(o => o.id === objectiveId)?.title);
   enrollmentId = (JSON.parse(String(job.snapshot)) as { enrollmentId?: number | null }).enrollmentId ?? null;
  } catch { /* an unreadable bundle resolves to no skill */ }
 }
 const nodes = db.prepare(`SELECT pn.id, pn.key, pn.title, p.enrollment_id FROM plan_nodes pn JOIN plans p ON p.id=pn.plan_id
  WHERE p.student_id=? AND pn.kind='skill' AND pn.visibility!='hidden'`).all(studentId)
  .filter(n => enrollmentId === null || n.enrollment_id === enrollmentId);
 const byKey = nodes.filter(n => n.key === objectiveId);
 const matches = byKey.length ? byKey : title ? nodes.filter(n => norm(n.title) === title) : [];
 return matches.length === 1 ? String(matches[0].id) : null;
}

export function recordNativeResult(input: { studentId: number; bookingId: number; gameId: string; roundId: string;
 outcome: string; attempts: number; seconds: number | null }): NativeResult {
 if (!int(input.attempts, 1, 1000)) throw new Error('native result attempts invalid');
 if (input.seconds !== null && !int(input.seconds, 0, 86_400)) throw new Error('native result seconds invalid');
 const round = approvedRound(input.studentId, input.bookingId, input.gameId, input.roundId);
 if (!round) throw new Error('native result round is not in an approved game for this student');
 const review = round.grading === 'tutor-review';
 // A tutor-review round cannot self-report a final outcome; a checked round cannot wait for review.
 const outcome: NativeOutcome = review ? 'awaiting-review' : (OUTCOMES.includes(input.outcome) ? input.outcome as FinalOutcome : (() => { throw new Error('native result outcome invalid'); })());
 const skill = resolveSkillNode(input.studentId, input.bookingId, String(round.objectiveId ?? ''));
 const at = new Date().toISOString();
 const id = handle().prepare(`INSERT INTO native_results (student_id,booking_id,game_id,round_id,skill_node_id,outcome,attempts,seconds,at)
  VALUES (?,?,?,?,?,?,?,?,?)`).run(input.studentId, input.bookingId, input.gameId, input.roundId, skill, outcome, input.attempts, input.seconds, at).lastInsertRowid;
 return decode(handle().prepare('SELECT * FROM native_results WHERE id=?').get(id)!);
}

/** The tutor's decision on an open answer. Only an awaiting-review row can change. */
export function recordTutorReviewOutcome(input: { resultId: number; outcome: string }): NativeResult {
 if (!OUTCOMES.includes(input.outcome)) throw new Error('native review outcome invalid');
 const r = handle().prepare(`UPDATE native_results SET outcome=? WHERE id=? AND outcome='awaiting-review'`).run(input.outcome, input.resultId);
 if (!r.changes) throw new Error('native result is not awaiting review');
 return decode(handle().prepare('SELECT * FROM native_results WHERE id=?').get(input.resultId)!);
}

export function nativeResultsForStudent(studentId: number): NativeResult[] {
 return handle().prepare('SELECT * FROM native_results WHERE student_id=? ORDER BY at, id').all(studentId).map(decode);
}

/* ---- Progress tab ---- */
export interface ProgressContext { studentRef: string; lessonId: string; assignmentId: string }
/** Awaiting-review is not evidence yet; it is appended once the tutor decides. */
export function progressRowForResult(result: NativeResult, skillKey: string, ctx: ProgressContext): WorkspaceRow | null {
 if (result.outcome === 'awaiting-review') return null;
 const independent = result.outcome === 'correct' && result.attempts === 1;
 return {
  evidence_id: `native-result-${result.id}`, student_id: ctx.studentRef, skill: skillKey, lesson_id: ctx.lessonId,
  assignment_id: ctx.assignmentId,
  outcome: independent ? 'demonstrated' : result.outcome === 'incorrect' ? 'needs_review' : 'practising',
  support: independent ? 'independent' : result.outcome === 'incorrect' ? 'none' : 'guided',
  evidence_type: 'game', evidence_url: '',
  note: `משחק ${result.gameId}, שאלה ${result.roundId}: ${result.attempts} ניסיונות`,
  observed_at: result.at, is_demo: false,
 };
}

export interface ProgressSheet { progressIds(): Promise<Set<string>>; appendProgress(rows: WorkspaceRow[]): Promise<void> }
/** Idempotent: rows whose evidence_id is already in the Sheet are skipped; unmapped results are left for the next sync. */
export async function appendNativeResultsToProgress(input: { sheet: ProgressSheet; studentId: number;
 context: (r: NativeResult) => ProgressContext | null }): Promise<{ appended: number; skipped: number }> {
 const existing = await input.sheet.progressIds();
 const rows: WorkspaceRow[] = [];
 let skipped = 0;
 for (const r of nativeResultsForStudent(input.studentId)) {
  const ctx = input.context(r);
  const key = r.skillNodeId ? handle().prepare('SELECT key FROM plan_nodes WHERE id=?').get(Number(r.skillNodeId))?.key : null;
  const row = ctx && key ? progressRowForResult(r, String(key), ctx) : null;
  if (!row || existing.has(String(row.evidence_id))) { skipped++; continue; }
  rows.push(row);
 }
 if (rows.length) await input.sheet.appendProgress(rows);
 return { appended: rows.length, skipped };
}

/** Parent-evidence plays: one per (booking, game), latest attempt per round, awaiting-review excluded. */
export function nativePlaysForSkill(studentId: number, nodeId: number) {
 const rows = handle().prepare(`SELECT * FROM native_results WHERE student_id=? AND skill_node_id=? AND outcome!='awaiting-review' ORDER BY at, id`)
  .all(studentId, String(nodeId)).map(decode);
 const games = new Map<string, Map<string, NativeResult>>();
 for (const r of rows) {
  const g = games.get(`${r.bookingId}/${r.gameId}`) ?? new Map();
  g.set(r.roundId, r); games.set(`${r.bookingId}/${r.gameId}`, g);
 }
 return [...games.values()].map(g => {
  const latest = [...g.values()];
  return { at: latest.map(r => r.at).sort().at(-1) as string, score: latest.filter(r => r.outcome !== 'incorrect').length,
   total: latest.length, hints: latest.filter(r => r.outcome === 'assisted').length };
 });
}
