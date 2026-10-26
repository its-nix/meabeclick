<script lang="ts">
  import BrandMark from '$lib/components/BrandMark.svelte';
  /**
   * Port of pages/app/games.html — the games CATALOG (a tool for picking a
   * template), not a game. Data now arrives already loaded (and gated by
   * requireAuth) from +page.server.ts instead of an unauthenticated client
   * fetch of /games/registry.json.
   */
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let choosing = $state('');
  let chooseError = $state('');
  const lessonDate = $derived(data.selection?.lessonAt
    ? new Date(data.selection.lessonAt).toLocaleDateString('he-IL')
    : 'תאריך לא ידוע');

  async function choose(template: string) {
    if (!data.selection || choosing) return;
    choosing = template;
    chooseError = '';
    try {
      const response = await fetch(`/api/lessons/${encodeURIComponent(data.selection.lessonSlug)}/games`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: data.selection.studentId, template, nodeId: data.selection.nodeId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      location.href = `/app/lessons/${encodeURIComponent(data.selection.lessonSlug)}/edit?game=${encodeURIComponent(result.assignment.id)}`;
    } catch {
      chooseError = 'לא הצלחנו ליצור טיוטה. נסו שוב.';
      choosing = '';
    }
  }
</script>

<svelte:head>
  <title>מאגר המשחקים — מאה בקליק</title>
</svelte:head>

<div class="wrap">
  <div class="page-brand"><BrandMark height={26} /></div>

  <header>
    {#if data.selection}
      <div class="eyebrow">הוספת משחק לשיעור</div>
      <h1>{data.selection.studentName} · {data.selection.lessonTitle} · <bdi dir="ltr">{lessonDate}</bdi></h1>
      <div class="subject">בחרו תבנית. אחר כך נתאים את התוכן לשיעור הזה.</div>
      <a class="back" href="/app/lessons/{data.selection.lessonSlug}/edit">חזרה לשיעור</a>
    {:else}
      <h1>🎮 מאגר המשחקים</h1>
      <div class="subject">כל סוגי המשחקים והדוגמאות שלהם</div>
    {/if}
  </header>

  {#if chooseError}<p class="error" role="alert">{chooseError}</p>{/if}

  <div style="margin-top:1.4rem">
    <h2>מוכנים לשימוש ({data.ready.length})</h2>
    <div class="cards">
    {#each data.ready as t (t.key)}
      <article class="card">
        <div class="row">
          <span class="name">{t.title}</span>
          <span class="pill ready">מוכן</span>
        </div>
        <div class="best">{t.bestFor}</div>
        <div class="meta">גילאים {t.ageRange[0]}–{t.ageRange[1]} · {t.itemRange[0]}–{t.itemRange[1]} פריטים</div>
        {#if t.exampleUrl}
          <div class="card-actions">
            <a class="play secondary" href={t.exampleUrl} target="_blank" rel="noopener">צפייה בדוגמה</a>
            {#if data.selection}
              <button class="choose" onclick={() => choose(t.key)} disabled={!!choosing}>
                {choosing === t.key ? 'יוצרים טיוטה…' : 'בחירת התבנית'}
              </button>
            {:else}
              <code class="url">{t.exampleUrl}</code>
            {/if}
          </div>
        {/if}
      </article>
    {/each}
    </div>

    <h2>מתוכננים ({data.soon.length})</h2>
    {#each data.soon as t (t.key)}
      <div class="card soon">
        <div class="row">
          <span class="name">{t.title}</span>
          <span class="pill soon">בקרוב</span>
        </div>
        <div class="best">{t.bestFor}</div>
        <div class="meta">גילאים {t.ageRange[0]}–{t.ageRange[1]} · {t.itemRange[0]}–{t.itemRange[1]} פריטים</div>
      </div>
    {/each}
  </div>
</div>

<style>
  .wrap { max-width: 820px; margin: 0 auto; padding: 1rem; }
  .page-brand { display: flex; padding-bottom: 0.9rem; }
  header h1 { font-size: 1.6rem; font-weight: 900; }
  .subject { color: var(--text-muted); font-size: .95rem; margin-top: 2px; }
  .eyebrow { color: var(--accent); font-weight: 800; font-size: .8rem; }
  .back { display: inline-flex; min-height: 44px; align-items: center; color: var(--accent); font-weight: 700; }
  .cards { display: grid; gap: .8rem; }

  .card {
    background: var(--bg-card); border: 1.5px solid var(--border);
    border-radius: 16px; padding: 1rem 1.1rem; margin-bottom: 0.8rem;
  }
  .card.soon { opacity: 0.62; }
  .row { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
  .name { font-size: 1.1rem; font-weight: 900; }
  .pill {
    font-size: 0.7rem; font-weight: 800; border-radius: 999px; padding: 2px 10px;
  }
  .pill.ready { background: var(--accent3-dim); color: var(--accent3-strong); }
  .pill.soon  { background: var(--border); color: var(--text-muted); }
  .best { color: var(--text-muted); font-size: 0.9rem; margin: 0.35rem 0 0.6rem; line-height: 1.5; }
  .meta { color: var(--text-muted); font-size: 0.78rem; }
  .play {
    display: inline-flex; align-items: center; gap: 5px;
    background: var(--accent2); color: #1E293B; text-decoration: none;
    border-radius: 999px; padding: 0.5rem 1.1rem; min-height: 44px;
    font-weight: 800; font-size: 0.88rem;
  }
  .play:hover { opacity: 0.9; }
  .card-actions { margin-top: .7rem; display: flex; gap: .6rem; flex-wrap: wrap; align-items: center; }
  .secondary { background: var(--bg-card); border: 1px solid var(--border-strong); color: var(--text-primary); }
  .choose { min-height: 44px; padding: .5rem 1.1rem; border: 0; border-radius: 999px; background: var(--accent); color: white; font: inherit; font-weight: 800; cursor: pointer; }
  .choose:disabled { opacity: .55; cursor: default; }
  .error { color: var(--danger); font-weight: 700; }
  .url {
    display: block; margin-top: 0.55rem; direction: ltr; text-align: left;
    background: var(--accent-dim); color: var(--accent);
    border-radius: 8px; padding: 0.4rem 0.6rem;
    font-size: 0.76rem; word-break: break-all; font-family: ui-monospace, monospace;
  }
  h2 { font-size: 1rem; color: var(--text-muted); margin: 1.6rem 0 0.7rem; font-weight: 700; }
  @media (min-width: 900px) {
    .wrap { max-width: 1100px; }
    .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
</style>
