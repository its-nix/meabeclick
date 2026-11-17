<script lang="ts">
  import GoogleSignIn from '$lib/components/GoogleSignIn.svelte';
  import BrandMark from '$lib/components/BrandMark.svelte';
  import { contactTutor } from '$lib/tutors.ts';
  import { TUTOR_PHONE } from '$lib/contact.ts';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>כניסה לדף האישי — מאה בקליק</title>
</svelte:head>

<div class="auth-page">
  <main class="card">
    <a class="brand" href="/">
      <BrandMark height={30} href={null} label={null} />
      <span>מאה בקליק</span>
    </a>

    {#if data.expired}
      <!-- /enter sends every failure here: expired, tampered, or naming a
           record that is gone. One message, because the next step is the
           same in all three cases. -->
      <p class="notice" role="status">
        הקישור כבר לא תקף. היכנסו עם Google, או בקשו מהמורה קישור חדש.
      </p>
    {/if}

    <h1>כניסה לדף האישי</h1>
    <p class="sub">הלמידה שלכם מתחילה כאן.</p>
    {#if data.authError}<p class="notice" role="alert">{data.authError}</p>{/if}
    {#if data.signedIn}<p class="hint"><a href="/portal">→ חזרה לדף שלי</a></p>{/if}
    {#if data.googleEnabled}
      <GoogleSignIn />
      <p class="hint">כניסה והרשמה באותו מקום. הדף שלכם מחכה בפנים.</p>
      <p class="hint">יש לכם קישור אישי מהמייל או מהוואטסאפ? פשוט פתחו אותו.</p>
    {:else}
      <!-- Production refuses to boot without Google (boot-checks.ts); this is
           only reachable in dev, where it says so rather than hiding the page. -->
      <p class="notice" role="alert">הכניסה עם Google אינה מוגדרת בשרת הזה.</p>
    {/if}

    <div class="links">
      <a href="/booking">להזמנת שיעור</a>
      <span aria-hidden="true">·</span>
      <a href="https://wa.me/{TUTOR_PHONE}" target="_blank" rel="noopener">כתבו ל{contactTutor().name}</a>
    </div>
  </main>
</div>

<style>
  .auth-page {
    min-height: 100vh;
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }

  .card {
    max-width: 400px;
    width: 100%;
    min-width: 0;
    background: var(--bg-card);
    border: 1.5px solid var(--border);
    border-radius: var(--r-lg);
    padding: 1.8rem 1.5rem 1.5rem;
    box-shadow: 0 16px 48px var(--shadow);
  }

  .brand {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    gap: 0.5rem;
    font-weight: 700;
    font-size: 1.05rem;
    color: var(--text-primary);
    text-decoration: none;
    margin-bottom: 1.2rem;
  }

  .notice {
    background: var(--bg-surface);
    border: 1.5px solid var(--accent);
    color: var(--text-primary);
    border-radius: var(--r-sm);
    padding: 0.7rem 0.9rem;
    font-size: 0.88rem;
    line-height: 1.6;
    margin-bottom: 1rem;
  }

  h1 { font-size: 1.3rem; font-weight: 700; text-align: center; }
  .sub {
    color: var(--text-muted); font-size: 0.9rem;
    text-align: center; margin-top: 0.35rem; margin-bottom: 1.1rem;
  }

  .hint {
    font-size: 0.8rem; color: var(--text-muted);
    margin-top: 0.6rem; line-height: 1.55; text-align: center;
  }
  .links {
    margin-top: 1.4rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
    display: flex;
    gap: 0.6rem;
    justify-content: center;
    align-items: center;
    font-size: 0.85rem;
    color: var(--text-muted);
    flex-wrap: wrap;
    min-width: 0;
  }
  .links a { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; font-weight: 700; text-decoration: none; color: var(--accent); padding: 0.4rem 0.5rem; overflow-wrap: anywhere; }
  .links a:hover { text-decoration: underline; }

  @media (max-height: 740px) {
    .card { padding-block: 0.75rem; }
    .brand { margin-bottom: 0.25rem; }
    .sub { margin-bottom: 0.5rem; }
    .links { margin-top: 0.5rem; padding-top: 0.25rem; }
  }

  @media (max-width: 360px) {
    .card { padding-inline: 0.75rem; }
  }
</style>
