<script lang="ts">
  import type { MarketingDay } from '$server/marketing-trends.ts';
  let { days }: { days: MarketingDay[] } = $props();

  const money = (agorot: number) => new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 2 }).format(agorot / 100);
  const dateLabel = (date: string) => `${Number(date.slice(8))}.${Number(date.slice(5, 7))}`;
  const x = (i: number) => 42 + i * 550 / Math.max(1, days.length - 1);
  const y = (value: number, max: number) => 170 - value * 140 / Math.max(1, max);
  let activityMax = $derived(Math.max(1, ...days.flatMap(d => [d.visitors, d.bookings])));
  let activityTicks = $derived([...new Set([0, Math.ceil(activityMax / 2), activityMax])]);
  const axisMoney = (agorot: number) => new Intl.NumberFormat('he-IL', { notation: 'compact', maximumFractionDigits: 1 }).format(agorot / 100);
  let paymentMax = $derived(Math.max(100, ...days.flatMap(d => [d.paidAgorot, d.owedAgorot])));
  let paid = $derived(days.reduce((n, d) => n + d.paidAgorot, 0));
  let owed = $derived(days.reduce((n, d) => n + d.owedAgorot, 0));
  let hasActivity = $derived(days.some(d => d.visitors || d.bookings));
  let activityPoints = $derived(days.map((d, i) => `${x(i)},${y(d.visitors, activityMax)}`).join(' '));
  let bookingPoints = $derived(days.map((d, i) => `${x(i)},${y(d.bookings, activityMax)}`).join(' '));
  let barWidth = $derived(Math.min(16, 220 / Math.max(1, days.length)));
</script>

<section class="trends" aria-label="מגמות לאורך זמן">
  <figure>
    <figcaption><h2>מבקרים והזמנות לאורך זמן</h2></figcaption>
    <p class="legend"><span class="visitors">מבקרים יומיים</span><span class="bookings">הזמנות</span></p>
    {#if !hasActivity}<p class="empty-chart">אין ביקורים או הזמנות בטווח הזה.</p>{/if}
    <svg viewBox="0 0 620 205" role="img" aria-label="מגמת מבקרים והזמנות יומית. הנתונים המלאים בטבלה מתחת לגרפים.">
      {#each activityTicks as tick}
        <line class="grid" x1="42" x2="592" y1={y(tick, activityMax)} y2={y(tick, activityMax)} />
        <text x="33" y={y(tick, activityMax) + 4} text-anchor="end">{tick}</text>
      {/each}
      <polyline class="visitor-line" points={activityPoints} />
      <polyline class="booking-line" points={bookingPoints} />
      {#each days as day, i (day.date)}
        <circle class="visitor-dot" cx={x(i)} cy={y(day.visitors, activityMax)} r="3"><title>{dateLabel(day.date)}: {day.visitors} מבקרים</title></circle>
        <circle class="booking-dot" cx={x(i)} cy={y(day.bookings, activityMax)} r="3"><title>{dateLabel(day.date)}: {day.bookings} הזמנות</title></circle>
      {/each}
      {#each days.filter((_, i) => i === 0 || i === days.length - 1 || i === Math.floor((days.length - 1) / 2)) as day (day.date)}
        <text x={x(days.indexOf(day))} y="195" text-anchor="middle">{dateLabel(day.date)}</text>
      {/each}
    </svg>
    <p class="explanation">מבקר נספר פעם ביום. אותו מבקר יכול להופיע בכמה ימים, ולכן סכום הימים שונה מסך המבקרים הייחודיים. השעות לפי שעון ישראל; היום הראשון והיום הנוכחי עשויים להיות חלקיים.</p>
  </figure>

  <figure>
    <figcaption><h2>תשלומים לפי תאריך החיוב</h2></figcaption>
    <p class="legend"><span class="paid">שולם: {money(paid)}</span><span class="owed">לתשלום: {money(owed)}</span></p>
    {#if paid === 0 && owed === 0}<p class="empty-chart">אין חיובים בטווח הזה.</p>{/if}
    <svg viewBox="0 0 620 205" role="img" aria-label="חיובים שסומנו כשולמו וחיובים לתשלום לפי יום. הנתונים המלאים בטבלה מתחת לגרפים.">
      {#each [0, 0.5, 1] as fraction}
        <line class="grid" x1="42" x2="592" y1={y(paymentMax * fraction, paymentMax)} y2={y(paymentMax * fraction, paymentMax)} />
        <text x="33" y={y(paymentMax * fraction, paymentMax) + 4} text-anchor="end">{axisMoney(paymentMax * fraction)}</text>
      {/each}
      {#each days as day, i (day.date)}
        <rect class="paid-bar" x={x(i) - barWidth} y={y(day.paidAgorot, paymentMax)} width={barWidth} height={170 - y(day.paidAgorot, paymentMax)}><title>{dateLabel(day.date)}: שולם {money(day.paidAgorot)}</title></rect>
        <rect class="owed-bar" x={x(i)} y={y(day.owedAgorot, paymentMax)} width={barWidth} height={170 - y(day.owedAgorot, paymentMax)}><title>{dateLabel(day.date)}: לתשלום {money(day.owedAgorot)}</title></rect>
      {/each}
      {#each days.filter((_, i) => i === 0 || i === days.length - 1 || i === Math.floor((days.length - 1) / 2)) as day (day.date)}
        <text x={x(days.indexOf(day))} y="195" text-anchor="middle">{dateLabel(day.date)}</text>
      {/each}
    </svg>
    <p class="explanation">הסכומים בש״ח, לפי תאריכי החיוב בטווח והסטטוס הנוכחי שלהם. מועד קבלת הכסף אינו נשמר. חיובים שבוטלו אינם נכללים.</p>
  </figure>

  {#if hasActivity || paid !== 0 || owed !== 0}
  <details>
    <summary>הנתונים היומיים בטבלה</summary>
    <div class="daily-table">
      <table>
        <thead><tr><th scope="col">תאריך</th><th scope="col">מבקרים</th><th scope="col">הזמנות</th><th scope="col">שולם</th><th scope="col">לתשלום</th></tr></thead>
        <tbody>{#each days as day (day.date)}<tr><th scope="row">{dateLabel(day.date)}</th><td>{day.visitors}</td><td>{day.bookings}</td><td>{money(day.paidAgorot)}</td><td>{money(day.owedAgorot)}</td></tr>{/each}</tbody>
      </table>
    </div>
  </details>
  {/if}
</section>

<style>
  .trends { display: grid; gap: 16px; margin-bottom: 28px; min-width: 0; }
  figure { margin: 0; padding: 20px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--r-md); min-width: 0; }
  h2 { font-size: 1.05rem; font-weight: 800; }
  .legend { display: flex; flex-wrap: wrap; gap: 8px 20px; margin-block: 10px; font-size: .85rem; font-weight: 700; }
  .legend span::before { content: ''; display: inline-block; width: 12px; height: 4px; margin-inline-end: 6px; vertical-align: middle; background: var(--accent); }
  .legend .bookings::before { background: var(--accent2-strong); }
  .legend .paid::before { background: var(--accent3-strong); height: 10px; }
  .legend .owed::before { background: var(--accent2-strong); height: 10px; }
  svg { display: block; width: 100%; height: auto; direction: ltr; overflow: visible; }
  svg text { fill: var(--text-muted-strong); font: 12px sans-serif; }
  .grid { stroke: var(--border); stroke-width: 1; }
  polyline { fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .visitor-line { stroke: var(--accent); }
  .booking-line { stroke: var(--accent2-strong); stroke-dasharray: 6 4; }
  .visitor-dot { fill: var(--accent); }
  .booking-dot { fill: var(--accent2-strong); }
  .paid-bar { fill: var(--accent3-strong); }
  .owed-bar { fill: var(--accent2-strong); }
  .explanation, .empty-chart { color: var(--text-muted-strong); font-size: .8rem; line-height: 1.6; }
  .empty-chart { padding-block: 8px; }
  details { min-width: 0; }
  summary { cursor: pointer; min-height: 44px; padding-block: 10px; font-size: .85rem; font-weight: 700; }
  summary:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
  .daily-table { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-card); }
  table { width: 100%; border-collapse: collapse; font-size: .8rem; font-variant-numeric: tabular-nums; }
  th, td { text-align: start; padding: 10px; border-bottom: 1px solid var(--border); white-space: nowrap; }
  thead { background: var(--bg-surface); }
  /* The SVG scales down on phones; compensate so axis labels stay readable. */
  @media (max-width: 600px) { svg text { font-size: 20px; } }
  @media (max-width: 400px) { figure { padding: 16px; } svg text { font-size: 26px; } }
</style>
