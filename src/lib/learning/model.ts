/** Presenter guidance a deck slide may carry, and the one numeric syntax a learner answer may use. */
export interface PresenterNotes {
  explanation: string;
  ask: string;
  expectedAnswer: string;
  ifStuck: string;
  minutes?: number;
  misconception?: string;
  transition?: string;
  sources?: string[];
}

/** Only the deliberately supported numeric syntax. No evaluation of expressions. */
export function numericAnswer(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string' || raw.length > 80) return null;
  const s = raw.trim().replace(/[−–]/g, '-').replace(/,/g, '.').replace(/\s/g, '')
    .replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x660));
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:\/[+-]?(?:\d+(?:\.\d*)?|\.\d+))?$/.test(s)) return null;
  const [a, b] = s.split('/').map(Number);
  const value = b === undefined ? a : a / b;
  return Number.isFinite(value) ? value : null;
}
