<script lang="ts">
  import Icon from '$lib/icons/Icon.svelte';
  import BottomNav, { type NavItem } from '$lib/components/BottomNav.svelte';
  import { STUDENT_GAMES_PATH } from '$lib/native-links.ts';
  let { data } = $props();
  const kindLabel: Record<string, string> = { quiz: 'חידון', region: 'סימון על הגרף', axis: 'ציר' };
  const baseHref = $derived(`/app/student?s=${encodeURIComponent(data.code)}`);
  const navItems = $derived<NavItem[]>(
    data.isSelf
      ? [
          { id: 'home',     label: 'בית',        icon: 'portal',   href: `${baseHref}&v=home` },
          { id: 'hw',       label: 'שיעורי בית',  icon: 'homework', href: `${baseHref}&v=hw` },
          { id: 'progress', label: 'התקדמות',    icon: 'progress', href: `${baseHref}&v=progress` },
          { id: 'payments', label: 'תשלומים',    icon: 'payments', href: `${baseHref}&v=payments` },
        ]
      : [
          { id: 'home',  label: 'בית',        icon: 'portal',   href: `${baseHref}&v=home` },
          { id: 'hw',    label: 'שיעורי בית',  icon: 'homework', href: `${baseHref}&v=hw` },
          { id: 'games', label: 'משחקים',      icon: 'games',    href: STUDENT_GAMES_PATH },
          { id: 'ask',   label: 'שאלה',        icon: 'message',  href: `${baseHref}&v=ask` },
        ],
  );
</script>

<svelte:head><title>המשחקים שלי · מאה בקליק</title></svelte:head>

<main class="wrap" dir="rtl">
  <a class="back" href="/app/student" aria-label="חזרה לדף שלי"><Icon name="dashboard" size={18} /><span>חזרה לדף שלי</span></a>
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

<BottomNav items={navItems} active={data.isSelf ? '' : 'games'} />

<style>
  .wrap { max-width: 640px; margin: 0 auto; padding: 24px 16px calc(var(--bottom-nav-height, 80px) + max(12px, env(safe-area-inset-bottom)) + 32px); }
  h1 { font-size: 1.875rem; line-height: 1.25; font-weight: 700; margin-top: 4px; }
  .eyebrow { font-size: .8125rem; font-weight: 500; color: var(--text-muted); }
  header { margin-bottom: 24px; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
  .card { display: block; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 20px; color: inherit; text-decoration: none; min-height: 44px; }
  .card:focus-visible { outline: 2px solid var(--action-fill); outline-offset: 2px; }
  .card strong { display: block; font-size: 1.125rem; margin-block: 4px; }
  .meta, .intro { display: block; font-size: .875rem; color: var(--text-muted); }
  .back { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 16px; margin-bottom: 12px; border-radius: var(--radius-pill); border: 1px solid var(--border); background: var(--bg-card); color: inherit; text-decoration: none; font-size: .9rem; font-weight: 600; }
  .back:focus-visible { outline: 2px solid var(--action-fill); outline-offset: 2px; }
  .empty { color: var(--text-muted); }
</style>
