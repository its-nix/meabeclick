<script lang="ts">
  import { metricGroups } from '$lib/tutor-metrics.ts';
</script>

<svelte:head>
  <title>יעדים והגדרות מדדים — מאה בקליק</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main dir="rtl" lang="he">
  <a class="back" href="/app/dashboard">חזרה ללוח הבקרה ולטיפול בתקלות</a>
  <header>
    <h1>יעדים והגדרות מדדים</h1>
    <p class="notice">הגדרות ויעדים בלבד — הנתונים בפועל אינם זמינים.</p>
    <p>אין תמונת מצב מצרפית מאושרת. לא נקראים מקורות נתונים ולא מחושבים ערכים במסך זה. נתון לא ידוע אינו אפס ואינו אישור שהכול תקין.</p>
    <p>עדכון נתונים אחרון: לא ידוע. נדרשת תמונת מצב מצרפית בלבד, מאושרת ומסוננת לפרטיות, לפני הצגת ערכים בפועל.</p>
    <p>יעדי המוצר לתאריך <bdi dir="ltr">31.03.2027</bdi> מוצגים בנפרד מהמצב בפועל. הגישה נשארת לממשק המורים המוגן הקיים, ללא הרחבת הרשאות.</p>
  </header>
  <nav aria-label="קבוצות מדדים">
    {#each metricGroups as group}
      <a href="#{group.id}">{group.title}</a>
    {/each}
  </nav>
  <aside aria-labelledby="windows-title">
    <h2 id="windows-title">תקופות המדידה</h2>
    <p>״30 הימים שחלפו״ ו־״24 השעות שחלפו״ הם משכי זמן רציפים לפי רגעי זמן ב־<bdi dir="ltr">UTC</bdi>: אחרי הגבול התחתון ועד רגע המדידה, כולל. אלה אינם ימים קלנדריים מקומיים.</p>
    <p>החודש הקלנדרי הקודם מיוחס לפי <bdi dir="ltr">Asia/Jerusalem</bdi>; תאריכים מוצגים לפי שעון ישראל. אין כאן חלון שבועי חדש או תאריכי מדידה בפועל.</p>
  </aside>
  {#each metricGroups as group}
    <section id={group.id} aria-labelledby="heading-{group.id}">
      <h2 id="heading-{group.id}">{group.title}</h2>
      <p>{group.description}</p>
      <div class="cards">
        {#each group.metrics as metric}
          <article aria-labelledby="metric-{metric.id}" data-availability={metric.availability}>
            <h3 id="metric-{metric.id}">{metric.label}</h3>
            <dl>
              <dt>בפועל</dt>
              <dd class="unknown">לא ידוע — הנתון לא זמין <span>(<bdi dir="ltr">UNKNOWN / NOT_AVAILABLE</bdi>)</span></dd>
              {#if metric.target}
                {#if metric.id === 'gate'}
                  <dt>סף אמינות מחייב כעת</dt>
                {:else}
                  <dt>יעד · <bdi dir="ltr">31.03.2027</bdi></dt>
                {/if}
                <dd>{metric.target}</dd>
              {/if}
              <dt>הגדרה</dt><dd>{metric.definition}</dd>
              <dt>תקופה</dt><dd>{metric.window}</dd>
            </dl>
            <details>
              <summary>למה הנתון לא זמין?</summary>
              <p>{metric.reason}</p>
              <p>מועד עדכון: לא ידוע. אין ערך שנמדד, גם לא אפס.</p>
            </details>
          </article>
        {/each}
      </div>
    </section>
  {/each}
  <footer>
    <p>מקור ההגדרות: יעדי המוצר ובדיקת מקורות המדדים. מדדים שטרם הוגדרו לא יחושבו ללא אישור נפרד.</p>
    <a class="back" href="/app/dashboard">חזרה ללוח הבקרה</a>
    <a class="back" href="/app/marketing">לדוח השיווק הקיים</a>
  </footer>
</main>

<style>
  main { max-inline-size: 72rem; margin-inline: auto; padding: 1rem; color: var(--text-primary); overflow-wrap: anywhere; }
  header, aside, footer { margin-block: 1.5rem; }
  h1 { font-size: clamp(1.6rem, 5vw, 2.2rem); }
  h2 { font-size: 1.4rem; }
  h3 { font-size: 1.15rem; margin-block: 0 1rem; }
  p, dd { line-height: 1.7; }
  .notice, .unknown { font-weight: 700; }
  .unknown span { display: block; font-weight: 400; font-size: 0.875rem; }
  nav { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; }
  a { color: var(--accent-deep); text-underline-offset: 0.2em; }
  nav a, .back { display: inline-flex; align-items: center; min-block-size: 44px; padding-inline: 0.25rem; }
  a:focus-visible, summary:focus-visible { outline: 3px solid var(--accent-deep); outline-offset: 3px; border-radius: 3px; }
  aside { padding: 1rem; border-inline-start: 4px solid var(--accent-deep); background: var(--bg-surface); }
  section { margin-block: 2rem; scroll-margin-block-start: 1rem; }
  .cards { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem; }
  article { min-inline-size: 0; background: var(--bg-card); border: 1px solid var(--border-strong); border-radius: 12px; padding: 1rem; }
  dl { margin: 0; }
  dt { font-weight: 700; margin-block-start: 0.75rem; }
  dd { margin-inline: 0; margin-block: 0.25rem 0.75rem; }
  summary { cursor: pointer; min-block-size: 44px; padding-block: 0.75rem; }
  footer { border-block-start: 1px solid var(--border-strong); }
  footer a { margin-inline-end: 1rem; }
  @media (min-width: 48rem) { .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
