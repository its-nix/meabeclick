<script lang="ts">
  import TutorPageHeader from '$lib/components/TutorPageHeader.svelte';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>{data.title} — מאה בקליק</title></svelte:head>

<main class="workspace-page" id="workspace-content" tabindex="-1">
  <div class="presentation-heading">
    <TutorPageHeader title={data.title}>
      {#snippet actions()}
        <a class="workspace-button" href={data.returnTo}>{data.returnTo.startsWith('/app/library') ? 'חזרה לספריית התוכן' : 'חזרה לעמוד הקודם'}</a>
      {/snippet}
    </TutorPageHeader>
  </div>
  <!-- The existing document route serves both historical decks and current
       interactive lessons, preserving their tutor preview behavior. -->
  <iframe title="מצגת: {data.title}" src="/lessons/{encodeURIComponent(data.slug)}" sandbox="allow-scripts allow-same-origin allow-modals allow-popups"></iframe>
</main>

<style>
  .presentation-heading { position: sticky; inset-block-start: 65px; z-index: 2; padding-block: 12px; background: var(--bg-base); }
  iframe { display: block; inline-size: 100%; block-size: calc(100dvh - 320px); min-block-size: 360px; margin-block-start: 20px; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-card); }
</style>
