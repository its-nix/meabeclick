<script lang="ts">
  /**
   * The tutor's "שיווק" report. See +page.server.ts for the guard and the
   * window computation; this component only renders what that load already
   * decided.
   *
   * Summary line first (visitors / bookings / report-backed completions for the
   * window), then the funnel table grouped source → campaign → content
   * (rows arrive pre-sorted from +page.server.ts's sortRows), then the
   * "איך שמעתם עלינו?" counts. No client-side fetch: the whole page is one
   * server render per `?days=` navigation, exactly like app/plan/[code].
   */
  import MarketingTrends from '$lib/components/MarketingTrends.svelte';
  import { HEARD_FROM_LABELS } from '$lib/marketing-labels.ts';
  import TutorPageHeader from '$lib/components/TutorPageHeader.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const DAY_OPTIONS = [7, 30, 90] as const;

  // funnel()'s own GROUP BY makes a NULL utm_source its own group — see
  // src/lib/server/marketing.ts's doc comment — so this is the one place
  // that turns "no UTM at all" into the label a human reads, per spec.
  const UNTAGGED_SOURCE = 'ישיר / לא מתויג';
  const EMPTY_CELL = '—';

  const sourceLabel = (source: string | null): string => source ?? UNTAGGED_SOURCE;

  // Bookings are plain COUNT()s in funnel() — each event row
  // belongs to exactly one (source, campaign, content) group, so summing
  // them across the already-grouped rows is exact, unlike visitors (below).
  let rowTotals = $derived(
    data.rows.reduce(
      (acc, row) => ({
        bookings: acc.bookings + row.bookings,
      }),
      { bookings: 0 },
    ),
  );

  let heardFromEntries = $derived(Object.entries(data.heardFrom));

  // The one date every "since" mention on this page refers to — when
  // measurement (migration 016) started. One constant so the note and the
  // empty state can never end up naming two different dates.
  const MEASUREMENT_START = '24.9.2026';
</script>

<svelte:head>
  <title>שיווק — לוח בקרה</title>
</svelte:head>

<main class="workspace-page" id="workspace-content" tabindex="-1">
  <TutorPageHeader title="שיווק" description="תמונת הפעילות מהביקור באתר ועד לשיעור השני.">
    {#snippet actions()}
      <nav class="toggle" aria-label="טווח זמן">
        {#each DAY_OPTIONS as d (d)}
          <a class="chip" class:active={data.days === d} href="?days={d}" aria-current={data.days === d ? 'true' : undefined}>{d} ימים</a>
        {/each}
      </nav>
    {/snippet}
  </TutorPageHeader>
  <a class="metrics-link" href="/app/metrics">יעדים והגדרות מדדים <span aria-hidden="true">←</span></a>
  <p class="note">נתונים מאז {MEASUREMENT_START} · אירועים נשמרים 12 חודשים</p>

  <div class="summary">
    <div class="stat">
      <span class="stat-value">{data.visitors}</span>
      <span class="stat-label">מבקרים</span>
    </div>
    <div class="stat">
      <span class="stat-value">{rowTotals.bookings}</span>
      <span class="stat-label">הזמנות</span>
    </div>
    <div class="stat">
      <span class="stat-value">{data.completion.reportedLessons}</span>
      <span class="stat-label">שיעורים עם דיווח</span>
    </div>
    <div class="stat">
      <span class="stat-value">{data.completion.secondLessons}</span>
      <span class="stat-label">שיעור שני מדווח</span>
    </div>
  </div>

  <MarketingTrends days={data.trends} />

  <details class="definitions">
    <summary>איך סופרים את השלבים?</summary>
    <p>הזמנות שנוצרו בטווח הנבחר. שיעור נספר רק עם דיווח מורה ועד סוף הטווח — לא רק כי המועד עבר. בלי דיווח, אין עדות להשתתפות.</p>
    <p>״שיעור שני״ הוא השיעור המדווח השני של התלמיד/ה בכל ההיסטוריה, לפי מועד השיעור. אלו ספירות פעילות, לא אחוזי המרה של קוהורטה.</p>
  </details>

  <h2 class="section-title" id="marketing-sources">מקורות התנועה</h2>
  <p class="table-hint">הטבלה ממשיכה לצדדים — אפשר לגלול כדי לראות את כל השלבים.</p>
  {#if data.rows.length === 0}
    <p class="empty">
      המדידה התחילה ב-{MEASUREMENT_START} — עדיין אין נתונים בטווח הזה. הנתונים
      יופיעו כאן ככל שמשפחות מבקרות באתר.
    </p>
  {:else}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="table-wrap" role="region" aria-labelledby="marketing-sources" tabindex="0">
      <table class="funnel">
        <caption>פעילות לפי מקור, קמפיין ותוכן בטווח הנבחר</caption>
        <thead>
          <tr>
            <th scope="col">מקור</th>
            <th scope="col">קמפיין</th>
            <th scope="col">תוכן</th>
            <th scope="col">מבקרים</th>
            <th scope="col">לחיצות על בדיקת מועד</th>
            <th scope="col">וואטסאפ</th>
            <th scope="col">טלפון</th>
            <th scope="col">התחילו הזמנה</th>
            <th scope="col">הזמנות</th>
            <th scope="col">שיעורים עם דיווח</th>
            <th scope="col">שיעור שני מדווח</th>
          </tr>
        </thead>
        <tbody>
          {#each data.rows as row (`${row.source}|${row.campaign}|${row.content}`)}
            <tr>
              <td>{sourceLabel(row.source)}</td>
              <td>{row.campaign ?? EMPTY_CELL}</td>
              <td>{row.content ?? EMPTY_CELL}</td>
              <td>{row.visitors}</td>
              <td>{row.bookingClicks}</td>
              <td>{row.whatsappClicks}</td>
              <td>{row.phoneClicks}</td>
              <td>{row.bookingsStarted}</td>
              <td>{row.bookings}</td>
              <td>{row.reportedLessons}</td>
              <td>{row.secondLessons}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  <h2 class="section-title">איך שמעתם עלינו?</h2>
  {#if heardFromEntries.length === 0}
    <p class="empty">אין עדיין תשובות בטווח הזה.</p>
  {:else}
    <ul class="heard-from">
      {#each heardFromEntries as [value, count] (value)}
        <li>
          <span>{HEARD_FROM_LABELS[value] ?? value}</span>
          <b>{count}</b>
        </li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  .metrics-link{display:inline-flex;align-items:center;gap:8px;min-height:44px;font-size:.875rem;margin-bottom:12px}

  :global(body) { background: var(--bg-base); }

  .note { font-size: .82rem; color: var(--text-muted); margin: 0 0 14px; }

  .toggle { display: flex; gap: 4px; padding: 4px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-surface); }
  .chip {
    display: inline-flex; align-items: center; justify-content: center;
    min-height: 44px; padding: 6px 16px; border-radius: 7px;
    border: 1px solid transparent;
    color: var(--text-muted-strong); font-family: inherit; font-size: .85rem; font-weight: 700;
    text-decoration: none;
  }
  .chip:hover { color: var(--accent-deep); background: var(--accent-dim); }
  .chip.active { border-color: var(--border); color: var(--accent-deep); background: var(--bg-card); box-shadow: 0 1px 3px var(--shadow); }
  :is(.chip, .table-wrap):focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }

  .summary {
    display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px;
    margin-bottom: 12px;
  }
  .stat {
    display: flex; flex-direction: column; gap: 2px;
    background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--r-md);
    padding: 20px; text-align: start;
  }
  .stat-value {
    font-size: 2rem; font-weight: 700; color: var(--text-primary); line-height: 1.4;
    font-variant-numeric: tabular-nums;
  }
  .stat-label { font-size: .85rem; color: var(--text-muted-strong); }
  .definitions { margin-bottom: 28px; color: var(--text-muted-strong); font-size: .85rem; line-height: 1.7; }
  .definitions summary { min-height: 44px; padding: 10px 0; cursor: pointer; }
  .definitions p { margin: 0 0 8px; }
  .definitions summary:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }

  .empty {
    background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--r-md);
    padding: 20px; font-size: .875rem; color: var(--text-muted); line-height: 1.7;
  }

  .table-wrap {
    overflow-x: auto;
    border: 1px solid var(--border); border-radius: var(--r-md);
    margin-bottom: 28px; background: var(--bg-card);
  }
  table.funnel {
    border-collapse: collapse; width: 100%; min-width: 960px;
    font-size: .84rem;
  }
  table.funnel th, table.funnel td {
    padding: 12px 16px; text-align: start; white-space: nowrap;
    border-bottom: 1px solid var(--border);
  }
  table.funnel thead th {
    background: var(--bg-surface); color: var(--text-muted-strong);
    font-weight: 700; font-size: .8rem; white-space: normal; min-width: 80px;
  }
  table.funnel tbody td { color: var(--text-primary); font-variant-numeric: tabular-nums; }
  table.funnel tbody tr:last-child td { border-bottom: none; }

  .section-title { font-size: 1.15rem; font-weight: 700; color: var(--text-primary); margin: 0 0 12px; }
  caption { text-align: start; padding: 16px; font-weight: 700; }
  .table-hint { display: none; color: var(--text-muted); font-size: .8rem; margin: -4px 0 12px; }

  .heard-from { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .heard-from li {
    display: flex; align-items: center; justify-content: space-between;
    background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--r-md);
    padding: 16px 20px; font-size: .875rem; color: var(--text-primary);
  }
  .heard-from b { font-variant-numeric: tabular-nums; }
  @media(max-width:700px) { .summary { grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; }.stat { padding: 16px; }.table-hint { display: block; } }
</style>
