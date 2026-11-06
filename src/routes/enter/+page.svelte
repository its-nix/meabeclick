<script lang="ts">
  import GoogleSignIn from '$lib/components/GoogleSignIn.svelte';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  import { onMount } from 'svelte';
  import BrandMark from '$lib/components/BrandMark.svelte';

  let token = $state('');
  let inspecting = $state(true);
  let inspected = $state(false);
  let studentName = $state<string | null>(null);
  let isStudentInvitation = $state(false);
  let previewDestination = $state<string | null>(null);
  let switchDevice = $state(false);
  let copied = $state(false);
  let copyError = $state('');
  async function copyInvitation() {
    try {
      await navigator.clipboard.writeText(`${location.origin}/enter#${token}`);
      copied = true;
      copyError = '';
    } catch { copyError = 'אפשר להעתיק את הקישור מההודעה ולפתוח אותו ב־Safari או ב־Chrome.'; }
  }
  let pending = $state(false);
  let error = $state('');
  let errorKind = $state<'invalid' | 'network' | ''>('');

  onMount(() => {
    token = location.hash.slice(1);
    history.replaceState(null, '', '/enter');
    inspectInvitation();
  });

  async function inspectInvitation() {
    inspecting = true;
    error = '';
    if (!token) {
      inspecting = false; errorKind = 'invalid';
      error = 'הקישור כבר לא תקף. פתחו שוב את ההודעה או בקשו קישור חדש.';
      return;
    }
    try {
      const response = await fetch('/api/access/inspect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }), signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) { errorKind = 'invalid'; error = 'הקישור כבר לא תקף. בקשו קישור חדש.'; return; }
      const body = await response.json();
      studentName = body.studentName;
      isStudentInvitation = body.kind === 'student';
      previewDestination = body.previewDestination;
      inspected = true;
    } catch {
      errorKind = 'network'; error = 'לא הצלחנו לפתוח את ההזמנה. בדקו את החיבור ונסו שוב.';
    } finally { inspecting = false; }
  }

  async function enter() {
    if (!token || pending) {
      error = 'הקישור כבר לא תקף. אפשר לבקש קישור אישי חדש — בלי לחכות למורה.';
      errorKind = 'invalid';
      return;
    }
    pending = true;
    error = '';
    errorKind = '';
    try {
      const response = await fetch('/api/access/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      token = '';
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        error = 'הקישור כבר לא תקף. אפשר לבקש קישור אישי חדש — בלי לחכות למורה.';
        errorKind = 'invalid';
        pending = false;
        return;
      }
      location.replace(body.destination);
    } catch {
      error = 'לא הצלחנו להתחבר. בדקו את החיבור ונסו שוב.';
      errorKind = 'network';
      pending = false;
    }
  }
</script>

<svelte:head>
  <title>כניסה לדף האישי — מאה בקליק</title>
  <meta name="referrer" content="same-origin" />
</svelte:head>

<div class="entry-page">
  <main class="card">
    <a class="brand" href="/" aria-label="מאה בקליק — דף הבית"><BrandMark height={30} href={null} label={null} /></a>
    <h1>{studentName ? `הדף של ${studentName}` : 'כניסה לדף האישי'}</h1>
    <p>ההזמנה מחוברת לדף הקיים. נכנסים ומתחילים ללמוד.</p>
    {#if error}
      <p class="error" role="alert">{error}</p>
      {#if errorKind === 'network'}
        <button onclick={() => inspected ? enter() : inspectInvitation()}>ניסיון נוסף</button>
      {/if}
      <a class="secondary" href="/portal">לקבלת קישור חדש</a>
    {:else if inspecting}
      <p role="status">פותחים את ההזמנה…</p>
    {:else if previewDestination && !switchDevice}
      <p>זה המכשיר של ההורה. אפשר לצפות בלוח בלי לשנות את הכניסה שלכם.</p>
      <a class="secondary" href={previewDestination}>צפייה בלוח התלמיד/ה</a>
      <button onclick={copyInvitation}>{copied ? 'הקישור הועתק' : 'העתקת ההזמנה למכשיר של הילד/ה'}</button>
      <button class="text-button" onclick={() => { switchDevice = true; }}>זה המכשיר של הילד/ה — החלפת כניסה</button>
    {:else}
      {#if data.googleEnabled}
        <GoogleSignIn {token} disabled={pending} label="חיבור וכניסה עם Google" />
        <p class="small">{isStudentInvitation ? 'בחרו את חשבון Google של התלמיד/ה. בפעם הבאה נכנסים איתו מכל מכשיר.' : 'בפעם הבאה נכנסים עם אותו חשבון Google, מכל מכשיר.'}</p>
      {/if}
      <button class:text-button={data.googleEnabled} onclick={enter} disabled={pending}>
        {pending ? 'נכנסים…' : data.googleEnabled ? 'כניסה במכשיר הזה בלי Google' : 'כניסה לדף האישי'}
      </button>
      {#if pending}<p class="status" role="status">נכנסים…</p>{/if}
    {/if}
    {#if token && !error}
      <details class="browser-help"><summary>הקישור נפתח בתוך WhatsApp?</summary>
        <p>אם Google לא נפתח, העתיקו את הקישור ופתחו אותו ב־Safari או ב־Chrome. ההזמנה תישמר.</p>
        <button class="text-button" onclick={copyInvitation}>{copied ? 'הקישור הועתק' : 'העתקת הקישור לדפדפן'}</button>
        {#if copyError}<p role="alert">{copyError}</p><input class="copy-link" aria-label="הקישור להעתקה" readonly value={`${typeof location !== 'undefined' ? location.origin : ''}/enter#${token}`} onfocus={(event) => event.currentTarget.select()} />{/if}
      </details>
    {/if}
    {#if copied}<p role="status">הקישור הועתק. אפשר לפתוח אותו בדפדפן או במכשיר אחר.</p>{/if}
  </main>
</div>

<style>
  .entry-page {
    min-height: 100vh;
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 1rem;
  }
  .card { width: min(100%, 400px); padding: 2rem 1.5rem; border: 1.5px solid var(--border); border-radius: var(--r-lg); background: var(--bg-card); text-align: center; box-shadow: 0 16px 48px var(--shadow); }
  .brand { display: inline-flex; min-width: 44px; min-height: 44px; align-items: center; justify-content: center; }
  h1 { margin-block: 1rem 0.5rem; font-size: 1.5rem; }
  p { color: var(--text-muted); line-height: 1.6; }
  button, .secondary { width: 100%; min-height: 48px; margin-top: 1rem; border-radius: var(--r-sm); font: inherit; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
  button { border: 0; background: var(--action-fill); color: var(--text-on-accent); cursor: pointer; }
  button:disabled { opacity: 0.7; cursor: wait; }
  .secondary { border: 1.5px solid var(--border-strong); text-decoration: none; color: var(--text-primary); }
  .error { color: var(--danger-text); }
  .text-button { background:transparent;color:var(--accent);border:1px solid var(--border); }
  .copy-link { width:100%;min-height:44px;font:inherit;direction:ltr;border:1px solid var(--border);padding:8px;margin-top:8px; }
  .small { font-size:.85rem;margin-block:10px; }
  .browser-help { margin-top:20px;font-size:.85rem; }
  .browser-help summary { min-height:44px;cursor:pointer;display:flex;align-items:center;justify-content:center; }
  .status { margin-block: 0.5rem 0; }
</style>
