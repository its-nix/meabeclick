<script lang="ts">
  import FormulaText from '$lib/components/FormulaText.svelte';
  /**
   * Port of games/graph-match.html. `plot()` still builds a raw SVG
   * string — it's just markup (viewBox/line/polyline), no user text, so
   * `{@html}` is the natural fit, same call this game.js template made.
   * Because that markup lands via `{@html}` rather than Svelte's own
   * template, none of it carries Svelte's scoping class — every selector
   * that reaches into it below is wrapped in `:global(...)`.
   *
   * The option order below is shuffled with a seed derived from the
   * round's own data (`seededShuffle`), not `engine.shuffle`'s
   * `Math.random()`. This route now renders with SSR (unlike the old
   * client-only fetch template), so the component's init logic runs
   * twice — once on the server, once again during client hydration. A
   * `Math.random()`-based shuffle picks a different order each time,
   * which for ordinary Svelte bindings just causes a harmless one-time
   * DOM patch, but for an `{@html}` block Svelte compares the exact
   * string and logs `hydration_html_changed` when they differ. Seeding
   * from the round's own content makes both passes agree, since they're
   * looking at the same data either way.
   */
  import { getContext } from 'svelte';
  import { GAME_CONTEXT_KEY, offersHints, verdict, type GameEngineContext, type GameData } from './engine.ts';
  import { QUESTION_SESSION_LENGTH, isAdaptiveBank, selectQuestion, questionEvidence, type QuestionMetadata, type QuestionEvidence } from './adaptive.ts';
  import RoundHint from './RoundHint.svelte';
  import { GRAPH_PLOT, graphRoundScale, graphPlotPoints, graphY, type GraphScale } from './graph-match-plot.ts';

  type Round = QuestionMetadata & { prompt: string; mainLabel?: string; main: number[]; options: number[][]; answer: number; why?: string; hint?: string };
  type OptBtn = { svg: string; label: string; correct: boolean; state: 'idle' | 'correct' | 'wrong' };

  let { data }: { data: GameData } = $props();
  const engine = getContext<GameEngineContext>(GAME_CONTEXT_KEY);
  const bank = (data.rounds as Round[] | undefined) ?? [];
  const adaptive = isAdaptiveBank(bank);
  let rounds = $state(adaptive ? bank.slice(0, QUESTION_SESSION_LENGTH) : bank);
  const evidence: QuestionEvidence[] = [];
  let roundHintsStart = 0;
  function selectRound() {
    if (adaptive) rounds[idx] = selectQuestion(bank, evidence)!;
    roundHintsStart = hintsUsed;
  }
  function recordAnswer(correct: boolean) {
    if (adaptive) evidence.push(questionEvidence(rounds[idx], correct, hintsUsed - roundHintsStart));
  }

  let idx = $state(0);
  let score = $state(0);
  let answered = $state(false);
  /** Hints the child asked for — see RoundHint.svelte. */
  let hintsUsed = $state(0);
  let mainSvg = $state('');
  let opts = $state<OptBtn[]>([]);
  let whyText = $state('');
  const missed: string[] = [];
  const elapsed = $derived(engine.secs());

  function plot(ys: number[], color: string, scale: GraphScale): string {
    const { width: W, height: H, left, right, top, bottom } = GRAPH_PLOT;
    const zero = graphY(0, scale).toFixed(1);
    const ticks = [...new Set([scale.hi, 0, scale.lo])].map(value => {
      const y = graphY(value, scale).toFixed(1);
      const label = Number(value.toPrecision(4)).toString();
      return `<text x="${left - 5}" y="${y}" dy="0.35em" font-size="10" text-anchor="end" direction="ltr" fill="#64748B">${label}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="y: ${scale.lo} … ${scale.hi}">
      <rect width="${W}" height="${H}" fill="none"/>
      <line x1="${left}" y1="${zero}" x2="${W - right}" y2="${zero}" stroke="#CBD5E1" stroke-width="1"/>
      <line x1="${(left + W - right) / 2}" y1="${top}" x2="${(left + W - right) / 2}" y2="${H - bottom}" stroke="#CBD5E1" stroke-width="1"/>
      ${ticks}
      <polyline points="${graphPlotPoints(ys, scale)}" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  function hashSeed(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function seededShuffle<T>(items: T[], seed: number): T[] {
    let s = seed || 1;
    const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const a = items.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function renderRound() {
    selectRound();
    answered = false;
    whyText = '';
    const r = rounds[idx];
    const scale = graphRoundScale([r.main, ...r.options]);
    mainSvg = plot(r.main, '#2563EB', scale);
    const order = seededShuffle(
      r.options.map((ys, i) => ({ ys, correct: i === r.answer })),
      hashSeed(r.prompt + idx),
    );
    opts = order.map((o) => ({ svg: plot(o.ys, '#1E293B', scale), label: '', correct: o.correct, state: 'idle' as const }));
    opts.forEach((o, i) => (o.label = 'אבגד'[i] ?? String(i + 1)));
  }

  function choose(o: OptBtn) {
    if (answered) return;
    answered = true;
    recordAnswer(o.correct);
    opts.forEach((x) => { if (x.correct) x.state = 'correct'; });
    if (o.correct) score++;
    else { o.state = 'wrong'; missed.push(rounds[idx].prompt); }
    whyText = rounds[idx].why ?? '';
    const right = opts.find((x) => x.correct);
    engine.say(verdict(o.correct, { answer: right && `גרף ${right.label}`, note: whyText }));
  }

  function next() {
    idx++;
    if (idx < rounds.length) renderRound();
    else engine.finish({ template: 'graph-match', score, total: rounds.length, missed, ...(adaptive ? { questionEvidence: evidence } : {}), ...(offersHints(rounds) ? { hints: hintsUsed } : {}) });
  }

  if (rounds.length) {
    engine.startTimer();
    renderRound();
  }
</script>

{#if !rounds.length}
  <div class="msg">אין שאלות בקובץ המשחק.</div>
{:else}
  <div class="stats">
    <div class="stat"><div class="stat-val">{idx + 1}/{rounds.length}</div><div class="stat-lbl">שאלה</div></div>
    <div class="stat"><div class="stat-val">{score}</div><div class="stat-lbl">נכונות</div></div>
    <div class="stat"><div class="stat-val">{engine.fmt(elapsed)}</div><div class="stat-lbl">זמן</div></div>
  </div>
  <div class="progress-outer"><div class="progress-inner" style="width: {((idx + 1) / rounds.length) * 100}%"></div></div>

  <div class="prompt"><FormulaText text={rounds[idx].prompt} /></div>
  <div class="main-graph">
    <div class="cap">{rounds[idx].mainLabel || 'f(x)'}</div>
    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    {@html mainSvg}
  </div>
  <div class="grid">
    {#each opts as o, i (i)}
      <button
        class="gopt"
        class:correct={o.state === 'correct'}
        class:wrong={o.state === 'wrong'}
        disabled={answered}
        onclick={() => choose(o)}
      >
        <div class="lbl"><FormulaText text={o.label} />.{#if o.state === 'correct'}<span class="mark">✓</span>{:else if o.state === 'wrong'}<span class="mark">✗</span>{/if}</div>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html o.svg}
      </button>
    {/each}
  </div>
  {#key idx}
    <RoundHint hint={rounds[idx]?.hint} locked={answered} onuse={() => hintsUsed++} />
  {/key}
  {#if whyText}<div class="why"><FormulaText text={whyText} /></div>{/if}
  {#if answered}
    <div style="text-align:center">
      <button class="btn" onclick={next}>{idx + 1 < rounds.length ? 'הבא ←' : 'סיום 🏁'}</button>
    </div>
  {/if}
{/if}

<style>
  .main-graph {
    background: var(--bg-card); border: 1.5px solid var(--border);
    border-radius: 16px; padding: 0.6rem; margin-bottom: 1rem;
  }
  .main-graph .cap { text-align: center; font-weight:600; color: var(--accent); margin-bottom: 0.2rem; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
  .gopt {
    background: var(--bg-card); border: 2px solid var(--border); border-radius: 14px;
    padding: 0.4rem; cursor: pointer; font-family: inherit; width: 100%;
  }
  .gopt:hover:not(:disabled) { border-color: var(--accent); }
  .gopt:disabled { cursor: default; }
  .gopt.correct { border-color: var(--accent3); background: var(--accent3-dim); }
  .gopt.wrong { border-color: var(--danger); background: var(--danger-dim); animation: shake 0.4s; }
  .gopt:focus-visible { outline: 3px solid var(--accent2-strong); outline-offset: 3px; }
  .gopt .lbl { font-size: 0.8rem; font-weight:600; color: var(--text-muted); }
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-6px); }
    75% { transform: translateX(6px); }
  }
  /* Injected via {@html} — not part of the compiled template, so Svelte's
     scoping class never lands on it. Must be :global to have any effect. */
  :global(.main-graph svg),
  :global(.gopt svg) { display: block; width: 100%; height: auto; }
</style>
