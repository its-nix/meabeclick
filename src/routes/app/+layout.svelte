<script lang="ts">
  import { page } from '$app/state';
  import BottomNav, { type NavItem } from '$lib/components/BottomNav.svelte';
  import TutorHeader from '$lib/components/TutorHeader.svelte';
  import '$lib/styles/tutor-workspace.css';
  /**
   * The app shell for everything under /app/*.
   *
   * IMPORTANT — do not add auth here. `/app/` is a PWA-scope and
   * in-app-navigation boundary, not an authentication boundary (spec §6):
   * /app/dashboard and /app/games require a tutor session, but
   * /app/parent, /app/student and /app/play/* are public (PIN-checked
   * client-side against /api/portal/:code). A blanket guard in
   * +layout.server.ts — or here — would lock children out of their own
   * homework. Each page that needs a session calls requireAuth(event) in
   * its own +page.server.ts instead. Do not "tidy" this upward.
   *
   * The tutor workspace shares a bottom bar across its dashboard, student
   * records, library and marketing pages. Other app pages keep their own
   * navigation, including the student's separate bottom bar.
   */
  let { children } = $props();

  const tutorItems: NavItem[] = [
    { id: 'dashboard', label: 'לוח בקרה', icon: 'dashboard', href: '/app/dashboard' },
    { id: 'library', label: 'ספריית תוכן', icon: 'subjects', href: '/app/library' },
    { id: 'marketing', label: 'שיווק', icon: 'progress', href: '/app/marketing' },
  ];
  const activeTutorSection = $derived(
    /^\/app\/(dashboard|students|plan|report)(\/|$)/.test(page.url.pathname) ? 'dashboard'
      : /^\/app\/(library|games|lessons)(\/|$)/.test(page.url.pathname) ? 'library'
      : /^\/app\/(marketing|metrics)(\/|$)/.test(page.url.pathname) ? 'marketing'
      : undefined,
  );
</script>

<div class:tutor-workspace={activeTutorSection !== undefined}>
  {#if activeTutorSection}<TutorHeader />{/if}
  {@render children()}
</div>

{#if activeTutorSection}
  <BottomNav items={tutorItems} active={activeTutorSection} workspace />
{/if}
