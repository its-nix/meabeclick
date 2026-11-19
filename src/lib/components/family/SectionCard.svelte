<script lang="ts">
  /**
   * The titled block the family pages stack: an icon, a heading and an
   * optional count on the end. `hidden` keeps the block in the DOM so a
   * view switch does not lose what is inside it (a half-made share link).
   */
  import type { Snippet } from 'svelte';
  import Icon from '$lib/icons/Icon.svelte';
  import type { IconName } from '$lib/icons/registry.ts';

  let { icon, title, badge = '', hidden = false, headless = false, label, class: extra = '', children }: {
    icon: IconName; title: string; badge?: string; hidden?: boolean; headless?: boolean; label?: string; class?: string; children: Snippet;
  } = $props();
</script>

<section class="section {extra}" {hidden} aria-label={label}>
  <!-- `headless`: the page already carries this title as its own h1. -->
  {#if !headless}
    <div class="sec-header">
      <span class="sec-icon"><Icon name={icon} /></span><h2 class="sec-title">{title}</h2>
      {#if badge}<span class="sec-badge">{badge}</span>{/if}
    </div>
  {/if}
  {@render children()}
</section>

<style>
  .section { margin-bottom:28px; }
  .sec-header { display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:0; }
  .sec-icon { font-size: 1.2rem; }
  .sec-title { font-size:1.125rem;font-weight:600;color:var(--text-primary); }
  .sec-badge { margin-inline-start:auto;font-size:.8125rem;font-weight:500;color:var(--text-muted); }
</style>
