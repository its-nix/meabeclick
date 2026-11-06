<script lang="ts">
  let { intent = 'login', next = '/portal', token = '', label = 'המשך עם Google', disabled = false, onStart }:
    { intent?: 'login' | 'link' | 'tutor'; next?: string; token?: string; label?: string; disabled?: boolean; onStart?: () => void } = $props();
  let busy = $state(false);
</script>
<form method="POST" action="/auth/google/start" onsubmit={() => { onStart?.(); busy = true; }}>
  <input type="hidden" name="intent" value={intent} />
  <input type="hidden" name="next" value={next} />
  {#if token}<input type="hidden" name="token" value={token} />{/if}
  <button class="google-button" type="submit" disabled={disabled || busy}>
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.6h3.3c1.9-1.8 2.9-4.3 2.9-7.5Z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.7-2.3l-3.3-2.6c-.9.6-2 .9-3.4.9a6 6 0 0 1-5.6-4.1H3v2.7A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.9a6 6 0 0 1 0-3.8V7.4H3a10 10 0 0 0 0 9.2l3.4-2.7Z"/><path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A9.6 9.6 0 0 0 12 2a10 10 0 0 0-9 5.4l3.4 2.7A6 6 0 0 1 12 6Z"/></svg>
    {busy ? 'עוברים ל־Google…' : label}
  </button>
  {#if busy}<p class="google-status" role="status">עוברים ל־Google…</p>{/if}
</form>
<style>
  form { margin: 0; }
  .google-button { display:flex;align-items:center;justify-content:center;gap:12px;width:100%;min-height:50px;border:1px solid var(--border-strong);border-radius:12px;background:var(--bg-card);color:var(--text-primary);font:inherit;font-weight:650;padding:12px 16px;cursor:pointer; }
  .google-button:hover { background:var(--bg-surface); }
  .google-button:focus-visible { outline:3px solid var(--accent);outline-offset:3px; }
  .google-button:disabled { opacity:.6;cursor:wait; }
  svg { flex-shrink:0; }
  .google-status { font-size:.85rem;color:var(--text-muted);text-align:center;margin-top:8px; }
</style>
