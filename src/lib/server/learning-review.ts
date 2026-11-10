/** Synthetic review fixtures only. No import into library or customer assignments. */
import corpus from './learning-review-corpus.json' with { type: 'json' };
import candidateCorpus from './learning-review-v2-corpus.json' with { type: 'json' };
import { BRAND_LOGO_SRC, deckRootCss } from '../brand.ts';
import { escapeHtml as esc, mathText } from '../learning/math.ts';
import { TEMPLATE_FILES, toTemplateShape, type LessonPlan } from './lesson/prep.ts';
import { validateLessonGame } from './lesson-games.ts';

type GenerationConfig = { model: string; effort: string; cli: string; sourceFingerprint: string };
export type ReviewCase = { brief: { id: string; title: string; level: string; request: string }; plan: LessonPlan };
export const reviewCorpus = corpus as unknown as {
  manifest: { batch: string; syntheticOnly: boolean; approval: string; config: GenerationConfig; generationVersions?: { batch: string; config: GenerationConfig }[] };
  cases: ReviewCase[];
};
export type ReviewVersion='baseline'|'v2';
export const reviewCorpusFor=(version:ReviewVersion='baseline')=>version==='v2'?candidateCorpus as unknown as typeof reviewCorpus:reviewCorpus;
export const reviewCase = (id: string,version:ReviewVersion='baseline') => reviewCorpusFor(version).cases.find(c => c.brief.id === id);
export const reviewUrl = (id: string, view = 'lesson',version:ReviewVersion='baseline') => `/app/learning-review?case=${encodeURIComponent(id)}&view=${view}${version==='v2'?'&version=v2':''}`;
export function reviewGames(item: ReviewCase,version:ReviewVersion='baseline') {
  return Object.entries(item.plan.games).filter(([, body]) => body != null).map(([key, value]) => {
    const template = TEMPLATE_FILES[key];
    const body = toTemplateShape(key, value);
    validateLessonGame(template, body);
    return { key,template, body, title: String(body.title), url: `/app/review-game/${item.brief.id}/${template}${version==='v2'?'?version=v2':''}` };
  });
}
function document(title: string, content: string) {
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)} · מאה בקליק</title><link rel="stylesheet" href="/learning-assets/katex.min.css"><style>
  @font-face{font-family:Heebo;src:url('/learning-assets/heebo-hebrew.woff2') format('woff2');font-weight:100 900;font-display:swap}
  ${deckRootCss()}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.8 Heebo,Arial,sans-serif}header,main{max-width:1060px;margin:auto;padding:24px}header{display:flex;align-items:center;justify-content:space-between;gap:16px}header img{height:36px;width:auto}h1{line-height:1.4;margin:0 0 16px}h2{font-size:22px;margin:0 0 8px}p{margin:8px 0}.muted,small{color:var(--muted-strong)}article,.intro{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:24px;margin-bottom:20px;scroll-margin-top:20px}.links{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}a,button{color:var(--brand-deep)}.links a,button{display:inline-flex;align-items:center;min-height:44px;border:1px solid var(--border);border-radius:10px;padding:8px 14px;text-decoration:none;font:inherit;background:var(--card);cursor:pointer}a:focus-visible,button:focus-visible{outline:3px solid var(--brand);outline-offset:3px}details{margin-top:16px}summary{cursor:pointer;font-weight:700}.learning-math{display:inline-block;max-width:100%;overflow-x:auto;direction:ltr;unicode-bidi:isolate;vertical-align:middle}code{overflow-wrap:anywhere;font-size:12px}li{margin-block:12px}@media(max-width:600px){header,main{padding:16px}article,.intro{padding:20px}h1{font-size:27px}}@media print{@page{size:A4;margin:16mm}body{background:white}header>a,.links,button{display:none}header,main{padding:0}article{break-inside:avoid;border:0;padding:16px 0}.learning-math{overflow:visible}}
  </style></head><body><header><img src="${BRAND_LOGO_SRC}" alt="מאה בקליק"><a href="/app/learning-review">כל הדוגמאות</a></header><main>${content}</main></body></html>`;
}
export function renderReviewIndex(version:ReviewVersion='baseline') {
  const reviewCorpus=reviewCorpusFor(version);
  const versions = reviewCorpus.manifest.generationVersions ?? [{batch:reviewCorpus.manifest.batch,config:reviewCorpus.manifest.config}];
  const versionDetails=versions.map(({config},i)=>`<p>גרסת יצירה ${i+1}: ${esc(config.model ?? '')} · ${esc(config.effort ?? '')} · ${esc(config.cli ?? '')}</p><code>${esc(config.sourceFingerprint ?? '')}</code>`).join('');
  return document('דוגמאות לבדיקה', `<nav class="links"><a href="/app/learning-review">הדוגמאות הקודמות</a><a href="/app/learning-review?version=v2">הגרסה החדשה לבדיקה</a></nav><h1>${reviewCorpus.cases.length} דוגמאות. בונים את השיעור הבא יחד.</h1><section class="intro"><p>דוגמאות מתלמידים מדומים, לבדיקה שלכם בלבד. הן עדיין לא אושרו לשימוש עם תלמידים.</p><p>פתחו מצגת והערות למורה בשני חלונות. נסו גם תרגיל ומשחק, ובדקו: האם ההסבר ברור? האם התלמיד יודע מה לעשות? האם המשוב עוזר כשיש טעות?</p><p>שלחו לנו משוב בשיחה: <strong>מספר הדוגמה, השלב, מה הפריע ומה הייתם רוצים במקום.</strong> אפשר גם פשוט לתאר מה לא עבד.</p><p class="muted">הבדיקה לא משנה שיעורי לקוחות ולא שומרת ציונים. בכל מצגת אפשר להדפיס או לשמור PDF.</p><details><summary>פרטי הגרסה לבדיקה</summary>${versionDetails}</details></section><aside class="intro"><h2>הפיילוט החזותי החדש · התפלגות נורמלית</h2><p>90 דקות · 3 יחידות · מצגת, הערות למורה, בית ושני משחקים. מחכה למשוב הוראה.</p><nav class="links"><a href="/app/learning-pilot">פתיחת הפיילוט ←</a></nav></aside>${reviewCorpus.cases.map((item,index) => `<article id="${item.brief.id}"><small>דוגמה ${index+1} · ${esc(item.brief.level)}</small><h2>${esc(item.brief.title)}</h2><p>${esc(item.brief.request)}</p><nav class="links" aria-label="${esc(item.brief.title)}"><a href="${esc(reviewUrl(item.brief.id,'lesson',version))}">מצגת אינטראקטיבית ↗</a><a href="${esc(reviewUrl(item.brief.id,'presenter',version))}">הערות למורה</a><a href="${esc(reviewUrl(item.brief.id,'homework',version))}">שיעורי בית</a>${reviewGames(item,version).map((game,i)=>`<a href="${game.url}">משחק ${i+1}: ${esc(game.title)}</a>`).join('')}</nav></article>`).join('')}`);
}
export function renderReviewHomework(item: ReviewCase) {
  return document(`שיעורי בית · ${item.brief.title}`, `<h1>${esc(item.brief.title)} · שיעורי בית</h1><p class="muted">דוגמה לבדיקה · תרגול אינטראקטיבי נוסף נמצא במצגת ובמשחקים. התשובות כאן מיועדות למורה.</p><nav class="links"><a href="${esc(reviewUrl(item.brief.id))}">לתרגול האינטראקטיבי</a><button id="print">הדפסה / PDF</button></nav>${item.plan.homework.map((task,index)=>`<article><h2>תרגיל ${index+1}</h2><p>${mathText(task.task)}</p><p class="muted">${mathText(task.why)}</p><details><summary>תשובה למורה</summary><p>${mathText(task.answer ?? 'לא נוצרה תשובה לתרגיל הזה')}</p></details></article>`).join('')}<script>document.getElementById('print').addEventListener('click',()=>window.print());</script>`);
}
