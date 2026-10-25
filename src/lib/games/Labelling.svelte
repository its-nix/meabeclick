<script lang="ts">
  import FormulaText from '$lib/components/FormulaText.svelte';
  /** Tutor-authored SVG is untrusted. Parse it into a deliberately small
   * SVG subset instead of handing markup to a raw HTML rendering API. */
  import { getContext, onMount } from 'svelte';
  import { GAME_CONTEXT_KEY, type GameEngineContext, type GameData } from './engine.ts';

  type Target = { id: string; label: string };
  type LabelBtn = { id: string; label: string; used: boolean; flash: boolean };

  const ALLOWED_SVG_ELEMENTS = new Set([
    'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon',
    'text', 'tspan', 'title', 'desc',
  ]);
  const ALLOWED_SVG_ATTRIBUTES = new Set([
    'xmlns', 'viewbox', 'preserveaspectratio', 'width', 'height',
    'id', 'class', 'd', 'points', 'transform',
    'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
    'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity',
    'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'opacity',
    'font-size', 'font-weight', 'text-anchor', 'dominant-baseline',
  ]);

  let { data }: { data: GameData } = $props();
  const engine = getContext<GameEngineContext>(GAME_CONTEXT_KEY);
  const svgMarkup = (data.svg as string | undefined) ?? '';
  const targets = (data.targets as Target[] | undefined) ?? [];

  let diagramEl: HTMLDivElement | undefined = $state();
  let labelBtns = $state<LabelBtn[]>([]);
  let solved = $state(0);
  let wrong = $state(0);
  let hint = $state('לחצו על חלק בתרשים, ואז על התווית המתאימה');
  let noMatch = $state(false);
  const missed: string[] = [];
  const elapsed = $derived(engine.secs());

  let activeNode: Element | null = null;
  let activeTarget: Target | null = null;
  let attached = false;
  let diagramReady = $state(false);

  function safeSvg(markup: string): SVGElement | null {
    const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
    const root = parsed.documentElement;
    if (root.localName !== 'svg' || parsed.querySelector('parsererror')) return null;

    for (const element of [root, ...root.querySelectorAll('*')]) {
      if (!ALLOWED_SVG_ELEMENTS.has(element.localName)) {
        element.remove();
        continue;
      }
      for (const attribute of [...element.attributes]) {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.toLowerCase();
        if (!ALLOWED_SVG_ATTRIBUTES.has(name) || /javascript:|data:|url\s*\(/.test(value)) {
          element.removeAttribute(attribute.name);
        }
      }
    }
    return root as unknown as SVGElement;
  }

  onMount(() => {
    if (!diagramEl || !svgMarkup) return;
    const svg = safeSvg(svgMarkup);
    if (!svg) {
      noMatch = true;
      return;
    }
    diagramEl.replaceChildren(document.importNode(svg, true));
    diagramReady = true;
    return () => diagramEl?.replaceChildren();
  });

  $effect(() => {
    if (!diagramEl || !diagramReady || attached || !targets.length) return;
    attached = true;

    let found = 0;
    for (const t of targets) {
      const node = diagramEl.querySelector('#' + CSS.escape(t.id));
      if (!node) continue;
      found++;
      node.setAttribute('data-target', t.id);
      node.addEventListener('click', () => selectTarget(node, t));
      /* Reachable by keyboard too. Named by number: its label is the answer. */
      node.setAttribute('tabindex', '0');
      node.setAttribute('role', 'button');
      node.setAttribute('aria-label', `חלק ${found}`);
      node.addEventListener('keydown', (e) => {
        const key = (e as KeyboardEvent).key;
        if (key !== 'Enter' && key !== ' ') return;
        e.preventDefault();
        selectTarget(node, t);
      });
    }
    if (!found) {
      noMatch = true;
      return;
    }

    labelBtns = engine.shuffle(targets.map((t) => ({ id: t.id, label: t.label, used: false, flash: false })));
    engine.startTimer();
  });

  function selectTarget(node: Element, t: Target) {
    if (node.classList.contains('solved')) return;
    diagramEl?.querySelectorAll('[data-target]').forEach((n) => n.classList.remove('active'));
    node.classList.add('active');
    activeNode = node;
    activeTarget = t;
    tell('עכשיו בחרו את התווית המתאימה');
  }

  /** The hint line is this game's only feedback: shown, and said. */
  function tell(text: string) {
    hint = text;
    engine.say(text);
  }

  function selectLabel(btn: LabelBtn) {
    if (btn.used) return;
    if (!activeNode || !activeTarget) {
      tell('קודם לחצו על חלק בתרשים');
      return;
    }

    if (btn.id === activeTarget.id) {
      activeNode.classList.remove('active');
      activeNode.classList.add('solved');
      btn.used = true;
      solved++;
      tell('יפה! ממשיכים לחלק הבא');
      activeNode = null;
      activeTarget = null;
      if (solved === targets.length) setTimeout(end, 500);
    } else {
      wrong++;
      missed.push(activeTarget.label);
      tell('לא התווית הזאת — נסו אחרת');
      btn.flash = true;
      setTimeout(() => { btn.flash = false; }, 500);
    }
  }

  function end() {
    engine.finish({
      template: 'labelling',
      score: Math.max(0, targets.length - wrong),
      total: targets.length,
      extraLine: wrong ? `${wrong} טעויות` : 'בלי טעויות!',
      missed: [...new Set(missed)],
    });
  }
</script>

{#if !svgMarkup || !targets.length}
  <div class="msg">חסר תרשים או תוויות בקובץ המשחק.</div>
{:else if noMatch}
  <div class="msg">התוויות בקובץ לא מתאימות לתרשים.</div>
{:else}
  <div class="stats">
    <div class="stat"><div class="stat-val">{solved}/{targets.length}</div><div class="stat-lbl">תוויות</div></div>
    <div class="stat"><div class="stat-val">{wrong}</div><div class="stat-lbl">טעויות</div></div>
    <div class="stat"><div class="stat-val">{engine.fmt(elapsed)}</div><div class="stat-lbl">זמן</div></div>
  </div>
  <div class="progress-outer"><div class="progress-inner" style="width: {(solved / targets.length) * 100}%"></div></div>

  <div class="prompt">מה זה החלק הזה? 🏷️</div>
  <div class="hint">{hint}</div>
  <div class="diagram" bind:this={diagramEl}></div>
  <div class="labels">
    {#each labelBtns as b (b.id + b.label)}
      <button class="label" class:used={b.used} class:flash={b.flash} onclick={() => selectLabel(b)}><FormulaText text={b.label} /></button>
    {/each}
  </div>
{/if}

<style>
  .diagram {
    background: var(--bg-card); border: 2px solid var(--border); border-radius: 16px;
    padding: 12px; margin: 0.3rem 0 1rem; overflow-x: auto;
  }
  :global(.diagram svg) { width: 100%; height: auto; display: block; max-width: 460px; margin: 0 auto; }
  :global(.diagram [data-target]) { cursor: pointer; }
  :global(.diagram [data-target]:hover) { filter: brightness(0.92); }
  :global(.diagram [data-target].active) { stroke: #2563eb; stroke-width: 4; }
  :global(.diagram [data-target].solved) { stroke: #10b981; stroke-width: 4; }
  :global(.diagram [data-target]:focus-visible) { outline: 3px solid #b45309; outline-offset: 2px; }

  .labels { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
  .label {
    background: var(--bg-card); border: 2px solid var(--border); border-radius: 999px;
    padding: 9px 18px; font-size: 0.92rem; font-weight: 700; cursor: pointer; transition: all 0.15s;
    font-family: inherit;
  }
  .label:hover:not(.used) { border-color: var(--accent); background: var(--accent-dim); }
  .label.used { opacity: 0.35; cursor: default; text-decoration: line-through; }
  .label.flash { border-color: var(--danger); }
</style>
