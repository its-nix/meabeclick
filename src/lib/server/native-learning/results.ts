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
 hints?: number; revealed?: boolean;
 /** Difficulty level (1-3) of the round as played; null for historical games. */
 difficulty?: number | null;
}
const OUTCOMES: readonly string[] = ['correct', 'assisted', 'incorrect'];
const norm = (s: unknown) => String(s ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
const int = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

function decode(r: Record<string, unknown>): NativeResult {
 return { id: Number(r.id), studentId: Number(r.student_id), bookingId: r.booking_id === null ? null : Number(r.booking_id),
  gameId: String(r.game_id), roundId: String(r.round_id), skillNodeId: r.skill_node_id === null ? null : String(r.skill_node_id),
  outcome: r.outcome as NativeOutcome, attempts: Number(r.attempts), seconds: r.seconds === null ? null : Number(r.seconds), at: String(r.at),
  hints: Number(r.hints ?? 0), revealed: Number(r.revealed ?? 0) === 1,
  difficulty: r.difficulty === null || r.difficulty === undefined ? null : Number(r.difficulty) };
}


/** Server-side cap on recorded attempts per round; the 21st attempt is refused. */
export const ATTEMPT_CAP = 20;
/** An incorrect-only round with no new attempt for this long is treated as given up and settles as needs_review. */
export const ABANDONED_MS = 6 * 60 * 60 * 1000;
const roundKey = (r: { bookingId: number | null; gameId: string; roundId: string }) => `${r.bookingId}/${r.gameId}/${r.roundId}`;

/** Evidence rule. Per round the first decided (correct/assisted) result stands: a first correct attempt without help stays
 * demonstrated and a later wrong retry never downgrades it. A round never decided is represented by its latest incorrect. Awaiting-review rows are not evidence. */
export function decisiveResults<T extends { id: number; bookingId: number | null; gameId: string; roundId: string; outcome: string }>(rows: T[]): T[] {
 const by = new Map<string, T>();
 for (const r of rows) {
  if (r.outcome === 'awaiting-review') continue;
  const key = roundKey(r), cur = by.get(key);
  if (!cur) by.set(key, r);
  else if (cur.outcome === 'incorrect') by.set(key, r);
 }
 return [...by.values()];
}

/** Attempts, help used and whether the round is decided, derived from stored rows only (nothing lives in memory). */
export function nativeRoundState(studentId: number, bookingId: number, gameId: string, roundId: string) {
 const r = handle().prepare(`SELECT COUNT(*) n, COALESCE(SUM(hints),0) h, COALESCE(MAX(revealed),0) v, COALESCE(SUM(outcome IN ('correct','assisted')),0) d
  FROM native_results WHERE student_id=? AND booking_id=? AND game_id=? AND round_id=?`).get(studentId, bookingId, gameId, roundId)!;
 return { attempts: Number(r.n), hints: Number(r.h), revealed: Number(r.v) === 1, decided: Number(r.d) > 0 };
}

/** Persists a hint or a revealed solution on the round's latest undecided result. Help after a decided result is irrelevant and not stored. */
export function recordNativeAssist(input: { studentId: number; bookingId: number; gameId: string; roundId: string; kind: 'hint' | 'solution' }): void {
 const set = input.kind === 'hint' ? 'hints=hints+1' : 'revealed=1';
 handle().prepare(`UPDATE native_results SET ${set} WHERE id=(SELECT id FROM native_results WHERE student_id=? AND booking_id=? AND game_id=? AND round_id=? ORDER BY id DESC LIMIT 1)
  AND outcome NOT IN ('correct','assisted')`).run(input.studentId, input.bookingId, input.gameId, input.roundId);
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
 const difficulty = int(round.difficulty, 1, 3) ? Number(round.difficulty) : null;
 const id = handle().prepare(`INSERT INTO native_results (student_id,booking_id,game_id,round_id,skill_node_id,outcome,attempts,seconds,at,difficulty)
  VALUES (?,?,?,?,?,?,?,?,?,?)`).run(input.studentId, input.bookingId, input.gameId, input.roundId, skill, outcome, input.attempts, input.seconds, at, difficulty).lastInsertRowid;
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
  note: `משחק ${result.gameId}, שאלה ${result.roundId}: ${result.attempts} ניסיונות${result.difficulty ? `, רמה ${result.difficulty}` : ''}`,
  observed_at: result.at, is_demo: false,
 };
}

export interface ProgressSheet { progressIds(): Promise<Set<string>>; appendProgress(rows: WorkspaceRow[]): Promise<void> }
/** One Progress row per (student, booking, round). A round settles when it has a decided result, has used all its attempts, or has sat untouched for ABANDONED_MS;
 * a round still being attempted is left for a later pass, so the append-only Sheet never holds a stale answer. Idempotent by
 * evidence_id, and any earlier per-attempt row of the same round (older syncs) also counts as already appended. */
export async function appendNativeResultsToProgress(input: { sheet: ProgressSheet; studentId: number;
 context: (r: NativeResult) => ProgressContext | null }): Promise<{ appended: number; skipped: number }> {
 const existing = await input.sheet.progressIds();
 const all = nativeResultsForStudent(input.studentId);
 const rows: WorkspaceRow[] = [];
 let skipped = all.length;
 const counts = new Map<string, number>();
 for (const r of all) counts.set(roundKey(r), (counts.get(roundKey(r)) ?? 0) + 1);
 for (const r of decisiveResults(all)) {
  const settled = r.outcome !== 'incorrect' || (counts.get(roundKey(r)) ?? 0) >= ATTEMPT_CAP || Date.now() - Date.parse(r.at) >= ABANDONED_MS;
  const sameRound = all.filter(x => roundKey(x) === roundKey(r));
  const ctx = input.context(r);
  const key = r.skillNodeId ? handle().prepare('SELECT key FROM plan_nodes WHERE id=?').get(Number(r.skillNodeId))?.key : null;
  const row = settled && ctx && key ? progressRowForResult(r, String(key), ctx) : null;
  if (!row || sameRound.some(x => existing.has(`native-result-${x.id}`))) continue;
  rows.push(row);
 }
 if (rows.length) await input.sheet.appendProgress(rows);
 skipped -= rows.length;
 return { appended: rows.length, skipped };
}

/** Parent-evidence plays: one per (booking, game); each round is represented by its decisive result, awaiting-review excluded. */
export function nativePlaysForSkill(studentId: number, nodeId: number) {
 const rows = handle().prepare(`SELECT * FROM native_results WHERE student_id=? AND skill_node_id=? AND outcome!='awaiting-review' ORDER BY at, id`)
  .all(studentId, String(nodeId)).map(decode);
 const games = new Map<string, NativeResult[]>();
 for (const r of decisiveResults(rows)) {
  const k = `${r.bookingId}/${r.gameId}`;
  games.set(k, [...(games.get(k) ?? []), r]);
 }
 return [...games.values()].map(latest => ({ at: latest.map(r => r.at).sort().at(-1) as string, score: latest.filter(r => r.outcome !== 'incorrect').length,
  total: latest.length, hints: latest.filter(r => r.outcome === 'assisted').length }));
}
