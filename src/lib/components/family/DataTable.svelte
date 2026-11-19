<script lang="ts">
  /** The scrolling card-table the family pages share (lessons, charges). */
  import type { Snippet } from 'svelte';
  let { head, children, class: extra = '' }: { head: Snippet; children: Snippet; class?: string } = $props();
</script>

<div class="table-wrap {extra}">
  <table class="data-table">
    <thead><tr>{@render head()}</tr></thead>
    <tbody>{@render children()}</tbody>
  </table>
</div>

<style>
  .table-wrap { overflow-x: auto; border-radius: var(--r-md); box-shadow: 0 2px 12px var(--shadow); }
  .data-table { width: 100%; border-collapse: collapse; font-size: 0.88rem; background: var(--bg-card); border-radius: var(--r-md); overflow: hidden; }
  .data-table thead { background:var(--bg-card-solid); }
  .data-table :global(th) { text-align:start;padding:12px;color:var(--text-muted);font-size:.8125rem;font-weight:600;border-bottom:1px solid var(--border); }
  .data-table :global(td) { padding: 11px 15px; border-bottom: 1px solid var(--border); color: var(--text-primary); vertical-align: top; }
  .data-table :global(tr:last-child td) { border-bottom: none; }
  .data-table :global(tr:hover td) { background: var(--accent-dim); }
  /* The cell rule above wins on colour and padding; only the centring is the empty row's own. */
  .data-table :global(.empty-row) { text-align: center; }
</style>
