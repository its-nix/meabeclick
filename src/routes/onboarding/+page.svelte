<script lang="ts">
  import BrandMark from '$lib/components/BrandMark.svelte';
  import { onMount } from 'svelte';
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  let role = $state('');
  let name = $state('');
  let level = $state('');
  let busy = $state(false);
  onMount(() => {
    try {
      const saved = sessionStorage.getItem('maab-booking-google-draft');
      if (!saved) return;
      const draft = JSON.parse(saved);
      if (typeof draft.at !== 'number' || Date.now() - draft.at > 30 * 60 * 1000) return;
      if (typeof draft.isSelf === 'boolean') role = draft.isSelf ? 'learner' : 'parent';
      name = String(draft.name ?? '').slice(0,100);
      level = String(draft.level ?? '').slice(0,60);
    } catch { /* Local draft recovery is optional. */ }
  });
  function rememberBookingProfile() {
    try {
      const saved = sessionStorage.getItem('maab-booking-google-draft');
      if (!saved) return;
      const draft = JSON.parse(saved);
      if (Date.now() - draft.at > 30 * 60 * 1000) return;
      sessionStorage.setItem('maab-booking-google-draft', JSON.stringify({ ...draft, name, level, isSelf: role === 'learner' }));
    } catch { /* A disabled storage API must not block signup. */ }
  }
  function choose(value: string) {
    if (role === value) return;
    role = value;
    name = value === 'learner' ? data.name : '';
  }
</script>
<svelte:head><title>נעים להכיר — מאה בקליק</title></svelte:head>
<main class="onboarding">
  <div class="card">
    <BrandMark height={30} />
    <h1>נעים להכיר</h1>
    <p class="intro">רק כמה פרטים, והדף האישי מוכן.</p>
    <p class="account" dir="ltr">{data.email}</p>
    <form method="POST" use:enhance={() => { rememberBookingProfile(); busy = true; return async ({ update }) => { await update(); busy = false; }; }}>
      <fieldset disabled={busy}>
        <legend>למי פותחים דף?</legend>
        <div class="roles">
          <label class:chosen={role === 'learner'}><input type="radio" name="role" value="learner" checked={role === 'learner'} onchange={() => choose('learner')} required /> אני לומד/ת</label>
          <label class:chosen={role === 'parent'}><input type="radio" name="role" value="parent" checked={role === 'parent'} onchange={() => choose('parent')} required /> לילד/ה שלי</label>
        </div>
        {#if role}
          <label for="learner-name">{role === 'learner' ? 'השם שלך' : 'שם הילד/ה'}</label>
          <input id="learner-name" name="name" bind:value={name} autocomplete={role === 'learner' ? 'name' : 'off'} maxlength="100" required />
          <label for="learner-level">כיתה או רמה</label>
          <select id="learner-level" name="level" bind:value={level} required>
            <option value="" disabled>בחירה</option>
            {#each ['כיתה ז', 'כיתה ח', 'כיתה ט', 'כיתה י', 'כיתה יא', 'כיתה יב', 'השלמת בגרויות', 'אחר'] as grade}<option>{grade}</option>{/each}
          </select>
          <p class="hint">{role === 'learner' ? 'הדף שלך נפתח ישירות. אין צורך בחשבון של הורה.' : 'אחרי פתיחת הדף תוכלו לשלוח לילד/ה הזמנה בוואטסאפ.'}</p>
        {/if}
      </fieldset>
      {#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
      <button class="primary" disabled={busy || !role}>{busy ? 'מכינים את הדף…' : 'פתיחת הדף האישי'}</button>
      {#if busy}<p role="status">מכינים את הדף…</p>{/if}
    </form>
    <p class="fine">קביעת שיעור ותשלום נעשים בנפרד, כשתרצו.</p>
    <a href="/portal">→ חזרה לכניסה</a>
  </div>
</main>
<style>
  .onboarding{min-height:100dvh;display:grid;place-items:center;padding:24px 16px;}
  .card{width:min(100%,440px);padding:28px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--r-lg);}
  h1{font-size:1.65rem;margin-top:24px;}.intro,.hint,.fine{color:var(--text-muted);line-height:1.6;}.account{font-size:.85rem;color:var(--text-muted);text-align:right;margin-block:8px 24px;overflow-wrap:anywhere;}
  fieldset{padding:0;border:0;min-width:0;}legend{font-weight:650;margin-bottom:10px;}.roles{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px;}
  .roles label{display:flex;align-items:center;gap:8px;border:1px solid var(--border);border-radius:12px;padding:12px;min-height:54px;cursor:pointer;}.roles .chosen{border-color:var(--accent);background:var(--accent-dim);}
  label{display:block;font-weight:600;margin-bottom:8px;}input:not([type=radio]),select{width:100%;min-height:48px;border:1px solid var(--border-strong);border-radius:10px;padding:10px 12px;background:var(--bg-card);color:var(--text-primary);font:inherit;margin-bottom:18px;}
  .primary{width:100%;min-height:50px;border:0;border-radius:12px;background:var(--accent);color:var(--text-on-accent);font:inherit;font-weight:700;margin-top:20px;cursor:pointer;}.primary:disabled{opacity:.6;}.error{color:var(--danger-text);margin-top:12px;}.hint,.fine{font-size:.85rem;}.fine{margin-block:16px;}a{display:inline-flex;align-items:center;min-height:44px;font-size:.9rem;color:var(--accent);} :is(button,input,select):focus-visible{outline:3px solid var(--accent);outline-offset:3px;}
  @media(max-width:360px){.card{padding:20px;}.roles{grid-template-columns:1fr;}}
</style>
