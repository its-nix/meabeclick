<script lang="ts">
  import { onMount } from 'svelte';
  import BrandMark from '$lib/components/BrandMark.svelte';

  let token = $state('');
  let pending = $state(false);
  let error = $state('');
  let errorKind = $state<'invalid' | 'network' | ''>('');

  onMount(() => {
    token = location.hash.slice(1);
    history.replaceState(null, '', '/enter');
  });

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
  <meta name="referrer" content="no-referrer" />
</svelte:head>

<div class="entry-page">
  <main class="card">
    <a class="brand" href="/" aria-label="מאה בקליק — דף הבית"><BrandMark height={30} href={null} label={null} /></a>
    <h1>כניסה לדף האישי</h1>
    <p>לחיצה על הכפתור תכניס אתכם במכשיר הזה. הקישור יעבוד פעם אחת.</p>
    {#if error}
      <p class="error" role="alert">{error}</p>
      {#if errorKind === 'network'}
        <button onclick={enter}>ניסיון נוסף</button>
      {/if}
      <a class="secondary" href="/portal">לקבלת קישור חדש</a>
    {:else}
      <button onclick={enter} disabled={pending}>
        {pending ? 'נכנסים…' : 'כניסה לדף האישי'}
      </button>
      {#if pending}<p class="status" role="status">נכנסים…</p>{/if}
    {/if}
  </main>
</div>

<style>
  .entry-page { min-height: 100vh; display: grid; place-items: center; padding: 1rem; }
  .card { width: min(100%, 400px); padding: 2rem 1.5rem; border: 1.5px solid var(--border); border-radius: var(--r-lg); background: var(--bg-card); text-align: center; box-shadow: 0 16px 48px var(--shadow); }
  .brand { display: inline-flex; min-width: 44px; min-height: 44px; align-items: center; justify-content: center; }
  h1 { margin-block: 1rem 0.5rem; font-size: 1.5rem; }
  p { color: var(--text-muted); line-height: 1.6; }
  button, .secondary { width: 100%; min-height: 48px; margin-top: 1rem; border-radius: var(--r-sm); font: inherit; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; }
  button { border: 0; background: var(--accent); color: var(--text-on-accent); cursor: pointer; }
  button:disabled { opacity: 0.7; cursor: wait; }
  .secondary { border: 1.5px solid var(--border-strong); text-decoration: none; color: var(--text-primary); }
  .error { color: var(--danger-text); }
  .status { margin-block: 0.5rem 0; }
</style>
