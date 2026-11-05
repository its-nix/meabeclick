<script lang="ts">
  import BrandMark from './BrandMark.svelte';
  import { tutorNames } from '$lib/tutors.ts';
  let signingOut = $state(false);
  let error = $state('');
  async function signOut() {
    if (signingOut) return;
    signingOut = true; error = '';
    try {
      const response = await fetch('/api/logout', { method: 'POST' });
      if (!response.ok) throw new Error('logout');
      // A full navigation clears private page state on shared devices.
      location.href = '/';
    } catch {
      error = 'לא הצלחנו לצאת מהחשבון. נסו שוב.';
      signingOut = false;
    }
  }
</script>

<header class="tutor-header">
  <div class="tutor-header-inner">
    <a class="workspace-skip" href="#workspace-content">דילוג לתוכן</a>
    <a class="tutor-brand" href="/app/dashboard" aria-label="מאה בקליק — לוח בקרה">
      <BrandMark href={null} label={null} height={30} />
      <span>מאה בקליק</span>
    </a>
    <span class="workspace-label">סביבת המורה · {tutorNames()}</span>
    <div class="tutor-account">
      {#if error}<p class="logout-error" role="alert">{error}</p>{/if}
      <button type="button" class="workspace-button workspace-button-quiet" aria-label="יציאה מהחשבון" disabled={signingOut} onclick={signOut}>{signingOut ? 'יוצאים…' : 'יציאה'}</button>
    </div>
  </div>
</header>

<style>
  .tutor-header{position:sticky;top:0;z-index:100;background:var(--nav-bg);backdrop-filter:blur(16px);border-bottom:1px solid var(--border)}
  .tutor-header-inner{max-width:var(--workspace-width);min-height:68px;padding:10px 24px;margin:auto;display:flex;align-items:center;gap:18px}
  .tutor-brand{display:inline-flex;align-items:center;gap:10px;min-width:0;line-height:1.3;color:var(--text-primary);font-weight:850;font-size:1.05rem}
  .workspace-label{border-inline-start:1px solid var(--border-strong);padding-inline-start:18px;color:var(--text-muted);font-size:.8rem}
  .tutor-account{margin-inline-start:auto;display:flex;align-items:center;gap:12px;flex-shrink:0}
  .logout-error{position:absolute;top:calc(100% + 8px);inset-inline-end:16px;max-width:calc(100vw - 32px);padding:12px 16px;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--bg-card);box-shadow:0 4px 16px var(--shadow);font-size:.85rem;color:var(--danger)}
  .workspace-skip{position:absolute;inset-inline-start:16px;top:-100px;padding:12px 16px;background:var(--bg-card);border:2px solid var(--accent);border-radius:var(--r-sm);z-index:101}
  .workspace-skip:focus{top:8px}
  .tutor-brand:focus-visible{outline:3px solid var(--accent);outline-offset:5px;border-radius:4px}
  @media(max-width:600px){.tutor-header-inner{min-height:64px;padding:8px 16px;gap:12px}.workspace-label{display:none}.tutor-brand{font-size:1rem}}
</style>
