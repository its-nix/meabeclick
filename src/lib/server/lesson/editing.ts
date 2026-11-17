/**
 * What a Drive edit may change in a lesson, and how an edit becomes
 * a lesson again.
 *
 * Spec: docs/superpowers/specs/2026-09-25-lesson-editor-design.md. She
 * edits the PLAN — title, slides, worked examples — never HTML (D1); the
 * deck is rendered from the plan on publish, so the two cannot drift (D2).
 * Games and homework stay as generated (D5): applyEdit carries them over
 * untouched rather than trusting the client to send them back — except on
 * a library master, whose check questions and homework she may rewrite
 * (docs/superpowers/specs/2026-09-28-prepared-library-design.md): no child
 * has played a master, and every booking copied from it afterwards takes
 * its published plan.
 */
import {
  renderSlides, validateLesson, type HomeworkItem, type LessonPlan, type QuizGame, type Slide, type WorkedExample,
  type TwoTruthsGame, type ErrorHuntGame, type MatchingGame,
} from './prep.ts';
import { readLessons, inTransaction } from '../db.ts';
import { addMaterial, history, type MaterialRow } from '../materials.ts';
import { isLibrarySlug } from '../library/slug.ts';

type QuizQuestion = QuizGame['questions'][number];
type TwoTruthsRound = TwoTruthsGame['rounds'][number];
type ErrorHuntRound = ErrorHuntGame['rounds'][number];
type MatchPair = MatchingGame['pairs'][number];

/** The games a master's editor offers, beyond its quiz: the four most of
 *  the library's masters have (two truths in every one). The rest —
 *  graphs, labelling, tables — stay as generated. */
const EDITABLE_GAMES = {
  quiz: 'חידון', twoTruths: 'שתי אמיתות ושקר', errorHunt: 'ציד טעויות', sequence: 'סידור רצף', matching: 'משחק התאמה',
} as const;
type EditableGame = keyof typeof EDITABLE_GAMES;

interface PlanEdit {
  title: string;
  slides: Slide[];
  examples: WorkedExample[];
  /** Notes for the tutor only — stored beside the version, never rendered
   *  into the deck or served to a family (D6). */
  teacherOnly: string | null;
  /** A master's check questions and homework. Absent means "keep the
   *  plan's own", which is what every edit of a student's lesson (and
   *  every Drive edit) sends. */
  quiz?: QuizQuestion[];
  twoTruths?: TwoTruthsRound[];
  errorHunt?: ErrorHuntRound[];
  sequence?: string[];
  matching?: MatchPair[];
  homework?: HomeworkItem[];
}

const MAX_FIELD = 2000;
const MAX_ITEMS = 40;

/** Thrown inside normalizeEdit and turned into its `ok: false` — a limit
 *  is refused with a reason, never enforced by cutting her text silently. */
class TooLong extends Error {}

const text = (v: unknown): string => {
  const t = typeof v === 'string' ? v.trim() : '';
  if (t.length > MAX_FIELD) throw new TooLong(`טקסט ארוך מדי — עד ${MAX_FIELD} תווים בשדה אחד`);
  return t;
};
const lines = (v: unknown): string[] => {
  const out = (Array.isArray(v) ? v : []).map(text).filter(Boolean);
  if (out.length > MAX_ITEMS) throw new TooLong(`יותר מדי שורות — עד ${MAX_ITEMS} ברשימה אחת`);
  return out;
};

type Result = { ok: true; edit: PlanEdit } | { ok: false; error: string };

/** Validates and trims an edit (D4). The generator's stricter shape rules
 *  are not applied: the tutor is the judge of her own lesson. */
export function normalizeEdit(input: unknown): Result {
  try {
    return check(input);
  } catch (err) {
    if (err instanceof TooLong) return { ok: false, error: err.message };
    throw err;
  }
}

function check(input: unknown): Result {
  if (!input || typeof input !== 'object') return { ok: false, error: 'עריכה לא תקינה' };
  const raw = input as Record<string, unknown>;

  const title = text(raw.title);
  if (!title) return { ok: false, error: 'צריך כותרת לשיעור' };

  if (!Array.isArray(raw.slides) || raw.slides.length === 0) return { ok: false, error: 'צריך לפחות שקף אחד' };
  if (raw.slides.length > MAX_ITEMS) return { ok: false, error: `יותר מדי שקפים — עד ${MAX_ITEMS}` };
  const slides: Slide[] = [];
  for (const [i, s] of raw.slides.entries()) {
    const r = (s ?? {}) as Record<string, unknown>;
    const heading = text(r.heading);
    const bullets = lines(r.bullets);
    if (!heading) return { ok: false, error: `לשקף ${i + 1} אין כותרת` };
    if (!bullets.length) return { ok: false, error: `בשקף ${i + 1} אין אף נקודה` };
    const note = text(r.note);
    slides.push(note ? { heading, bullets, note } : { heading, bullets });
  }

  const rawExamples = Array.isArray(raw.examples) ? raw.examples : [];
  if (rawExamples.length > MAX_ITEMS) return { ok: false, error: `יותר מדי דוגמאות — עד ${MAX_ITEMS}` };
  const examples: WorkedExample[] = [];
  for (const [i, e] of rawExamples.entries()) {
    const r = (e ?? {}) as Record<string, unknown>;
    const problem = text(r.problem);
    const answer = text(r.answer);
    if (!problem) return { ok: false, error: `לדוגמה ${i + 1} אין תרגיל` };
    if (!answer) return { ok: false, error: `לדוגמה ${i + 1} אין תשובה` };
    examples.push({ problem, steps: lines(r.steps), answer });
  }

  const edit: PlanEdit = { title, slides, examples, teacherOnly: text(raw.teacherOnly) || null };

  if (raw.quiz !== undefined) {
    if (!Array.isArray(raw.quiz) || raw.quiz.length === 0) return { ok: false, error: 'צריך לפחות שאלה אחת בחידון' };
    if (raw.quiz.length > MAX_ITEMS) return { ok: false, error: `יותר מדי שאלות — עד ${MAX_ITEMS}` };
    edit.quiz = [];
    for (const [i, x] of raw.quiz.entries()) {
      const r = (x ?? {}) as Record<string, unknown>;
      const q = text(r.q);
      if (!q) return { ok: false, error: `לשאלה ${i + 1} אין טקסט` };
      if (!Array.isArray(r.options) || r.options.length < 2) return { ok: false, error: `לשאלה ${i + 1} צריך לפחות שתי אפשרויות` };
      if (r.options.length > MAX_ITEMS) return { ok: false, error: `יותר מדי אפשרויות בשאלה ${i + 1}` };
      const options = r.options.map(text);
      /* Refused, not dropped: dropping one would shift every later option,
         and the marked answer would silently point at a different one. */
      const blank = options.findIndex(o => !o);
      if (blank >= 0) return { ok: false, error: `באפשרות ${blank + 1} של שאלה ${i + 1} אין טקסט` };
      if (!Number.isInteger(r.answer) || (r.answer as number) < 0 || (r.answer as number) >= options.length) {
        return { ok: false, error: `בשאלה ${i + 1} לא סומנה תשובה נכונה` };
      }
      edit.quiz.push({ q, options, answer: r.answer as number, why: text(r.why), hint: text(r.hint) });
    }
  }

  /* The other games. As with the quiz, a field left empty is refused,
     never dropped: dropping a statement or a step would move the marked
     lie or wrong step onto a different one. */
  const rows = (v: unknown, name: string, min: number): Record<string, unknown>[] | string => {
    if (!Array.isArray(v) || v.length < min) return `ב${name} צריך לפחות ${min}`;
    if (v.length > MAX_ITEMS) return `יותר מדי ב${name} — עד ${MAX_ITEMS}`;
    return v.map(x => (x && typeof x === 'object' ? x as Record<string, unknown> : {}));
  };
  const markedIn = (n: unknown, count: number) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < count;

  if (raw.twoTruths !== undefined) {
    const rs = rows(raw.twoTruths, 'שתי אמיתות ושקר', 1);
    if (typeof rs === 'string') return { ok: false, error: rs };
    edit.twoTruths = [];
    for (const [i, r] of rs.entries()) {
      const statements = Array.isArray(r.statements) ? r.statements.map(text) : [];
      if (statements.length !== 3) return { ok: false, error: `בסבב ${i + 1} של שתי אמיתות ושקר צריך בדיוק שלושה משפטים` };
      const blank = statements.findIndex(s => !s);
      if (blank >= 0) return { ok: false, error: `במשפט ${blank + 1} של סבב ${i + 1} אין טקסט` };
      if (!markedIn(r.lieIndex, 3)) return { ok: false, error: `בסבב ${i + 1} לא סומן המשפט השקרי` };
      edit.twoTruths.push({ statements, lieIndex: r.lieIndex as number, why: text(r.why), hint: text(r.hint) });
    }
  }

  if (raw.errorHunt !== undefined) {
    const rs = rows(raw.errorHunt, 'ציד טעויות', 1);
    if (typeof rs === 'string') return { ok: false, error: rs };
    edit.errorHunt = [];
    for (const [i, r] of rs.entries()) {
      const problem = text(r.problem);
      if (!problem) return { ok: false, error: `לסבב ${i + 1} של ציד טעויות אין תרגיל` };
      const steps = Array.isArray(r.steps) ? r.steps.map(text) : [];
      if (steps.length < 2) return { ok: false, error: `בסבב ${i + 1} של ציד טעויות צריך לפחות שני שלבים` };
      if (steps.length > MAX_ITEMS) return { ok: false, error: `יותר מדי שלבים בסבב ${i + 1}` };
      const blank = steps.findIndex(s => !s);
      if (blank >= 0) return { ok: false, error: `בשלב ${blank + 1} של סבב ${i + 1} אין טקסט` };
      if (!markedIn(r.badStep, steps.length)) return { ok: false, error: `בסבב ${i + 1} לא סומן השלב השגוי` };
      edit.errorHunt.push({ problem, steps, badStep: r.badStep as number, why: text(r.why), hint: text(r.hint) });
    }
  }

  if (raw.sequence !== undefined) {
    if (!Array.isArray(raw.sequence) || raw.sequence.length < 3) return { ok: false, error: 'בסידור רצף צריך לפחות שלושה שלבים' };
    if (raw.sequence.length > MAX_ITEMS) return { ok: false, error: `יותר מדי שלבים בסידור רצף — עד ${MAX_ITEMS}` };
    const steps = raw.sequence.map(text);
    if (steps.some(s => !s)) return { ok: false, error: 'בסידור רצף יש שלב בלי טקסט' };
    edit.sequence = steps;
  }

  if (raw.matching !== undefined) {
    const rs = rows(raw.matching, 'משחק התאמה', 3);
    if (typeof rs === 'string') return { ok: false, error: rs };
    edit.matching = [];
    for (const [i, r] of rs.entries()) {
      const left = text(r.left), right = text(r.right);
      if (!left || !right) return { ok: false, error: `בזוג ${i + 1} של משחק ההתאמה חסר צד` };
      edit.matching.push({ left, right, hint: text(r.hint) });
    }
  }

  if (raw.homework !== undefined) {
    if (!Array.isArray(raw.homework)) return { ok: false, error: 'שיעורי בית לא תקינים' };
    if (raw.homework.length > MAX_ITEMS) return { ok: false, error: `יותר מדי משימות — עד ${MAX_ITEMS}` };
    edit.homework = [];
    for (const [i, x] of raw.homework.entries()) {
      const r = (x ?? {}) as Record<string, unknown>;
      const task = text(r.task);
      if (!task) return { ok: false, error: `למשימה ${i + 1} אין טקסט` };
      const answer = text(r.answer);
      edit.homework.push(answer ? { task, why: text(r.why), answer } : { task, why: text(r.why) });
    }
  }

  return { ok: true, edit };
}

/** The lesson an edit describes: the base plan with title, slides and
 *  examples replaced — and the quiz's questions and the homework when the
 *  edit carries them — and everything else kept as it was. */
export function applyEdit(base: LessonPlan, edit: PlanEdit): LessonPlan {
  const plan: LessonPlan = { ...base, title: edit.title, slides: edit.slides, examples: edit.examples };
  const g = base.games;
  if (g && (edit.quiz || edit.twoTruths || edit.errorHunt || edit.sequence || edit.matching)) {
    plan.games = {
      ...g,
      ...(edit.quiz && g.quiz ? { quiz: { ...g.quiz, questions: edit.quiz } } : {}),
      ...(edit.twoTruths && g.twoTruths ? { twoTruths: { ...g.twoTruths, rounds: edit.twoTruths } } : {}),
      ...(edit.errorHunt && g.errorHunt ? { errorHunt: { ...g.errorHunt, rounds: edit.errorHunt } } : {}),
      ...(edit.sequence && g.sequence ? { sequence: { ...g.sequence, steps: edit.sequence } } : {}),
      ...(edit.matching && g.matching ? { matching: { ...g.matching, pairs: edit.matching } } : {}),
    };
  }
  if (edit.homework) plan.homework = edit.homework;
  return plan;
}

/** What renderSlides needs to know about the lesson, from its own row —
 *  the same subject, level and student the generated deck was made for. */
export function lessonMeta(slug: string): { subject: string; level: string; student: string } | null {
  const l = readLessons().find(x => x.slug === slug);
  return l ? { subject: l.subject ?? '', level: l.level ?? '', student: l.student } : null;
}

/**
 * The version the editor starts from and an edit applies to — one rule,
 * used by the page's seed and by every save, so the two cannot disagree.
 *
 * The newest version that PARSES and is either published or her own work
 * (edited, restored — a draft is her earlier work). NOT an unpublished
 * generated version: recordGenerated appends a regeneration unpublished
 * precisely so it cannot replace her edit, and starting the editor from it
 * would let one click of "publish" do exactly that. It is reported as
 * `pendingRegeneration` instead, for the page to offer.
 */
export function editBase(slug: string): {
  version: number; plan: LessonPlan; teacherOnly: string | null; pendingRegeneration: number | null;
} | null {
  const versions = history(slug, 'plan');
  const newest = versions[0];
  const pendingRegeneration = newest && newest.origin === 'generated' && !newest.published_at ? newest.version : null;
  for (const v of versions) {
    if (v.origin === 'generated' && !v.published_at) continue;
    try {
      return { version: v.version, plan: JSON.parse(v.content) as LessonPlan, teacherOnly: v.teacher_only, pendingRegeneration };
    } catch { /* a version that does not parse is skipped, not a dead end */ }
  }
  return null;
}

/**
 * The lesson an edit describes: editBase() merged with the edit. A 409 when
 * the lesson has no usable plan version (generated before #106, spec D8).
 */
export function editedPlan(slug: string, rawEdit: unknown):
  { plan: LessonPlan; teacherOnly: string | null } | { error: string; status: number } {
  const edit = normalizeEdit(rawEdit);
  if (!edit.ok) return { error: edit.error, status: 400 };
  const games = (Object.keys(EDITABLE_GAMES) as EditableGame[]).filter(k => edit.edit[k]);
  if ((games.length || edit.edit.homework) && !isLibrarySlug(slug)) {
    return { error: 'שאלות בדיקה, משחקים ושיעורי בית אפשר לערוך רק בשיעור מהספרייה — בשיעור של תלמיד/ה הם כבר נשלחו', status: 400 };
  }
  const base = editBase(slug);
  if (!base) return { error: 'לשיעור הזה אין גרסה שאפשר לערוך', status: 409 };
  const missing = games.find(k => !base.plan.games?.[k]);
  if (missing) return { error: `בשיעור הזה אין ${EDITABLE_GAMES[missing]}`, status: 400 };
  return { plan: applyEdit(base.plan, edit.edit), teacherOnly: edit.edit.teacherOnly };
}

/**
 * Publishes a plan to the student: the plan AND the deck rendered from it,
 * both or neither — a published plan whose deck was not updated would tell
 * the tutor one thing and show the student another. The one way anything
 * publishes an edited plan: a Drive edit.
 */
export function publishPlan(slug: string, plan: LessonPlan, teacherOnly: string | null):
  { plan: MaterialRow; slides: MaterialRow } {
  const html = renderSlides(plan, lessonMeta(slug) ?? { subject: '', level: '' });
  return inTransaction(() => ({
    plan: addMaterial({ slug, kind: 'plan', content: JSON.stringify(plan), teacherOnly, origin: 'edited', publish: true }),
    slides: addMaterial({ slug, kind: 'slides', content: html, origin: 'edited', publish: true }),
  }));
}
