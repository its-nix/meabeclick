/** Strict contracts for FRESH generation; historical readers remain permissive. */
import { graphRoundScale, graphPlotPoints } from '../../games/graph-match-plot.ts';
export const QUESTION_BANK_KEYS: Record<string, string> = {
  quiz: 'questions', 'error-hunt': 'rounds', errorHunt: 'rounds', 'two-truths': 'rounds', twoTruths: 'rounds',
  'graph-match': 'rounds', graphMatch: 'rounds', 'number-line': 'rounds', numberLine: 'rounds', 'speed-drill': 'items', speedDrill: 'items',
};
export const POSITION_INDEPENDENT_FEEDBACK = 'כאשר אפשרויות או משפטים עשויים להחליף סדר, המשוב וההסבר (כולל why) מתייחסים לטענה או לביטוי עצמם, בלי להפנות למיקום, למספר סידורי, לאות או לאינדקס של אפשרות או משפט. גם רמז אינו מפנה למיקום אפשרות, והוא מכוון לדרך בלי לחשוף את התשובה. שדות המפתח המספריים answer ו־lieIndex נשארים אינדקסים כרגיל; ההנחיה נוגעת לטקסט המוצג. מותר להפנות למספר צעד בפתרון שסדרו קבוע, כמו errorHunt, כאשר ההפניה מתארת את הצעד הנכון.';
export const GRAPH_MATCH_REFERENCE_CONTRACT = 'ב־graphMatch הגרף main הוא גרף ייחוס שתמיד מוצג מעל האפשרויות; mainLabel הוא כיתוב בלבד ואינו מסתיר אותו. כל עקומות הסבב מוצגות באותו קנה מידה. בדגימות חדשות, עבור N ערכי y, רשת הדגימה היא x_i=i-(N-1)/2 עבור i=0,...,N-1: מרווח יחידה ומרכז באפס. ציינו ב־prompt או ב־mainLabel את טווח x ואת היחידות, וחשבו ובדקו את כל ערכי הפונקציה או הנגזרת לפי רשת זו. המשימה צריכה לבדוק קשר מתמטי שנלמד במיומנויות שהוקצו, כגון הזזה או נגזרת, עם גרף תשובה השונה בבירור מגרף הייחוס. אין לבקש העתקה חזותית של main לאפשרות זהה, גם כשנוסחה מופיעה בשאלה. כל האפשרויות צריכות להיות נבדלות גם לאחר הציור בקנה המידה המשותף. אם אין קשר מתאים ברמה ובמיומנויות שהוקצו, בחרו משחק קיים אחר; אין להניח מצב נוסחה בלבד או יכולת תצוגה שאינה קיימת.';
export const GAME_GENERATION_PROMPT = `במשחקי שאלות (quiz, errorHunt, twoTruths, graphMatch, numberLine, speedDrill) צור בנק של 15 שאלות ייחודיות ומגוונות (לפחות 10), עם id ייחודי לכל שאלה ו-difficulty שהוא 1, 2 או 3. כל שלוש הרמות חייבות להופיע. הרמות משנות מורכבות רק במיומנויות שהוקצו לשיעור; אין להוסיף מיומנות חדשה. אין לשכפל או לרפד שאלות כדי להשלים כמות. משחק רגיל בוחר 10 שאלות; speedDrill נשאר קצוב בזמן. פעילויות לוח שומרות על כמות פריטים טבעית. הביצוע הוא ראיית תרגול בלבד ואינו משנה תכנית למידה.
${POSITION_INDEPENDENT_FEEDBACK}
${GRAPH_MATCH_REFERENCE_CONTRACT}`;
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
const numericCurve = (value: unknown): value is number[] => Array.isArray(value) && value.length >= 2 && Array.from(value).every(v => typeof v === 'number' && Number.isFinite(v));
function generatedGraphProblems(round: Record<string, unknown>, path: string): string[] {
  const {main,options,answer} = round;
  if (!numericCurve(main) || !Array.isArray(options) || options.length < 2 || !Array.from(options).every(curve=>numericCurve(curve) && curve.length === main.length) || typeof answer !== 'number' || !Number.isInteger(answer) || answer < 0 || answer >= options.length) {
    return [`${path}: expected finite matching numeric curves and a valid answer index`];
  }
  const scale = graphRoundScale([main,...options]);
  const plots = options.map(curve=>graphPlotPoints(curve,scale));
  const errors: string[] = [];
  if (plots[answer] === graphPlotPoints(main,scale)) errors.push(`${path}.options.${answer}: correct curve is indistinguishable from the visible reference`);
  const seen = new Map<string,number>();
  plots.forEach((plot,i)=>{
    const previous = seen.get(plot);
    if (previous !== undefined) errors.push(`${path}.options.${i}: indistinguishable options ${previous} and ${i} on the shared plot scale`);
    else seen.set(plot,i);
  });
  return errors;
}
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
    if (template === 'graphMatch' || template === 'graph-match') errors.push(...generatedGraphProblems(q,path));
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
