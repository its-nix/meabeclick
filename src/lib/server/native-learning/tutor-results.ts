/**
 * Tutor view of a student's native game results (grouped by game and round),
 * and the tutor's decision on open answers. Callers must already be the
 * authenticated tutor (requireAuth / apiAuthDenied); the student is chosen by
 * the route's code, and a decision is refused unless the result belongs to
 * that same student.
 */
import { handle } from '../db.ts';
import { nativeResultsForStudent, recordTutorReviewOutcome, type NativeOutcome, type NativeResult } from './results.ts';

export interface TutorRoundResult {
  id: number; roundId: string; prompt: string; outcome: NativeOutcome; attempts: number; seconds: number | null;
  skillTitle: string | null; at: string;
}
export interface TutorGameResults { key: string; bookingId: number | null; gameId: string; gameTitle: string; rounds: TutorRoundResult[] }

/** Latest result per round, grouped by lesson and game, newest game first. No answers, hints or solutions are read. */
export function tutorNativeResults(studentId: number): TutorGameResults[] {
  const db = handle();
  const titles = new Map<string, string>(), prompts = new Map<string, string>();
  for (const row of db.prepare('SELECT booking_id, game_id, content_json FROM native_games WHERE student_id=?').all(studentId)) {
    try {
      const game = JSON.parse(String(row.content_json)) as { title?: string; rounds?: Array<{ id?: string; prompt?: string }> };
      titles.set(`${row.booking_id}/${row.game_id}`, String(game.title ?? ''));
      for (const r of game.rounds ?? []) prompts.set(`${row.booking_id}/${row.game_id}/${r.id}`, String(r.prompt ?? ''));
    } catch { /* an unreadable approved copy shows ids only */ }
  }
  const skills = new Map<string, string>(db.prepare(`SELECT pn.id, pn.title FROM plan_nodes pn JOIN plans p ON p.id=pn.plan_id WHERE p.student_id=?`)
    .all(studentId).map(n => [String(n.id), String(n.title)] as [string, string]));
  const games = new Map<string, { game: TutorGameResults; latest: Map<string, NativeResult> }>();
  for (const r of nativeResultsForStudent(studentId)) {
    const key = `${r.bookingId}/${r.gameId}`;
    const g = games.get(key) ?? { game: { key, bookingId: r.bookingId, gameId: r.gameId, gameTitle: titles.get(key) || r.gameId, rounds: [] }, latest: new Map() };
    g.latest.set(r.roundId, r); games.set(key, g);
  }
  return [...games.values()].map(({ game, latest }) => ({
    ...game,
    rounds: [...latest.values()].map(r => ({ id: r.id, roundId: r.roundId, prompt: prompts.get(`${game.key}/${r.roundId}`) ?? '', outcome: r.outcome,
      attempts: r.attempts, seconds: r.seconds, skillTitle: r.skillNodeId ? skills.get(r.skillNodeId) ?? null : null, at: r.at })),
  })).sort((a, b) => Math.max(...b.rounds.map(r => Date.parse(r.at))) - Math.max(...a.rounds.map(r => Date.parse(r.at))));
}

export class TutorResultError extends Error { status: number; constructor(m: string, s: number) { super(m); this.status = s; } }

/** Records the tutor's final outcome for one awaiting-review result of this student. */
export function decideTutorReview(studentId: number, resultId: unknown, outcome: unknown): NativeResult {
  if (!Number.isInteger(resultId) || typeof outcome !== 'string') throw new TutorResultError('בקשה לא תקינה', 400);
  const row = handle().prepare('SELECT student_id FROM native_results WHERE id=?').get(resultId as number);
  if (!row || Number(row.student_id) !== studentId) throw new TutorResultError('התוצאה לא נמצאה', 404);
  try { return recordTutorReviewOutcome({ resultId: resultId as number, outcome }); }
  catch (e) {
    const m = e instanceof Error ? e.message : '';
    throw new TutorResultError(/awaiting/.test(m) ? 'התוצאה כבר נבדקה' : 'בקשה לא תקינה', /awaiting/.test(m) ? 409 : 400);
  }
}
