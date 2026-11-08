/** Strict contracts for FRESH generation; historical readers remain permissive. */
export const QUESTION_BANK_KEYS: Record<string, string> = {
  quiz: 'questions', 'error-hunt': 'rounds', errorHunt: 'rounds', 'two-truths': 'rounds', twoTruths: 'rounds',
  'graph-match': 'rounds', graphMatch: 'rounds', 'number-line': 'rounds', numberLine: 'rounds', 'speed-drill': 'items', speedDrill: 'items',
};
export const GAME_GENERATION_PROMPT = `במשחקי שאלות (quiz, errorHunt, twoTruths, graphMatch, numberLine, speedDrill) צור בנק של 15 שאלות ייחודיות ומגוונות (לפחות 10), עם id ייחודי לכל שאלה ו-difficulty שהוא 1, 2 או 3. כל שלוש הרמות חייבות להופיע. הרמות משנות מורכבות רק במיומנויות שהוקצו לשיעור; אין להוסיף מיומנות חדשה. אין לשכפל או לרפד שאלות כדי להשלים כמות. משחק רגיל בוחר 10 שאלות; speedDrill נשאר קצוב בזמן. פעילויות לוח שומרות על כמות פריטים טבעית. הביצוע הוא ראיית תרגול בלבד ואינו משנה תכנית למידה.`;
/** Augment one game's existing JSON schema without mutating it. */
export function gameGenerationSchema<T>(template: string, schema: T): T {
  const key = QUESTION_BANK_KEYS[template];
  if (!key) return structuredClone(schema);
  const result = structuredClone(schema) as Record<string, any>;
  const list = result.properties?.[key];
  if (list?.items?.properties) {
    list.minItems = 10;
    list.maxItems = 40;
    list.items.properties.id = { type: 'string', minLength: 1, maxLength: 120 };
    list.items.properties.difficulty = { type: 'integer', enum: [1, 2, 3] };
    list.items.required = [...new Set([...(list.items.required ?? []), 'id', 'difficulty'])];
  }
  return result as T;
}
const canonical = (v: unknown): string => typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').toLowerCase() : Array.isArray(v) ? JSON.stringify(v.map(canonical)) : JSON.stringify(v);
export function validateGeneratedGameBank(template: string, body: unknown): string[] {
  const key = QUESTION_BANK_KEYS[template];
  if (!key) return [];
  const list = body && typeof body === 'object' ? (body as Record<string, unknown>)[key] : null;
  if (!Array.isArray(list)) return [`${template}.${key}: missing question bank`];
  const errors: string[] = [];
  if (list.length < 10 || list.length > 40) errors.push(`${template}.${key}: expected 10–40 unique questions (recommended 15)`);
  const ids = new Set<string>(), prompts = new Set<string>(), levels = new Set<number>();
  list.forEach((q, i) => {
    const path = `${template}.${key}.${i}`;
    if (!q || typeof q !== 'object') { errors.push(`${path}: invalid question`); return; }
    if (typeof q.id !== 'string' || !q.id.trim() || q.id.length > 120 || ids.has(q.id.trim())) errors.push(`${path}.id: expected unique nonempty id`);
    else ids.add(q.id.trim());
    if (![1,2,3].includes(q.difficulty)) errors.push(`${path}.difficulty: expected 1, 2 or 3`);
    else levels.add(q.difficulty);
    // Identity ignores the answer explanation and metadata: changing these cannot pad a bank.
    const prompt = canonical(q.q ?? q.problem ?? (Array.isArray(q.statements) ? q.statements.map(canonical).sort() : q.statements) ?? (q.main ? [q.prompt, q.main] : q.target));
    if (prompt === undefined || prompts.has(prompt)) errors.push(`${path}: duplicate or missing question prompt`);
    else prompts.add(prompt);
  });
  if (levels.size !== 3) errors.push(`${template}.${key}: include all three difficulty levels within the assigned skills`);
  return errors;
}
