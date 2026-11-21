<script lang="ts">
  import Icon from '$lib/icons/Icon.svelte';
  let { data } = $props();
  const kindLabel: Record<string, string> = { quiz: 'חידון', region: 'סימון על הגרף', axis: 'ציר' };
</script>

<svelte:head><title>המשחקים שלי · מאה בקליק</title></svelte:head>

<main class="wrap" dir="rtl">
  <a class="back" href="/app/student" aria-label="חזרה לדף שלי" title="חזרה לדף שלי"><Icon name="dashboard" size={22} /></a>
  <header>
    <p class="eyebrow">שלום {data.name}</p>
    <h1>המשחקים שלי</h1>
  </header>
  {#if !data.lessons.length}
    <p class="empty">עוד אין משחקים. כשהמורה תאשר תרגול הוא יופיע כאן.</p>
  {/if}
  {#each data.lessons as lesson (lesson.bookingId)}
    <section class="group" aria-label="שיעור {lesson.bookingId}">
      <ul>
        {#each lesson.games as game (game.id)}
          <li>
            <a class="card" href="/app/student/games/{lesson.bookingId}/{encodeURIComponent(game.id)}">
              <span class="meta">{kindLabel[game.kind] ?? 'משחק'} · {game.rounds} שאלות</span>
              <strong>{game.title}</strong>
              <span class="intro">{game.intro}</span>
            </a>
          </li>
        {/each}
      </ul>
    </section>
  {/each}
</main>

<style>
  .wrap { max-width: 640px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { font-size: 1.875rem; line-height: 1.25; font-weight: 700; margin-top: 4px; }
  .eyebrow { font-size: .8125rem; font-weight: 500; color: var(--text-muted); }
  header { margin-bottom: 24px; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
  .card { display: block; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 20px; color: inherit; text-decoration: none; min-height: 44px; }
  .card:focus-visible { outline: 2px solid var(--action-fill); outline-offset: 2px; }
  .card strong { display: block; font-size: 1.125rem; margin-block: 4px; }
  .meta, .intro { display: block; font-size: .875rem; color: var(--text-muted); }
  .back { display: inline-grid; place-items: center; width: 44px; height: 44px; margin-bottom: 12px; border-radius: var(--radius-pill); border: 1px solid var(--border); background: var(--bg-card); color: inherit; text-decoration: none; }
  .back:focus-visible { outline: 2px solid var(--action-fill); outline-offset: 2px; }
  .empty { color: var(--text-muted); }
</style>
