<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { filterLibraryRows, libraryPage } from '$lib/library-table.ts';
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import type { PageData } from './$types';
  import type { LibraryStatus } from '$server/library/store.ts';

  let { data }: { data: PageData } = $props();
  let view = $state(untrack(() => data));
  $effect(() => { view = data; });
  let template = $state(untrack(() => data.selectedTemplate));
  let topic = $state(untrack(() => data.filters.topic));
  let status = $state(untrack(() => data.filters.status));
  let search = $state(untrack(() => data.filters.search));
  let pageNumber = $state(untrack(() => data.filters.page));
  let error = $state('');
  let refreshError = $state('');
  let refreshing = $state(false);
  let busy = $state<Record<string, boolean>>({});

  const STATUS: Record<LibraryStatus | 'none', { label: string; cls: string }> = {
    none: { label: 'טרם הוכן', cls: 'none' },
    ready: { label: 'מוכן', cls: 'ready' },
    preparing: { label: 'בהכנה…', cls: 'working' },
    queued: { label: 'בתור', cls: 'working' },
    held: { label: 'נעצר לבדיקה', cls: 'held' },
    failed: { label: 'נכשל', cls: 'failed' },
  };
  const key = (templateId: string, skillKey: string) => `skill:${templateId}/${skillKey}`;
  const topics = $derived([...new Set(view.rows.filter(r => !template || r.templateId === template).map(r => r.topic))]);
  const rows = $derived(filterLibraryRows(view.rows, { template, topic, status, search }));
  const pagination = $derived(libraryPage(rows, pageNumber));
  const pagedRows = $derived(pagination.rows);
  const libraryPath = $derived.by(() => {
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries({ template, topic, status, search })) {
      if (value) query.set(name, value);
    }
    if (pagination.page > 1) query.set('page', String(pagination.page));
    return '/app/library' + (query.size ? '?' + query : '');
  });
  $effect(() => {
    if (page.url.pathname + page.url.search !== libraryPath) replaceState(libraryPath, page.state);
  });
  const working = $derived(view.rows.some(r => r.item && ['queued', 'preparing'].includes(r.item.status)));
  // A bulk preparation always names one complete topic, not a partial
  // search/status result. Filters cannot silently change its scope.
  const bulkTopic = $derived(template && topic ? view.rows.find(r => r.templateId === template && r.topic === topic) : null);
  const bulkKey = $derived(bulkTopic ? `topic:${template}/${bulkTopic.topicKey}` : '');
  const topicReady = $derived(bulkTopic ? view.rows.filter(r => r.templateId === template && r.topicKey === bulkTopic.topicKey).every(r => r.item?.status === 'ready') : false);
  const filtered = $derived(Boolean(template || topic || status || search));

  function resetFilters() { template = ''; topic = ''; status = ''; search = ''; pageNumber = 1; }
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      const r = await fetch('/api/library?all=1', { cache: 'no-store' });
      if (!r.ok) throw new Error('refresh');
      view = { ...view, ...await r.json() };
      refreshError = '';
    } catch { refreshError = 'לא הצלחנו לעדכן את מצב ההכנה. הנתונים המוצגים הם מהעדכון האחרון.'; }
    finally { refreshing = false; }
  }
  onMount(() => {
    const id = setInterval(() => { if (working) refresh(); }, 8000);
    return () => clearInterval(id);
  });
  async function prepare(templateId: string, body: { topic?: string; skill?: string }, busyKey: string) {
    busy[busyKey] = true;
    error = '';
    try {
      const r = await fetch('/api/library/prepare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: templateId, ...body }),
      });
      if (r.status === 401) { location.href = '/login?next=/app/library'; return; }
      if (!r.ok) error = (await r.json().catch(() => ({}))).error || 'ההכנה לא התחילה';
      await refresh();
    } catch { error = 'אין חיבור לשרת. אפשר לנסות שוב.'; }
    finally { busy[busyKey] = false; }
  }
</script>

<svelte:head><title>ספריית חומרים — מאה בקליק</title></svelte:head>

<main class="wrap">
  <a class="back" href="/app/dashboard">→ חזרה ללוח הבקרה</a>
  <h1>ספריית חומרים</h1>
  <p class="lead">החומרים לשיעורים הבאים תחילה. אפשר לחפש ולסנן את הספרייה המלאה בהמשך.</p>
  <p class="note">עריכה בספרייה משנה שיעורים עתידיים. עריכה בשיעור של תלמיד/ה משנה רק את העותק שלו/ה.</p>
  <details class="due" open>
    <summary>הבאים בתור אצל התלמידים <span>({view.due.length} מיומנויות)</span></summary>
    {#if view.due.length === 0}
      <p class="note">אחרי שנפתחת תכנית בכרטיס התלמיד/ה, המיומנות של השיעור הבא תופיע כאן.</p>
    {:else}
      <ul>{#each view.due as d (d.templateId + '/' + d.skillKey)}
        {@const st = STATUS[d.item?.status ?? 'none']}
        {@const busyKey = key(d.templateId, d.skillKey)}
        <li><strong>{d.skillTitle}</strong> <span class="status {st.cls}">{st.label}</span>
          <p class="note">{d.students.join(', ')} · {d.track}</p>
          {#if d.item?.problem}<p class="problem">{d.item.problem}</p>{/if}
          <div class="actions">
            {#if d.item?.status === 'ready' && d.item.slug}
              <a href="/lessons/{d.item.slug}" target="_blank" rel="noopener">צפייה</a>
              <a href="/app/lessons/{d.item.slug}/edit?returnTo={encodeURIComponent(libraryPath)}">עריכה</a>
            {:else if !d.item || !['queued', 'preparing'].includes(d.item.status)}
              <button class="link" disabled={busy[busyKey]} onclick={() => prepare(d.templateId, { skill: d.skillKey }, busyKey)}>
                {busy[busyKey] ? 'מתחילים…' : d.item ? 'הכנה מחדש' : 'הכנה'}
              </button>
            {/if}
          </div>
        </li>
      {/each}</ul>
    {/if}
  </details>
  <h2>כל החומרים</h2>
  <div class="filters">
        <div><label for="library-search">מיומנות</label><input id="library-search" type="search" bind:value={search} oninput={() => { pageNumber = 1; }} placeholder="חיפוש בחומרים" /></div>
        <div><label for="library-template">תכנית / כיתה</label>
          <select id="library-template" bind:value={template} onchange={() => { topic = ''; pageNumber = 1; }}>
            <option value="">כל התכניות</option>
            {#each view.templates as t (t.id)}<option value={t.id}>{t.track}</option>{/each}
          </select>
        </div>
        <div><label for="library-topic">נושא</label>
          <select id="library-topic" bind:value={topic} onchange={() => { pageNumber = 1; }}>
            <option value="">כל הנושאים</option>
            {#each topics as title (title)}<option value={title}>{title}</option>{/each}
          </select>
        </div>
        <div><label for="library-status">מצב</label>
          <select id="library-status" bind:value={status} onchange={() => { pageNumber = 1; }}>
            <option value="">כל המצבים</option>
            {#each Object.entries(STATUS) as [value, st] (value)}<option {value}>{st.label}</option>{/each}
          </select>
        </div>
  </div>
  <div class="toolbar">
    <p class="result-count" role="status" aria-live="polite">{rows.length} מתוך {view.rows.length} מיומנויות</p>
    {#if filtered}<button class="link" onclick={resetFilters}>ניקוי מסננים</button>{/if}
    {#if bulkTopic}
      <button class="btn" disabled={busy[bulkKey] || topicReady} onclick={() => prepare(template, { topic: bulkTopic.topicKey }, bulkKey)}>
        {busy[bulkKey] ? 'מתחילים…' : topicReady ? 'כל הנושא מוכן' : 'הכנת הנושא המלא'}
      </button>
    {/if}
  </div>
  {#if bulkTopic}<p class="note bulk-note">הכנת הנושא כוללת את כל המיומנויות ב״{bulkTopic.topic}״ בתכנית שנבחרה, גם אם חיפוש או סינון מצב מסתירים חלק מהן.</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if refreshError}
    <div role="status"><p class="error">{refreshError}</p><button class="link" disabled={refreshing} onclick={refresh}>ניסיון עדכון נוסף</button></div>
  {/if}

  <!-- Keyboard users need to focus this overflow region to scroll the table. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="table-wrap" role="region" aria-label="טבלת חומרי הלימוד — אפשר לגלול לצדדים" tabindex="0">
    <table>
      <caption>חומרי הלימוד בספרייה</caption>
      <thead><tr>
        <th scope="col">מיומנות</th><th scope="col">תכנית / כיתה</th><th scope="col">נושא</th><th scope="col">מצב</th>
        <th scope="col">פעולות</th>
      </tr></thead>
      <tbody>
        {#each pagedRows as row (row.templateId + '/' + row.skillKey)}
          {@const st = STATUS[row.item?.status ?? 'none']}
          {@const busyKey = key(row.templateId, row.skillKey)}
          <tr>
            <th scope="row">{row.title}</th>
            <td>{row.track}</td><td>{row.topic}</td>
            <td><span class="status {st.cls}">{st.label}</span>{#if row.item?.problem}<p class="problem">{row.item.problem}</p>{/if}</td>
            <td><div class="actions">
              {#if row.item?.status === 'ready' && row.item.slug}
                <a href="/lessons/{row.item.slug}" target="_blank" rel="noopener" aria-label="צפייה: {row.title} — {row.track} (חלון חדש)">צפייה</a>
                <a href="/app/lessons/{row.item.slug}/edit?returnTo={encodeURIComponent(libraryPath)}" aria-label="עריכה: {row.title} — {row.track}">עריכה</a>
              {/if}
              {#if !row.item || !['queued', 'preparing'].includes(row.item.status)}
                <button class="link" disabled={busy[busyKey]} onclick={() => prepare(row.templateId, { skill: row.skillKey }, busyKey)}
                  aria-label="{busy[busyKey] ? 'מתחילים…' : row.item ? 'הכנה מחדש' : 'הכנה'}: {row.title} — {row.track}">
                  {busy[busyKey] ? 'מתחילים…' : row.item ? 'הכנה מחדש' : 'הכנה'}
                </button>
              {/if}
            </div></td>
          </tr>
        {:else}
          <tr><td colspan="5" class="empty">לא נמצאו חומרים שמתאימים למסננים. <button class="link" onclick={resetFilters}>הצגת כל החומרים</button></td></tr>
        {/each}
      </tbody>
    </table>
  </div>
  <nav class="pagination" aria-label="עמודי הספרייה">
    <button class="link" disabled={pagination.page === 1} onclick={() => { pageNumber = pagination.page - 1; }}>הקודם</button>
    <span>עמוד {pagination.page} מתוך {pagination.pages}</span>
    <button class="link" disabled={pagination.page === pagination.pages} onclick={() => { pageNumber = pagination.page + 1; }}>הבא</button>
  </nav>
</main>

<style>
  .wrap { max-width: 1200px; margin: 0 auto; padding: 20px 16px 60px; }
  .back { display: inline-flex; align-items: center; min-height: 44px; color: var(--accent); font-weight: 700; text-decoration: none; }
  h1 { font-size: 1.6rem; font-weight: 900; margin: 4px 0 8px; }
  .lead { color: var(--text-primary); line-height: 1.7; margin: 0 0 6px; }
  .note { color: var(--text-muted-strong); font-size: .9rem; line-height: 1.6; margin: 0; }
  .filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 16px; }
  .filters > div { min-width: 0; }
  .pagination { display: flex; align-items: center; justify-content: center; gap: 16px; margin-block: 16px; }
  h2 { margin: 28px 0 12px; font-size: 1.2rem; }
  .toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin: 18px 0 8px; }
  .result-count { margin: 0; color: var(--text-muted-strong); }
  .bulk-note { margin-bottom: 10px; }
  .table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-card); }
  table { border-collapse: collapse; width: 100%; min-width: 880px; text-align: start; }
  caption { text-align: start; padding: 12px; font-weight: 800; }
  th, td { padding: 10px 12px; border-top: 1px solid var(--border); text-align: start; vertical-align: top; }
  thead th { background: var(--bg-surface); font-size: .88rem; }
  thead th:first-child { width: 29%; }
  tbody th { font-size: .95rem; font-weight: 700; }
  tbody tr:hover, tbody tr:focus-within { background: var(--bg-surface); }
  label { display: block; margin-bottom: 8px; }
  input, select { display: block; width: 100%; min-height: 44px; min-width: 140px; padding: 8px; font: inherit; font-size: 16px; color: var(--text-primary); background: var(--bg-card); border: 1px solid var(--border-strong); border-radius: var(--r-sm); }
  .status { display: inline-block; font-size: .85rem; font-weight: 700; white-space: nowrap; color: var(--text-muted-strong); }
  .status.ready { color: var(--accent3-strong); }
  .status.working { color: var(--accent-deep); }
  .status.held, .status.failed, .problem, .error { color: var(--danger); }
  .problem { max-width: 240px; font-size: .85rem; overflow-wrap: anywhere; margin: 6px 0 0; }
  .actions { display: flex; align-items: center; flex-wrap: wrap; column-gap: 12px; }
  .actions a, .link { display: inline-flex; align-items: center; min-height: 44px; min-width: 44px; color: var(--accent); font: inherit; font-weight: 700; text-decoration: underline; }
  .link { border: 0; background: none; padding: 4px 0; cursor: pointer; }
  .btn { min-height: 44px; padding: 8px 16px; border: 0; border-radius: var(--r-sm); background: var(--accent); color: white; font: inherit; font-weight: 700; cursor: pointer; }
  button:disabled { opacity: .6; cursor: default; }
  :is(a, button, input, select, summary, .table-wrap):focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
  .empty { padding: 24px 12px; text-align: center; }
  .due { margin-top: 24px; border-top: 1px solid var(--border); padding-top: 8px; }
  summary { min-height: 44px; padding: 10px 0; font-weight: 700; cursor: pointer; }
  summary span { color: var(--text-muted-strong); font-weight: 400; }
  ul { list-style: none; padding: 0; margin: 8px 0; }
  li { border-top: 1px solid var(--border); padding: 12px 0; }
  li strong { margin-inline-end: 12px; }
  .error { font-weight: 700; }
</style>
