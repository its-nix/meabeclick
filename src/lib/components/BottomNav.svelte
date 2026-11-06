<script lang="ts">
  /**
   * Shared bottom navigation: student board views use buttons, while tutor
   * workspace destinations use links. Fixed to the bottom of the viewport.
   *
   * It replaces a horizontally-scrolling row of pills that sat in the middle
   * of the page. That row did not merely look dated — on a 1080px-wide phone
   * the fourth destination ("שאלה") was CLIPPED AT THE SCREEN EDGE, so the
   * question box was invisible to anyone who did not discover that a row
   * which gives no scroll affordance could be scrolled. A whole feature was
   * hidden on the device the board is mostly used on.
   *
   * Fixed rather than sticky so it never scrolls away, and laid out as equal
   * fractions so four destinations always fit whatever their labels say.
   *
   * ## The bottom inset
   *
   * `env(safe-area-inset-bottom)` is what keeps this above the iPhone home
   * indicator. It resolves to 0 unless the document opts in with
   * `viewport-fit=cover` — see src/app.html. Without both halves the bar
   * renders under the indicator and its labels are unreadable on exactly the
   * phones this is designed for.
   */
  import { onMount } from 'svelte';
  import Icon from '$lib/icons/Icon.svelte';
  import type { IconName } from '$lib/icons/registry.ts';

  export interface NavItem {
    id: string;
    label: string;
    icon: IconName;
    href?: string;
  }

  interface Props {
    items: NavItem[];
    active: string;
    onselect?: (id: string) => void;
    /** Hidden while a text composer has focus, so the on-screen keyboard and
     *  the bar do not stack and eat half a phone screen. */
    hidden?: boolean;
    /** Match the wider tutor workspace without changing the student board. */
    workspace?: boolean;
  }

  let { items, active, onselect, hidden = false, workspace = false }: Props = $props();
  let nav = $state<HTMLElement>();
  onMount(() => {
    if (!nav) return;
    const updateHeight = () => document.body.style.setProperty('--bottom-nav-height', `${nav!.getBoundingClientRect().height}px`);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(nav);
    return () => { observer.disconnect(); document.body.style.removeProperty('--bottom-nav-height'); };
  });
</script>

<nav bind:this={nav} class="bottom-nav" class:hidden class:workspace aria-label="ניווט ראשי">
  {#each items as item (item.id)}
    {#snippet label()}
      <Icon name={item.icon} size={22} />
      <span class="nav-label">{item.label}</span>
    {/snippet}
    {#if item.href}
      <a
        class="nav-item"
        class:active={item.id === active}
        aria-current={item.id === active ? 'page' : undefined}
        href={item.href}
      >
        {@render label()}
      </a>
    {:else}
      <button
        class="nav-item"
        class:active={item.id === active}
        aria-current={item.id === active ? 'page' : undefined}
        onclick={() => onselect?.(item.id)}
      >
        {@render label()}
      </button>
    {/if}
  {/each}
</nav>

<style>
  .bottom-nav {
    position: fixed; inset-inline: 12px; bottom: max(12px, env(safe-area-inset-bottom));
    z-index: 40; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr);
    padding: 4px; background: var(--nav-bg); border: 1px solid var(--border);
    border-radius: 20px; box-shadow: 0 6px 24px var(--shadow-md);
    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
    transition: transform var(--motion-normal);
  }
  .nav-item {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 4px; min-block-size: 56px; min-inline-size: 0; padding: 6px 4px;
    border: 0; border-radius: 14px; background: none; font-family: inherit;
    color: var(--text-muted); text-decoration: none; cursor: pointer;
    transition: color var(--motion-fast), background var(--motion-fast);
  }
  .nav-item:hover { background: var(--control-bg); color: var(--text-primary); }
  .nav-item.active, .workspace .nav-item.active { color: var(--accent-deep); background: var(--accent-dim); }
  .nav-item:focus-visible { outline: 3px solid var(--accent); outline-offset: -3px; }
  .nav-label { font-size: .75rem; font-weight: 600; line-height: 1.35; text-align: center; overflow-wrap: anywhere; }
  .hidden { transform: translateY(calc(100% + 32px)); visibility: hidden; }
  @media (min-width: 640px) {
    .bottom-nav { inset-inline: 50%; transform: translateX(50%); max-inline-size: 560px; inline-size: calc(100% - 48px); }
    .hidden { transform: translateX(50%) translateY(calc(100% + 32px)); }
  }
  @media (prefers-reduced-transparency: reduce) { .bottom-nav { backdrop-filter: none; background: var(--bg-card); } }
  @media (prefers-reduced-motion: reduce) { .bottom-nav, .nav-item { transition: none; } }
</style>
