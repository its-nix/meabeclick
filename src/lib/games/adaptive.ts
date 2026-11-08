/** Current-session practice evidence only. Never changes the assigned skill or learning plan. */
export type Difficulty = 1 | 2 | 3;
export type QuestionMetadata = { id?: string; difficulty?: Difficulty };
export type QuestionEvidence = { questionId: string; difficulty: Difficulty; correct: boolean; hints: number | null };
export const QUESTION_SESSION_LENGTH = 10;
export const MAX_QUESTION_EVIDENCE = 200;
const level = (v: unknown): v is Difficulty => v === 1 || v === 2 || v === 3;
export function isAdaptiveBank(bank: readonly QuestionMetadata[]): boolean {
  return bank.length >= QUESTION_SESSION_LENGTH && bank.every(q => typeof q.id === 'string' && !!q.id.trim() && q.id.length <= 120 && level(q.difficulty))
    && new Set(bank.map(q => q.id!.trim())).size === bank.length;
}
/** Deterministic, pure and limited to the supplied assigned bank. Prefer nearest unseen level,
 * breaking distance ties toward easier practice. Only timed drills repeat after exhaustion. */
export function selectQuestion<T extends QuestionMetadata>(bank: readonly T[], evidence: readonly QuestionEvidence[], options: { timed?: boolean } = {}): T | null {
  if (!isAdaptiveBank(bank) || (!options.timed && evidence.length >= QUESTION_SESSION_LENGTH)) return null;
  const last = evidence.at(-1);
  let desired: Difficulty = last?.difficulty ?? 2;
  if (last && (!last.correct || (last.hints ?? 0) > 0)) desired = Math.max(1, desired - 1) as Difficulty;
  else if (last?.correct && (last.hints ?? 0) === 0) {
    const prior = evidence.at(-2);
    if (prior?.correct && (prior.hints ?? 0) === 0 && prior.difficulty === last.difficulty) desired = Math.min(3, desired + 1) as Difficulty;
  }
  // Timed drills use rounds of the whole bank, so no question repeats before all were used.
  const seen = new Set((options.timed ? evidence.slice(Math.floor(evidence.length / bank.length) * bank.length) : evidence).map(e => e.questionId));
  const available = bank.filter(q => !seen.has(q.id!));
  return available.slice().sort((a,b) => Math.abs(a.difficulty! - desired) - Math.abs(b.difficulty! - desired) || a.difficulty! - b.difficulty!)[0] ?? null;
}
/** Keep the null/zero distinction: null means that question offered no hint. */
export function questionEvidence(question: QuestionMetadata & { hint?: string }, correct: boolean, hints: number): QuestionEvidence {
  return { questionId: question.id!, difficulty: question.difficulty!, correct,
    hints: typeof question.hint === 'string' && question.hint.trim() ? hints : null };
}
export function sanitizeQuestionEvidence(value: unknown): QuestionEvidence[] | null {
  if (!Array.isArray(value)) return null;
  return value.slice(0, MAX_QUESTION_EVIDENCE).flatMap(v => {
    if (!v || typeof v !== 'object' || typeof v.questionId !== 'string' || !v.questionId.trim() || !level(v.difficulty) || typeof v.correct !== 'boolean'
      || !(v.hints === null || (Number.isInteger(v.hints) && v.hints >= 0 && v.hints <= 100))) return [];
    return [{ questionId: v.questionId.slice(0, 120), difficulty: v.difficulty, correct: v.correct, hints: v.hints }];
  });
}

/** SQL NULL for absent/unmeasured input; an actual measured array is JSON. */
export function serializeQuestionEvidence(value: unknown): string | null {
  const evidence = sanitizeQuestionEvidence(value);
  return evidence === null ? null : JSON.stringify(evidence);
}

/** Adaptive options must agree between SSR and hydration: different random orders can
 * attach a correct-looking label to the wrong answer handler on the first question. */
export function shuffleQuestionOptions<T>(items: readonly T[], questionId: string): T[] {
  let seed = 2166136261;
  for (const char of questionId) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = Math.floor((seed / 4294967296) * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
