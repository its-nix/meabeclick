/** A versioned lesson scene contract. Mathematics is data, never generated code. */
export type VisualKind = 'quadratic' | 'linear' | 'number-line' | 'balance' | 'steps' | 'fraction' | 'geometry' | 'data-bars' | 'normal' | 'normal-school';
export interface LearningFrame {
  caption: string;
  tex: string;
  /** quadratic: [a,h,k]; linear: [m,b]; number-line: [value]; balance: [coefficient,constant,total]. */
  values: number[];
}
export interface LearningCheck {
  kind: 'choice' | 'number' | 'graph-target';
  question: string;
  options: string[];
  /** Index, numeric answer, or graph parameters. Kept on the server for assigned lessons. */
  answer: number | number[];
  hints: string[];
  success: string;
  retry: string;
  /** Private until an authorised solution request after an attempt. */
  solution?: string;
}
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
export interface LearningScene {
  /** Open reasoning is saved locally for tutor review, never marked auto-correct. */
  tutorReview?: boolean;
  id: string;
  phase: 'discover' | 'explore' | 'practice' | 'challenge' | 'reflect';
  title: string;
  prompt: string;
  takeaway: string;
  visual: VisualKind;
  xDomain: number[];
  yDomain: number[];
  frames: LearningFrame[];
  check?: LearningCheck | null;
  /** Teacher-only. Optional for stored lessons from before notes were generated. */
  presenterNotes?: PresenterNotes;
}
export interface LearningExperience {
  version: 1;
  title: string;
  subtitle: string;
  objective: string;
  minutes: number;
  scenes: LearningScene[];
}

export const PHASE_LABELS = {
  discover: 'מגלים', explore: 'מנסים', practice: 'מתרגלים', challenge: 'אתגר', reflect: 'מה לקחנו',
} as const;

export function visualValue(kind: VisualKind, values: number[], x: number): number {
  if (kind === 'quadratic') return values[0] * (x - values[1]) ** 2 + values[2];
  if (kind === 'linear') return values[0] * x + values[1];
  return values[0];
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

export function gradeLearningCheck(check: LearningCheck, input: unknown): boolean {
  if (check.kind === 'graph-target') {
    return Array.isArray(check.answer) && Array.isArray(input) && input.length === check.answer.length
      && check.answer.every((n, i) => typeof input[i] === 'number' && Number.isFinite(input[i]) && Math.abs(input[i] - n) < 0.025);
  }
  const value = numericAnswer(input);
  return typeof check.answer === 'number' && value !== null
    && (check.kind === 'choice' ? Number.isInteger(value) && value === check.answer : Math.abs(value - check.answer) < 1e-7);
}

/** Shape and engine semantics. Formula compilation is checked separately by the renderer. */
export function learningProblems(raw: unknown, options: { requirePresenterNotes?: boolean;mode?:'homework' } = {}): string[] {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['חוויית הלמידה אינה אובייקט'];
  const e = raw as LearningExperience;
  const text = (v: unknown, max = 400) => typeof v === 'string' && !!v.trim() && v.length <= max;
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1000;
  if (e.version !== 1) errors.push('גרסת חוויית למידה לא נתמכת');
  if (!text(e.title, 120) || !text(e.subtitle, 220) || !text(e.objective, 220)) errors.push('חסרים כותרת או יעד למידה');
  if (!finite(e.minutes) || e.minutes < 1 || e.minutes > 90) errors.push('משך למידה לא תקין');
  if (!Array.isArray(e.scenes) || e.scenes.length < (options.mode==='homework'?1:4) || e.scenes.length > 12) return [...errors, 'מספר סצנות לא תקין'];
  if (options.mode!=='homework'&&(e.scenes[0]?.phase !== 'discover' || e.scenes.at(-1)?.phase !== 'reflect')) errors.push('השיעור צריך להתחיל בגילוי ולהסתיים בסיכום');
  const ids = new Set<string>();
  let checks = 0;
  const dimensions: Record<VisualKind, number> = { quadratic: 3, linear: 2, 'number-line': 1, balance: 3, steps: 0, fraction:3,geometry:4,'data-bars':4,normal:4,'normal-school':4 };
  for (const s of e.scenes) {
    if (!s || typeof s !== 'object') { errors.push('סצנה לא תקינה'); continue; }
    if (!text(s.id, 60) || !/^[a-z0-9-]+$/.test(s.id) || ids.has(s.id)) errors.push('מזהי הסצנות חייבים להיות ייחודיים');
    ids.add(s.id);
    if (options.requirePresenterNotes || s.presenterNotes !== undefined) {
      const notes = s.presenterNotes;
      if (!notes || typeof notes !== 'object' || Array.isArray(notes)
        || !text(notes.explanation, 700) || !text(notes.ask, 350)
        || !text(notes.expectedAnswer, 500) || !text(notes.ifStuck, 500)) errors.push(`חסרות הערות למורה או שהן ארוכות מדי: ${s.id}`);
      if(notes&&typeof notes==='object'){
        if(notes.minutes!==undefined&&(!finite(notes.minutes)||notes.minutes<=0||notes.minutes>135))errors.push(`זמן הערות לא תקין: ${s.id}`);
        if((notes.misconception!==undefined&&!text(notes.misconception,500))||(notes.transition!==undefined&&!text(notes.transition,400))||(notes.sources!==undefined&&(!Array.isArray(notes.sources)||notes.sources.length>4||!notes.sources.every(v=>text(v,100)))))errors.push(`הערות מורחבות לא תקינות: ${s.id}`);
      }

    }
    if (!Object.hasOwn(PHASE_LABELS, s.phase) || !text(s.title, 100) || !text(s.prompt, 280) || !text(s.takeaway, 280)) errors.push(`טקסט או שלב לא תקין: ${s.id}`);
    if (!Object.hasOwn(dimensions, s.visual)) { errors.push(`סוג המחשה לא נתמך: ${s.id}`); continue; }
    for (const domain of [s.xDomain, s.yDomain]) {
      if (!Array.isArray(domain) || domain.length !== 2 || !domain.every(finite) || domain[0] >= domain[1] || domain[1] - domain[0] > 100) errors.push(`טווח צירים לא תקין: ${s.id}`);
    }
    if (!Array.isArray(s.frames) || s.frames.length < 1 || s.frames.length > 6) { errors.push(`חסרים שלבי המחשה: ${s.id}`); continue; }
    for (const f of s.frames) {
      if (!f || !text(f.caption, 180) || !text(f.tex, 600) || !Array.isArray(f.values) || f.values.length !== dimensions[s.visual] || !f.values.every(finite)) {
        errors.push(`שלב המחשה לא תקין: ${s.id}`); continue;
      }
      if (s.visual === 'quadratic' && Math.abs(f.values[0]) < 0.1) errors.push(`פרבולה חייבת מקדם שונה מאפס: ${s.id}`);
      if (s.visual === 'balance' && (!Number.isInteger(f.values[0]) || f.values[0] < 1 || f.values[0] > 6 || f.values[1] < 0 || f.values[2] < 0 || f.values[1] > 12 || f.values[2] > 40)) errors.push(`המאזניים מחוץ לטווח הנתמך: ${s.id}`);
      if (s.visual === 'number-line' && (f.values[0] < s.xDomain?.[0] || f.values[0] > s.xDomain?.[1])) errors.push(`ערך מחוץ לציר: ${s.id}`);
      const v=f.values;
      if(s.visual==='fraction'&&(!v.every(Number.isInteger)||v[0]<0||v[0]>v[1]||v[1]<1||v[1]>12||v[2]<1||v[2]>4||v[1]*v[2]>48))errors.push(`חלוקת שבר לא תקינה: ${s.id}`);
      if(s.visual==='geometry'){
        const [shape,a,b,h]=v,positive=(n:number)=>n>0&&n<=20;
        if(!Number.isInteger(shape)||shape<1||shape>7||shape!==s.frames[0].values[0]||!positive(a)||([1,2,4,7].includes(shape)?!positive(b):b!==0)||([4,5,6,7].includes(shape)?!positive(h):h!==0))errors.push(`ממדי צורה לא תקינים: ${s.id}`);
      }
      if(s.visual==='data-bars'&&(!v.every(n=>Number.isInteger(n)&&n>=0&&n<=20)||v.every(n=>n===0)))errors.push(`שכיחויות לא תקינות: ${s.id}`);
      if(s.visual==='normal'||s.visual==='normal-school'){
        const [mu,sd,lo,hi]=v;
        if(sd<=0||sd>30||lo>=hi||lo<mu-3*sd||hi>mu+3*sd||(s.visual==='normal-school'&&[lo,hi].some(n=>Math.abs((n-mu)/sd*2-Math.round((n-mu)/sd*2))>1e-7)))errors.push(`התפלגות מחוץ לטווח הנתמך: ${s.id}`);
      }
    }
    const c = s.check;
    if (!c) continue;
    checks++;
    if ((s.phase === 'challenge' || c.kind === 'graph-target') && s.frames.length !== 1) errors.push(`בתרגול עצמאי נדרש שלב שאלה יחיד, בלי שלבי פתרון: ${s.id}`);
    if (!['choice', 'number', 'graph-target'].includes(c.kind) || !text(c.question, 280) || !text(c.success, 280) || !text(c.retry, 280)
      || !Array.isArray(c.hints) || c.hints.length < 1 || c.hints.length > 3 || !c.hints.every(h => text(h, 250))) errors.push(`שאלה ללא משוב ורמזים: ${s.id}`);
    if (c.kind === 'choice' && (!Array.isArray(c.options) || c.options.length < 2 || c.options.length > 4 || !c.options.every(o => text(o, 200))
      || new Set(c.options).size !== c.options.length || typeof c.answer !== 'number' || !Number.isInteger(c.answer) || c.answer < 0 || c.answer >= c.options.length)) errors.push(`אפשרויות תשובה לא תקינות: ${s.id}`);
    if (c.kind === 'number' && !finite(c.answer)) errors.push(`תשובה מספרית לא תקינה: ${s.id}`);
    if (c.kind === 'graph-target' && (!['quadratic', 'linear'].includes(s.visual) || !Array.isArray(c.answer) || c.answer.length !== dimensions[s.visual] || !c.answer.every(finite)
      || c.answer.some(n => !Number.isInteger(n) || Math.abs(n) > 5) || (s.visual === 'quadratic' && Math.abs(c.answer[0]) < 0.1))) errors.push(`מטרת גרף לא תקינה: ${s.id}`);
    if (c.kind === 'graph-target' && s.visual === 'quadratic' && Array.isArray(c.answer)
      && (c.answer[1] < s.xDomain?.[0] || c.answer[1] > s.xDomain?.[1] || c.answer[2] < s.yDomain?.[0] || c.answer[2] > s.yDomain?.[1])) errors.push(`קודקוד המטרה מחוץ לגרף: ${s.id}`);
  }
  if (options.mode!=='homework'&&(checks < 2 || !e.scenes.some(s => s?.phase === 'challenge' && s.check))) errors.push('נדרשים שני תרגולים, כולל אתגר עצמאי');
  return [...new Set(errors)];
}

export type PublicExperience = Omit<LearningExperience, 'scenes'> & {
  scenes: Array<Omit<LearningScene, 'check' | 'presenterNotes'> & { check?: Omit<LearningCheck, 'answer' | 'solution'> & { hasSolution?:boolean;target?: number[] } | null }>;
};

export function publicExperience(e: LearningExperience): PublicExperience {
  return {version:e.version,title:e.title,subtitle:e.subtitle,objective:e.objective,minutes:e.minutes, scenes: e.scenes.map(s => {
    const publicScene={id:s.id,phase:s.phase,title:s.title,prompt:s.prompt,takeaway:s.takeaway,visual:s.visual,xDomain:s.xDomain,yDomain:s.yDomain,frames:s.frames.map(f=>({caption:f.caption,tex:f.tex,values:f.values})),...(s.tutorReview?{tutorReview:true}:{})};
    if (!s.check) return { ...publicScene, check: null };
    const {answer}=s.check;
    const check={kind:s.check.kind,question:s.check.question,options:s.check.options,hints:s.check.hints,retry:s.check.retry};
    // A target curve is intentionally visible; grading keys for other questions stay server-side.
    return { ...publicScene, check: { ...check,hasSolution:!!s.check.solution, success: '', ...(s.check.kind === 'graph-target' && Array.isArray(answer) ? { target: answer } : {}) } };
  }) };
}
