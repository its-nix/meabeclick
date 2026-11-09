import { createHash } from 'node:crypto';
import { deckRootCss, BRAND_LOGO_SRC } from '../brand.ts';
import { escapeHtml as esc, mathText, mathFormula } from '../learning/math.ts';
import { learningProblems, publicExperience, PHASE_LABELS, type LearningExperience, type LearningScene } from '../learning/model.ts';
import { mountLearning, writeLearningText, type LearningClientConfig } from '../learning/runtime.ts';
import { drawLearningVisual, learningFrameAt, formulaForVisual } from '../learning/visual.ts';
import { learningStyles } from '../learning/styles.ts';
import {renderTeachingAgenda,type TeachingDisplay} from './teaching-display.ts';

export const learningFingerprint = (e: LearningExperience): string => createHash('sha256').update(JSON.stringify({
  version:e.version,scenes:e.scenes.map(({title:_title,presenterNotes:_notes,...scene})=>scene),
})).digest('hex').slice(0, 24);

export function experienceProblems(raw: unknown, options: { requirePresenterNotes?: boolean;mode?:'homework' } = {}): string[] {
  const problems = learningProblems(raw, options);
  if (problems.length) return problems;
  const e = raw as LearningExperience;
  for (const scene of e.scenes) {
    for (const frame of scene.frames) {
      try { mathFormula(frame.tex); } catch { problems.push(`נוסחה לא תקינה בסצנה ${scene.id}`); }
    }
    const notes = scene.presenterNotes;
    for (const text of [scene.prompt, scene.takeaway, ...scene.frames.map(f => f.caption), scene.check?.question, scene.check?.success, scene.check?.retry,scene.check?.solution, ...(scene.check?.hints ?? []), ...(scene.check?.options ?? []), ...(notes ? [notes.explanation, notes.ask, notes.expectedAnswer, notes.ifStuck, notes.misconception, notes.transition] : [])]) {
      if (text && mathText(text).includes('data-math-error')) problems.push(`נוסחה לא תקינה בטקסט הסצנה ${scene.id}`);
    }
  }
  return [...new Set(problems)];
}

function controls(scene: LearningScene): string {
  if (scene.phase !== 'explore' && scene.check?.kind !== 'graph-target') return '';
  if (scene.phase === 'explore' && scene.frames.length > 1) return '';
  const v=scene.frames[0].values;
  const definitions:Array<{index:number;name:string;label:string;min?:number;max?:number;step?:number}> = scene.visual === 'quadratic'
    ? [{ index: 1, name: 'h', label: 'ימינה ושמאלה' }, { index: 2, name: 'k', label: 'למעלה ולמטה' },
      ...(scene.check?.kind === 'graph-target' ? [{ index: 0, name: 'a', label: 'פתיחה וכיוון' }] : [])]
    : scene.visual === 'linear' ? [{ index: 0, name: 'm', label: 'שיפוע' }, { index: 1, name: 'b', label: 'חיתוך עם הציר' }]
    : scene.visual === 'number-line' ? [{ index: 0, name: 'x', label: 'מיקום על הציר' }]
    : scene.visual==='fraction'?[{index:0,name:'n',label:'חלקים צבועים',min:0,max:v[1],step:1},{index:2,name:'k',label:'חלוקת כל חלק',min:1,max:4,step:1}]
    : scene.visual==='geometry'?(v[0]===3?[1]:[5,6].includes(v[0])?[1,3]:[4,7].includes(v[0])?[1,2,3]:[1,2]).map(index=>({index,name:v[0]===1?(index===1?'b':'h'):v[0]===3||[5,6].includes(v[0])?(index===1?'r':'h'):['','a','b','h'][index],label:index===3||v[0]===1&&index===2?'גובה מאונך':'מידה',min:1,max:20,step:1}))
    : scene.visual==='data-bars'?v.map((_,index)=>({index,name:`f_${index+1}`,label:`שכיחות הערך ${index+1}`,min:0,max:20,step:1}))
    : scene.visual==='normal'||scene.visual==='normal-school'?[2,3].map(index=>({index,name:index===2?'L':'U',label:index===2?'גבול תחתון':'גבול עליון',min:v[0]-3*v[1],max:v[0]+3*v[1],step:v[1]/(scene.visual==='normal-school'?2:10)})):[];
  if (!definitions.length) return '';
  return `<div class="scene-controls">${definitions.map(p => `<label class="parameter"><span class="parameter-header"><span><b dir="ltr">${p.name}</b> · ${p.label}</span><output data-output="${p.index}">${v[p.index]}</output></span><input aria-label="${p.name} — ${p.label}" data-param="${p.index}" type="range" min="${p.min??(scene.visual === 'number-line' ? scene.xDomain[0] : -5)}" max="${p.max??(scene.visual === 'number-line' ? scene.xDomain[1] : 5)}" step="${p.step??(scene.visual === 'number-line' ? .25 : 1)}" value="${v[p.index]}"></label>`).join('')}</div>`;
}

export function renderLearningDocument(e: LearningExperience, options: {
  slug?: string; demo?: boolean; storageScope?: string;
  solutions?: boolean; film?: string; backUrl?: string; preview?: boolean; presenterUrl?: string;
  teaching?:TeachingDisplay;variant?:'homework';
} = {}): string {
  const problems = experienceProblems(e,{mode:options.variant});
  if (problems.length) throw new Error(`Invalid learning experience: ${problems.join('; ')}`);
  const config: LearningClientConfig = {
    experience: publicExperience(e), fingerprint: learningFingerprint(e), lessonSlug: options.slug ?? null,
    demo: !!options.demo || !!options.preview, storageScope: options.storageScope,
    variant:options.variant,
    ...(options.demo || options.preview ? { demoChecks: Object.fromEntries(e.scenes.filter(s => s.check).map(s => {const {solution:_private,...check}=s.check!;return [s.id,check];})) } : {}),
  };
  const data = JSON.stringify(config).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const sections = e.scenes.map((s, i) => {
    const check = s.check;
    const duration = Math.max(1, s.frames.length-1)*4+2;
    return `<section data-scene="${s.id}" ${i ? 'hidden' : ''}>
      <header class="scene-header"><h1 tabindex="-1">${esc(s.title)}</h1><p>${mathText(s.prompt)}</p></header>
      <div class="visual-card">
        <div class="visual-top"><span class="visual-label">${s.visual === 'balance' ? 'המאזניים של המשוואה' : s.visual === 'steps' ? 'צעד אחד בכל פעם' : 'מעבדת הרעיונות'}</span><span class="coordinate-readout" dir="ltr"><span class="coordinate-dot"></span><span data-coordinate></span></span></div>
        <div class="formula-display" data-formula ${s.visual === 'steps' ? 'hidden' : ''}>${mathFormula(s.check?.kind === 'graph-target' ? s.visual === 'quadratic' ? 'y=a(x-h)^2+k' : 'y=mx+b' : s.visual === 'steps' ? s.frames[0].tex : formulaForVisual(s.visual,s.frames[0].values))}</div>
        <svg id="plot-${s.id}" class="plot" data-plot role="img" aria-label="${esc(s.check?.kind === 'graph-target' ? 'גרף היעד המקווקו — בנו נוסחה שמתאימה לכל העקום' : s.phase === 'challenge' ? 'המחשה שתתגלה אחרי פתרון האתגר' : `המחשה: ${s.title}`)}" ${s.visual === 'steps' ? 'hidden' : ''}></svg>
        ${s.visual === 'steps' ? `<div class="steps-board"><div class="step-formula" data-step-formula>${mathFormula(s.frames[0].tex)}</div><div class="step-caption" data-step-caption>${mathText(s.frames[0].caption)}</div></div>` : ''}
        <p class="scene-caption" data-caption ${s.visual === 'steps' ? 'hidden' : ''}>${mathText(s.frames[0].caption)}</p>
        <div class="frame-dots" ${s.frames.length < 2 ? 'hidden' : ''}>${s.frames.map((_, n) => `<button class="frame-dot" data-frame-dot aria-label="שלב המחשה ${n+1}" aria-pressed="${n === 0}"></button>`).join('')}</div>
        <div class="playback" ${s.frames.length < 2 || s.phase === 'challenge' ? 'hidden' : ''}><button class="round-button" data-play aria-label="הפעלת ההסבר">▶</button><span class="clock" data-clock>0:00</span><input class="timeline" data-timeline type="range" min="0" max="${duration}" step=".05" value="0" aria-label="מיקום בהסבר המונפש"><button class="speed" data-speed aria-label="שינוי מהירות ההסבר">1×</button></div>
        ${controls(s)}
      </div>
      ${s.phase === 'explore' ? '<p class="exploration-note">אפשר לשחק עם הערכים, לטעות ולגלות. אין כאן ציון.</p>' : ''}
      ${check ? `<div class="check-card"><span class="check-kicker">${s.phase === 'challenge' ? 'מנסים לבד' : 'תורכם לנסות'}</span><h2 class="check-question">${mathText(check.question)}</h2>
        ${check.kind === 'choice' ? `<div class="choices" role="group" aria-label="אפשרויות תשובה">${check.options.map((o, j) => `<button class="choice" data-option="${j}" aria-pressed="false"><span class="choice-key">${['א', 'ב', 'ג', 'ד'][j]}</span><span>${mathText(o)}</span></button>`).join('')}</div>` : ''}
        ${check.kind === 'number' ? `<label class="answer-label" for="answer-${s.id}">התשובה שלי</label><input class="number-answer" id="answer-${s.id}" data-number-answer type="text" inputmode="decimal" autocomplete="off" maxlength="80" placeholder="אפשר גם שבר, למשל 1/2">` : ''}
        <div class="check-actions"><button class="primary-button" data-submit>בדיקת התשובה <span aria-hidden="true">←</span></button><button class="hint-button" data-hint>אפשר רמז?</button>${check.solution&&!options.preview&&!options.demo?'<button class="hint-button" data-solution disabled>פתרון בשלבים</button>':''}</div>
      </div>` : ''}
      ${check?.solution?'<div class="worked-solution" data-worked-solution hidden role="status" aria-live="polite"></div>':''}
      ${s.tutorReview?`<div class="check-card"><span class="check-kicker">לבדיקת מורה</span><label class="answer-label" for="reason-${s.id}">הדרך והנימוק שלי</label><textarea id="reason-${s.id}" data-reasoning maxlength="3000" rows="5"></textarea><p class="print-note">הטיוטה נשמרת במכשיר הזה בלבד. הביאו את הדרך לשיעור; המורה תעבור עליה איתכם.</p></div>`:''}
      <p class="hint-text" data-hint-text hidden></p><p class="feedback" data-feedback role="status" aria-live="polite"></p>
      ${s.phase === 'reflect' ? `<div class="takeaway"><small>הרעיון שנשאר</small><p>${mathText(s.takeaway)}</p></div><p class="completion-note" data-completion></p>` : ''}
      ${s.frames.map(f => `<template data-formula-template>${mathFormula(s.visual === 'steps' ? f.tex : formulaForVisual(s.visual,f.values))}</template>`).join('')}
    </section>`;
  }).join('');
  const back = options.backUrl ?? (options.demo ? '/' : '/app/student');
  const printScenes = e.scenes.filter(s => s.check||options.variant==='homework').map((s, i) => !s.check?`<section class="print-question"><h2>${i+1}. ${mathText(s.frames[0].caption)}</h2><p>לבדיקת מורה</p><p data-reasoning-print="${s.id}"></p><div class="worksheet-space"></div></section>`:`<section class="print-question"><h2>${i+1}. ${mathText(s.check!.question)}</h2><div dir="ltr">${mathFormula(s.check!.kind === 'graph-target' ? s.visual === 'quadratic' ? 'y=a(x-h)^2+k' : 'y=mx+b' : s.visual === 'steps' ? s.frames[0].tex : formulaForVisual(s.visual,s.frames[0].values))}</div>
    ${s.check!.kind === 'choice' ? `<ol type="א">${s.check!.options.map(o => `<li>${mathText(o)}</li>`).join('')}</ol>` : ''}
    ${s.check!.kind === 'graph-target' ? `<svg id="print-${s.id}" class="plot print-graph" data-print-plot="${s.id}" role="img" aria-label="גרף לתרגול"></svg>` : ''}
    <div class="worksheet-space"></div>${options.solutions ? `<div class="printed-answer">תשובה: <bdi dir="ltr">${s.check!.kind === 'choice' ? mathText(s.check!.options[Number(s.check!.answer)]) : mathFormula(Array.isArray(s.check!.answer) ? `(${s.check!.answer.join(',')})` : String(s.check!.answer))}</bdi><br>${mathText(s.check!.success)}</div>` : ''}</section>`).join('');
  const printExplanations=options.teaching?e.scenes.filter(s=>!s.check).map(s=>`<section class="print-question"><h2>${esc(s.title)}</h2><p>${mathText(s.prompt)}</p>${s.frames.map((f,i)=>`<div class="print-explanation"><div dir="ltr">${mathFormula(s.visual==='steps'?f.tex:formulaForVisual(s.visual,f.values))}</div><p>${mathText(f.caption)}</p>${s.visual==='steps'?'':`<svg class="plot" data-print-visual="${s.id}:${i}" role="img" aria-label="${esc(f.caption)}"></svg>`}</div>`).join('')}</section>`).join(''):'';
  return `<!doctype html><html lang="he" dir="rtl" data-mode="learn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="robots" content="${options.demo ? 'index,follow' : 'noindex,nofollow'}"><title>${esc(e.title)} · מאה בקליק</title><link rel="icon" href="/images/favicon.svg"><link rel="stylesheet" href="/learning-assets/katex.min.css"><style>${deckRootCss()}${learningStyles}</style><script defer src="/learning-assets/katex.min.js"></script></head><body>
    <header class="learn-top"><a class="learn-brand" href="${esc(back)}"><img class="lesson-logo" src="${BRAND_LOGO_SRC}" alt="" height="32"><span>מאה בקליק</span></a><div class="top-meta"><span class="sample-label">${options.preview ? 'תצוגת מורה · ללא רישום תוצאות' : options.demo ? 'שיעור לדוגמה' : 'המרחב שלי ללמידה'}</span><button class="text-button" data-print>דף תרגול להדפסה ↗</button></div></header>
    <noscript><p class="no-script">כדי להזיז גרפים ולבדוק תשובות יש להפעיל JavaScript. דף התרגול זמין גם בהדפסה.</p></noscript>
    <div class="learn-layout"><aside class="learn-sidebar"><div class="course-intro"><span class="course-kicker">מתמטיקה, צעד אחר צעד</span><h2 class="course-title">${esc(e.title)}</h2><span class="course-time">כ־${e.minutes} דקות · בקצב שלכם</span><div class="course-progress" data-course-progress role="progressbar" aria-label="שלבים שהושלמו" aria-valuemin="0" aria-valuemax="${e.scenes.length}" aria-valuenow="0"><span data-progress-fill></span></div><p class="progress-copy" data-progress-copy>0 מתוך ${e.scenes.length} שלבים הושלמו</p></div><nav class="scene-nav" aria-label="שלבי השיעור">${e.scenes.map((s, i) => `<button class="scene-link" data-scene-link aria-current="${i === 0 ? 'step' : 'false'}" aria-label="${i+1}. ${esc(s.title)}"><span class="scene-number" data-scene-number>${String(i+1).padStart(2, '0')}</span><span class="scene-nav-label">${esc(s.title)}<small>${PHASE_LABELS[s.phase]}</small></span></button>`).join('')}</nav><p class="sidebar-note">${esc(e.objective)}<br><br>אפשר לחזור, לנסות שוב ולגלות בקצב שלכם.</p></aside>
    <main class="learn-main">${options.preview && options.presenterUrl ? `<a class="presenter-link" href="${esc(options.presenterUrl)}" target="_blank" rel="noopener">הערות למורה ↗</a>` : ''}${renderTeachingAgenda(options.teaching)}<div class="lesson-heading"><span class="phase-tag" data-phase-label>מגלים</span><div class="mode-switch" role="group" aria-label="אופן הלמידה"><button data-mode="learn" aria-pressed="true">לומדים</button><button data-mode="practice" aria-pressed="false">מתרגלים</button></div></div>${sections}<footer class="scene-footer"><button class="primary-button next-button" data-next><span data-next-label>ממשיכים</span><span aria-hidden="true">←</span></button><span class="footer-count" data-current-step>01 / ${String(e.scenes.length).padStart(2, '0')}</span><button class="text-button" data-prev disabled>→ הקודם</button></footer><div class="save-status" data-save-status role="status" aria-live="polite"></div><div class="learn-bottom"><span>אפשר לחזור לכל שלב ולנסות שוב.</span><button class="text-button" data-print>הדפסת התרגול ↗</button>${options.film ? '<button class="film-link" data-film-open>סרטון ההסבר ↗</button>' : ''}</div></main></div>
    <div class="print-pages"><div class="print-brand"><img src="${BRAND_LOGO_SRC}" alt="" height="32"><span>מאה בקליק</span></div><span class="print-note">מאה בקליק · ${options.solutions ? 'תשובון למורה' : 'דף תרגול'}</span><h1 class="print-heading">${esc(e.title)}</h1><p>${esc(e.objective)}</p>${printExplanations}${printScenes}</div>
    <dialog class="film-dialog" data-film-dialog><div class="film-head"><h2>הזזת פרבולה, בתנועה</h2><button class="text-button" data-film-close>סגירה ×</button></div><video controls playsinline preload="none" aria-label="הסבר חזותי להזזת פרבולה" ${options.film ? `src="${esc(options.film)}" poster="${esc(options.film.replace(/\.mp4$/, '-poster.png'))}"` : ''}></video></dialog>
    <script id="learning-data" type="application/json">${data}</script><script>addEventListener('DOMContentLoaded',()=>{(${mountLearning.toString()})(${drawLearningVisual.toString()},${learningFrameAt.toString()},${formulaForVisual.toString()},${writeLearningText.toString()});});</script></body></html>`;
}
