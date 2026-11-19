<script lang="ts">
  /**
   * Progress as the family reads it: the headline in words, the bar, the
   * skills behind it by name, and the tutor's note. Shared by the parent
   * view (about a child) and the self-learner's home (about themselves).
   */
  import SectionCard from './SectionCard.svelte';
  import { progressWords as wordsFor, type Audience } from '$lib/family-format.ts';
  import type { ProgressFacts } from '$lib/progress-facts.ts';

  let { progress, audience, hidden = false, headless = false }: {
    progress?: ProgressFacts | null; audience: Audience; hidden?: boolean; headless?: boolean;
  } = $props();

  const seen = $derived(progress?.seen ?? null);
  const words = $derived(wordsFor(progress, audience));
</script>

<SectionCard icon="progress" title={audience === 'learner' ? 'ההתקדמות שלי' : 'התקדמות'} {hidden} {headless}>
  <div class="progress-overall">
    <div class="po-top">
      <!-- Says WHAT is counted: a homework count is never called understanding. -->
      <span class="po-label">{words}</span>
      <!-- `percent`, not the object: "[object Object]%" shipped once. -->
      {#if progress?.total}<span class="po-pct">{progress.percent}%</span>{/if}
    </div>
    <!-- Nothing counted yet: no bar. A 0% bar beside «עוד אין מה למדוד»
         reads as a verdict. -->
    {#if progress?.total}
      <div class="bar-bg"><div class="bar-fill" style="width:{progress.percent}%"></div></div>
    {/if}
    <!-- The skills behind the number, by name (PRODUCT.md, "Progress parents
         can see"). Server computed — see seenIn() in src/lib/server/progress.ts. -->
    {#if seen && (seen.understood.length || seen.covered.length)}
      <div class="seen">
        {#if seen.understood.length}
          <div class="seen-group">
            <div class="seen-title">מה כבר הובן</div>
            <ul>
              {#each seen.understood as u (u.title)}
                <li><span>{u.title}</span><span class="seen-tag">{u.label}</span></li>
              {/each}
            </ul>
          </div>
        {/if}
        {#if seen.covered.length}
          <div class="seen-group">
            <div class="seen-title">נלמד בשיעורים, עוד בדרך</div>
            <ul>
              {#each seen.covered as title (title)}
                <li><span>{title}</span></li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
    {/if}
  </div>
  {#if progress?.note}
    <!-- The tutor's note is for the parent, or for the adult learning for themselves. -->
    <div class="notes-card"><p class="notes-text">{progress.note}</p></div>
  {/if}
</SectionCard>

<style>
  .progress-overall { background:var(--bg-card);border:1px solid var(--border);border-radius:var(--r-lg);padding:20px;margin-bottom:12px; }
  .po-top { display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:12px; }
  .po-label { font-size: 0.9rem; font-weight: 700; color: var(--text-primary); }
  .po-pct { font-size:1rem;font-weight:600;color:var(--text-muted); }
  .bar-bg { height:6px;background:var(--control-bg);border-radius:6px;overflow:hidden; }
  .bar-fill { height:100%;background:var(--action-fill);border-radius:6px;transition:width var(--motion-normal); }
  .seen { display: grid; gap: 14px; margin-top: 16px; }
  .seen-title { font-size: 0.85rem; font-weight: 700; color: var(--text-muted-strong); margin-bottom: 6px; }
  .seen ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .seen li { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; font-size: 0.92rem; color: var(--text-primary); }
  .seen li > span:first-child { min-width: 0; overflow-wrap: anywhere; }
  .seen-tag { flex: none; font-size: 0.78rem; font-weight: 700; color: var(--accent); background: var(--accent-dim); border-radius: var(--r-sm); padding: 2px 8px; }
  .notes-card { padding:4px 4px 0;font-size:.9375rem;color:var(--text-muted-strong);line-height:1.75; }
  .notes-text { margin: 0; white-space: pre-line; }
</style>
