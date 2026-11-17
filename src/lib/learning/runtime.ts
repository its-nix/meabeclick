import type { PublicExperience, LearningCheck, LearningExperience } from './model.ts';
import type { drawLearningVisual, learningFrameAt, formulaForVisual } from './visual.ts';

export interface LearningProgress { attempts: number; hints: number; solved: boolean; visited: boolean;revealed?:boolean }
export interface LearningClientConfig {
  experience: PublicExperience; fingerprint: string; lessonSlug: string | null;
  demo: boolean; demoChecks?: Record<string, LearningCheck>; storageScope?: string;
  independentSceneIds?:string[];
}

/** Only TeX renderer output becomes markup; every piece of prose is a text node. */
export function writeLearningText(element: Element, text: string): void {
  const katex = (window as unknown as { katex?: { renderToString: (tex: string, options: object) => string } }).katex;
  const pattern = /\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g;
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    fragment.append(document.createTextNode(text.slice(cursor, match.index)));
    const span = document.createElement('span');
    span.dir = 'ltr'; span.className = 'learning-math';
    span.style.cssText = 'display:inline-block;direction:ltr;unicode-bidi:isolate;vertical-align:middle';
    try {
      if (!katex) throw new Error('math not ready');
      span.innerHTML = katex.renderToString(match[1] ?? match[2] ?? match[3], { throwOnError: true, trust: false });
    } catch { span.textContent = match[0]; span.setAttribute('data-math-error', ''); }
    fragment.append(span); cursor = match.index! + match[0].length;
  }
  fragment.append(document.createTextNode(text.slice(cursor)));
  element.replaceChildren(fragment);
}

/** Deliberately self-contained. The renderer embeds this trusted runtime, never model code. */
export function mountLearning(draw: typeof drawLearningVisual, at: typeof learningFrameAt, formula: typeof formulaForVisual, rich: typeof writeLearningText): void {
  const payload = document.getElementById('learning-data');
  if (!payload?.textContent) return;
  const config = JSON.parse(payload.textContent) as LearningClientConfig;
  const scenes = config.experience.scenes;
  const query = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T => root.querySelector<T>(selector)!;
  const all = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] => [...root.querySelectorAll<T>(selector)];
  const buttons = all<HTMLButtonElement>('[data-scene-link]');
  const sections = all<HTMLElement>('[data-scene]');
  const status = query('[data-save-status]');
  const root = document.documentElement;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const independentIds=new Set(config.independentSceneIds??scenes.filter(s=>s.phase==='challenge').map(s=>s.id));
  let active = 0, elapsed = 0, playing = false, speed = 1, animation = 0, previousTime = 0;
  let params = scenes[0].frames[0].values.slice();
  let selected: number | null = null;
  let manipulated = false;
  const scope = config.storageScope ?? (config.demo ? 'demo' : 'local');
  let states: Record<string, LearningProgress> = {};
  const slug = config.lessonSlug ?? '';
  const localStatus = config.demo ? 'שיעור לדוגמה · ההתקדמות נשמרת במכשיר הזה' : 'ההתקדמות נשמרת במכשיר הזה בלבד';
  const key = () => `meabeclick:learning:${scope}:${slug || 'demo'}:${config.fingerprint}`;
  const progress = (id: string) => states[id] ??= { attempts: 0, hints: 0, solved: false, visited: false };
  const feedback = (text: string, kind = 'success') => {
    const element = query('[data-feedback]', sections[active]);
    rich(element, text); element.setAttribute('data-kind', kind);
  };
  const remember = () => {
    try { localStorage.setItem(key(), JSON.stringify({ active, states })); } catch { status.textContent = 'השמירה במכשיר אינה זמינה בדפדפן הזה.'; }
  };
  const restore = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(key()) ?? '{}');
      if (saved.states && typeof saved.states === 'object') states = saved.states;
      if (Number.isInteger(saved.active) && saved.active >= 0 && saved.active < scenes.length) active = saved.active;
    } catch { /* Corrupt local state never prevents a lesson opening. */ }
  };
  const duration = () => Math.max(1, scenes[active].frames.length - 1) * 4 + 2;
  const pause = () => { playing = false; cancelAnimationFrame(animation); query<HTMLButtonElement>('[data-play]', sections[active]).textContent = '▶'; query('[data-play]', sections[active]).setAttribute('aria-label', 'הפעלת ההסבר'); };

  function updateProgress(): void {
    let completed = 0;
    buttons.forEach((button, i) => {
      const s = progress(scenes[i].id);
      const done = scenes[i].check ? s.solved : s.visited;
      if (done) completed++;
      button.classList.toggle('is-complete', done);
      button.setAttribute('aria-current', i === active ? 'step' : 'false');
      query('[data-scene-number]', button).textContent = done ? '✓' : String(i + 1).padStart(2, '0');
    });
    query('[data-progress-fill]').style.width = `${completed / scenes.length * 100}%`;
    query('[data-progress-copy]').textContent = `${completed} מתוך ${scenes.length} שלבים הושלמו`;
    query('[data-course-progress]').setAttribute('aria-valuenow', String(completed));
    const checked = scenes.filter(s => !!s.check);
    const solved = checked.filter(s => progress(s.id).solved).length;
    const independent = checked.filter(s => independentIds.has(s.id)&&progress(s.id).solved && progress(s.id).hints === 0 && !progress(s.id).revealed && progress(s.id).attempts === 1).length;
    const summary = query('[data-completion]');
    if (summary) summary.textContent = solved
      ? `פתרתם ${solved} מתוך ${checked.length} אתגרים. בשאלות העצמאיות, ${independent} נפתרו בניסיון הראשון בלי פתיחת רמז או פתרון. אפשר לחזור ולתרגל בכל שלב.`
      : 'אפשר לחזור להסבר, לנסות שוב או לבקש רמז. כל צעד קטן מצטרף להבנה.';
  }

  function render(values = params, time = elapsed): void {
    const scene = scenes[active], section = sections[active];
    const state = progress(scene.id);
    const hidden = independentIds.has(scene.id) && !!scene.check && !state.solved&&!state.revealed;
    const questionVisual=['fraction','geometry','data-bars','normal','normal-school'].includes(scene.visual);
    const svg = query<SVGSVGElement>('[data-plot]', section);
    draw(svg, scene.visual, values, scene.xDomain, scene.yDomain, {
      target: scene.check?.kind === 'graph-target' ? scene.check.target : undefined,
      hide: hidden&&!questionVisual,questionOnly:hidden&&questionVisual,
      reference: scene.visual === 'quadratic' && !hidden && scene.phase !== 'challenge' ? [1, 0, 0] : undefined,
    });
    const f = at(scene as unknown as LearningExperience['scenes'][number], time);
    const katex = (window as unknown as { katex?: { renderToString: (tex: string, opts: object) => string } }).katex;
    const formulaElement = query('[data-formula]', section);
    // Generated formulas are compiled server-side. Only trusted numeric engine output is rendered here.
    const controlled = scene.visual !== 'steps';
    if (controlled && katex && (!hidden || scene.check?.kind === 'graph-target')) {
      formulaElement.innerHTML = katex.renderToString(formula(scene.visual, values), { throwOnError: true, trust: false });
    } else {
      const templates = all<HTMLTemplateElement>('[data-formula-template]', section);
      formulaElement.replaceChildren(templates[Math.min(f.frame, templates.length - 1)].content.cloneNode(true));
    }
    let caption = scene.frames[f.frame].caption;
    if (manipulated) {
      const numbers = values.map(value => String(Number(value.toFixed(2))));
      if (hidden) caption = 'הנוסחה למעלה מציגה את הערכים שבחרתם. בדקו שהיא מתאימה לגרף היעד.';
      else if (scene.visual === 'quadratic') caption = `עכשיו הקודקוד ב־\\((${numbers[1]},${numbers[2]})\\), והפרבולה נפתחת ${values[0] > 0 ? 'כלפי מעלה' : 'כלפי מטה'}.`;
      else if (scene.visual === 'linear') caption = `השיפוע עכשיו \\(m=${numbers[0]}\\), והישר חותך את ציר \\(y\\) ב־\\((0,${numbers[1]})\\).`;
      else if (scene.visual === 'number-line') caption = `הנקודה עכשיו ב־\\(${numbers[0]}\\).`;
      else if(scene.visual==='fraction')caption=`צובעים ${values[0]} מתוך ${values[1]} חלקים. מחלקים כל חלק ל־${values[2]} חלקים שווים. כשמשנים רק את החלוקה, הכמות הצבועה נשמרת.`;
      else if(scene.visual==='geometry')caption='המידות החדשות מסומנות בתרשים. הנוסחה מתעדכנת לפי אותן מידות; הגובה מאונך לבסיס.';
      else if(scene.visual==='data-bars')caption=`שינינו שכיחויות. עכשיו יש ${values.reduce((a,b)=>a+b,0)} תצפיות; גובה כל עמודה מציג את השכיחות.`;
      else if(scene.visual==='normal'||scene.visual==='normal-school')caption=`השטח הצבוע נמצא בין ${numbers[2]} ל־${numbers[3]}. ${scene.visual==='normal-school'?'האחוזים הם קירוב בית ספרי ברצועות של חצי s.':'ההסתברות מתעדכנת לפי המודל הנורמלי.'}`;
    }
    rich(query('[data-caption]', section), caption);
    if (scene.visual === 'steps') {
      const step = query('[data-step-formula]', section);
      step.replaceChildren(all<HTMLTemplateElement>('[data-formula-template]', section)[f.frame].content.cloneNode(true));
      rich(query('[data-step-caption]', section), scene.frames[f.frame].caption);
    }
    const coordinate = query('[data-coordinate]', section);
    coordinate.textContent = hidden ? 'האתגר שלכם' : scene.visual === 'quadratic'
      ? `V = (${Number(values[1].toFixed(2))}, ${Number(values[2].toFixed(2))})`
      : scene.visual === 'linear' ? `m = ${Number(values[0].toFixed(2))}` : '';
    query<HTMLInputElement>('[data-timeline]', section).value = String(time);
    query('[data-clock]', section).textContent = `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`;
    all<HTMLButtonElement>('[data-frame-dot]', section).forEach((dot, i) => dot.setAttribute('aria-pressed', String(i === f.frame)));
    all<HTMLInputElement>('[data-param]', section).forEach(input => {
      const value = values[Number(input.dataset.param)];
      input.value = String(value);
      query<HTMLOutputElement>(`[data-output="${input.dataset.param}"]`, section).value = String(Number(value.toFixed(2)));
    });
  }

  function show(index: number, focus = false): void {
    pause(); active = Math.max(0, Math.min(scenes.length - 1, index));
    manipulated = false;
    if (location.hash.startsWith('#scene=')) history.replaceState(null, '', '#scene=' + scenes[active].id);
    elapsed = 0; selected = null; params = scenes[active].frames[0].values.slice();
    if (scenes[active].check?.kind === 'graph-target') {
      const target = scenes[active].check?.target;
      if (target?.every((n,i) => n === params[i])) params[1] = params[1] === 5 ? 4 : params[1] + 1;
    }
    sections.forEach((s, i) => s.hidden = i !== active);
    const section = sections[active], scene = scenes[active], state = progress(scene.id);
    const reasoning=section.querySelector<HTMLTextAreaElement>('[data-reasoning]');if(reasoning)try{reasoning.value=localStorage.getItem(key()+':reason:'+scene.id)??'';}catch{}
    query('[data-current-step]').textContent = `${String(active + 1).padStart(2, '0')} / ${String(scenes.length).padStart(2, '0')}`;
    query('[data-phase-label]').textContent = ({ discover: 'מגלים', explore: 'מנסים', practice: 'מתרגלים', challenge: 'אתגר', reflect: 'מה לקחנו' })[scene.phase];
    query<HTMLButtonElement>('[data-prev]').disabled = active === 0;
    query('[data-next-label]').textContent = active === scenes.length - 1 ? 'חזרה להתחלה' : scene.check && !state.solved ? 'אפשר להמשיך ולחזור לכאן' : 'ממשיכים';
    all<HTMLButtonElement>('[data-option]', section).forEach(o => o.setAttribute('aria-pressed', 'false'));
    if (state.solved && scene.check) feedback(config.demoChecks?.[scene.id]?.success ?? 'כבר פתרתם את האתגר הזה. אפשר לנסות שוב או להמשיך.');
    else feedback('');
    const hint = query('[data-hint-text]', section);
    rich(hint, state.hints && scene.check ? scene.check.hints[Math.min(state.hints, scene.check.hints.length) - 1] : '');
    hint.hidden = !hint.textContent;
    render(); updateProgress(); remember();
    if (focus) { query<HTMLElement>('h1', section).focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: reducedMotion ? 'instant' : 'smooth' }); }
  }

  const localGrade = (check: LearningCheck, value: unknown): boolean => {
    if (check.kind === 'graph-target') return Array.isArray(value) && Array.isArray(check.answer) && value.length === check.answer.length && check.answer.every((n, i) => typeof value[i] === 'number' && Math.abs(n-value[i]) < .025);
    const normalized = String(value ?? '').trim().replace(/[−–]/g, '-').replace(/,/g, '.').replace(/\s/g, '').replace(/[٠-٩]/g, c => String(c.charCodeAt(0)-0x660));
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:\/[+-]?(?:\d+(?:\.\d*)?|\.\d+))?$/.test(normalized)) return false;
    const [a, b] = normalized.split('/').map(Number), n = b === undefined ? a : a / b;
    return Number.isFinite(n) && typeof check.answer === 'number' && Math.abs(n-check.answer) < 1e-7;
  };

  /** Progress lives on this device only; a lesson page never talks to the server. */
  function record(action: string, value?: unknown): void {
    const scene = scenes[active], state = progress(scene.id);
    if (action === 'visit') state.visited = true;
    if (action === 'hint') state.hints = Math.min(scene.check?.hints.length ?? 0, state.hints+1);
    const graded = config.demoChecks?.[scene.id];
    if (action === 'answer' && graded) {
      state.attempts++;
      const correct = localGrade(graded, value);
      state.solved ||= correct;
      feedback(correct ? graded.success : scene.check!.retry, correct ? 'success' : 'retry');
      if (correct) { render(); query('[data-next-label]').textContent = 'ממשיכים'; }
    }
    status.textContent = localStatus;
    updateProgress(); remember();
  }

  function tick(time: number): void {
    if (!playing) return;
    elapsed = Math.min(duration(), elapsed + (previousTime ? time-previousTime : 0)/1000 * speed);
    previousTime = time;
    params = at(scenes[active] as unknown as LearningExperience['scenes'][number], elapsed).values;
    render();
    if (elapsed >= duration()) pause(); else animation = requestAnimationFrame(tick);
  }

  buttons.forEach((button, index) => button.addEventListener('click', () => show(index, true)));
  sections.forEach((section, sceneIndex) => {
    const scene = scenes[sceneIndex];
    query('[data-play]', section).addEventListener('click', () => {
      if (playing) { pause(); return; }
      manipulated = false;
      if (reducedMotion) {
        elapsed = Math.min(duration(), elapsed + 4);
        if (elapsed === duration() && query<HTMLInputElement>('[data-timeline]', section).value === String(duration())) elapsed = 0;
        params = at(scene as unknown as LearningExperience['scenes'][number], elapsed).values; render(); return;
      }
      if (elapsed >= duration()) elapsed = 0;
      playing = true; previousTime = 0;
      query('[data-play]', section).textContent = 'Ⅱ'; query('[data-play]', section).setAttribute('aria-label', 'השהיית ההסבר');
      animation = requestAnimationFrame(tick);
    });
    query('[data-speed]', section).addEventListener('click', () => { speed = speed === 1 ? .5 : 1; query('[data-speed]', section).textContent = `${speed}×`; });
    query<HTMLInputElement>('[data-timeline]', section).addEventListener('input', event => {
      manipulated = false;
      pause(); elapsed = Number((event.target as HTMLInputElement).value);
      params = at(scene as unknown as LearningExperience['scenes'][number], elapsed).values; render();
    });
    all<HTMLButtonElement>('[data-frame-dot]', section).forEach((dot, i) => dot.addEventListener('click', () => {
      manipulated = false;
      pause(); elapsed = i*4; params = scene.frames[i].values.slice(); render();
    }));
    all<HTMLInputElement>('[data-param]', section).forEach(input => input.addEventListener('input', () => {
      pause();
      manipulated = true;
      feedback('');
      const index = Number(input.dataset.param), previous = params[index];
      params[index] = Number(input.value);
      if (scene.visual === 'quadratic' && index === 0 && params[0] === 0) params[0] = previous > 0 ? -(Number(input.step)||1) : (Number(input.step)||1);
      if((scene.visual==='normal'||scene.visual==='normal-school')&&params[2]>=params[3])params[index]=previous;
      if(scene.visual==='data-bars'&&params.reduce((a,b)=>a+b,0)===0)params[index]=previous;
      render();
    }));
    all<HTMLButtonElement>('[data-option]', section).forEach(option => option.addEventListener('click', () => {
      selected = Number(option.dataset.option);
      all('[data-option]', section).forEach(o => o.setAttribute('aria-pressed', String(o === option)));
    }));
    section.querySelector('[data-submit]')?.addEventListener('click', () => {
      if (!scene.check) return;
      let value: unknown = params;
      if (scene.check.kind === 'choice') {
        if (selected === null) { feedback('בחרו תשובה כדי לבדוק אותה.', 'retry'); return; }
        value = selected;
      }
      if (scene.check.kind === 'number') {
        value = query<HTMLInputElement>('[data-number-answer]', section).value;
        if (!String(value).trim()) { feedback('כתבו תשובה כדי לבדוק אותה.', 'retry'); return; }
      }
      record('answer', value);
    });
    section.querySelector('[data-hint]')?.addEventListener('click', () => {
      if (!scene.check) return;
      const state = progress(scene.id);
      const index = Math.min(state.hints, scene.check.hints.length-1);
      const hint = query('[data-hint-text]', section);
      rich(hint, scene.check.hints[index]); hint.hidden = false;
      record('hint');
    });
    section.querySelector<HTMLTextAreaElement>('[data-reasoning]')?.addEventListener('input',event=>{
      try{localStorage.setItem(key()+':reason:'+scene.id,(event.target as HTMLTextAreaElement).value);}catch{status.textContent='לא ניתן לשמור את הטיוטה במכשיר הזה.';}
    });
    section.querySelector<HTMLInputElement>('[data-number-answer]')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') query<HTMLButtonElement>('[data-submit]', section).click();
    });
  });
  query('[data-next]').addEventListener('click', () => {
    record('visit');
    show(active === scenes.length-1 ? 0 : active+1, true);
  });
  query('[data-prev]').addEventListener('click', () => show(active-1, true));
  all('[data-print]').forEach(b => b.addEventListener('click', () => window.print()));
  all<HTMLButtonElement>('button[data-mode]').forEach(button => button.addEventListener('click', () => {
    all('button[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    root.dataset.mode = button.dataset.mode;
    if (button.dataset.mode === 'practice') show(Math.max(0, scenes.findIndex(s => s.phase === 'practice' || s.phase === 'challenge')), true);
    else show(0, true);
  }));
  const film = query<HTMLDialogElement>('[data-film-dialog]');
  document.querySelector('[data-film-open]')?.addEventListener('click', () => { pause(); film.showModal(); });
  query('[data-film-close]', film).addEventListener('click', () => { query<HTMLVideoElement>('video', film).pause(); film.close(); });
  film.addEventListener('close', () => query<HTMLVideoElement>('video', film).pause());
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('beforeprint', () => {
    pause();
    all<SVGSVGElement>('[data-print-visual]').forEach(svg=>{const [id,index]=svg.dataset.printVisual!.split(':');const s=scenes.find(s=>s.id===id)!;draw(svg,s.visual,s.frames[Number(index)].values,s.xDomain,s.yDomain);});
    all<HTMLElement>('[data-reasoning-print]').forEach(p=>{p.textContent=document.querySelector<HTMLTextAreaElement>(`[data-scene="${p.dataset.reasoningPrint}"] [data-reasoning]`)?.value??'';});
    all<SVGSVGElement>('[data-print-plot]').forEach(svg => {
      const scene = scenes.find(s => s.id === svg.dataset.printPlot)!;
      const questionVisual=['fraction','geometry','data-bars','normal','normal-school'].includes(scene.visual);
      draw(svg, scene.visual, scene.frames[0].values, scene.xDomain, scene.yDomain, { target: scene.check?.target, hide: !questionVisual,questionOnly:questionVisual });
    });
  });
  document.addEventListener('keydown', event => {
    if ((event.target as HTMLElement).matches('input,textarea,button') || film.open) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); query<HTMLButtonElement>('[data-next]').click(); }
    if (event.key === 'ArrowRight' && active > 0) { event.preventDefault(); show(active-1, true); }
  });

  const linkedScene = () => scenes.findIndex(scene => scene.id === new URLSearchParams(location.hash.slice(1)).get('scene'));
  const showInitial = () => {
    const index = linkedScene();
    if (index >= 0) active = index;
    show(active);
  };
  addEventListener('hashchange', () => {
    const index = linkedScene();
    if (index >= 0) show(index, true);
  });
  restore(); showInitial(); status.textContent = localStatus;
}
