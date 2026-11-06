<script lang="ts">
  import GoogleSignIn from './GoogleSignIn.svelte';
  let { enabled, linked, next = '/portal' }: { enabled: boolean; linked: boolean; next?: string } = $props();
</script>
{#if enabled && !linked}
  <aside class="connect-google" aria-label="כניסה קלה בפעם הבאה">
    <div><strong>בפעם הבאה, נכנסים עם Google</strong><p>חיבור חד־פעמי לדף הקיים. בלי לבקש קישור חדש.</p></div>
    <GoogleSignIn intent="link" {next} label="חיבור חשבון Google" />
  </aside>
{/if}
<style>
  .connect-google{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:18px;border:1px solid var(--border);border-radius:var(--r-lg);background:var(--bg-card);margin-block:16px 24px;}
  strong{font-size:.95rem;}p{font-size:.85rem;color:var(--text-muted);margin-top:4px;line-height:1.6;}
</style>
