<script lang="ts">
  import type {Snippet} from 'svelte';
  let {title,description,actions}: {title:string;description?:string;actions?:Snippet}=$props();
</script>

<div class="workspace-page-heading">
  <div class="workspace-heading-copy">
    <h1>{title}</h1>
    {#if description}<p>{description}</p>{/if}
  </div>
  {#if actions}<div class="workspace-heading-actions">{@render actions()}</div>{/if}
</div>

<style>
  .workspace-page-heading{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-bottom:32px}
  .workspace-heading-copy{min-width:0}
  h1{font-size:1.875rem;line-height:1.35;font-weight: 700;color:var(--text-primary);margin:0}
  p{font-size:.9rem;line-height:1.7;color:var(--text-muted);margin-top:6px;max-width:65ch}
  .workspace-heading-actions{display:flex;align-items:center;gap:10px;flex-shrink:0}
  @media(max-width:700px){.workspace-page-heading{align-items:flex-start;flex-direction:column;gap:16px;margin-bottom:24px}.workspace-heading-actions{max-width:100%;flex-wrap:wrap}h1{font-size:1.75rem}p{font-size:.875rem}}
</style>
