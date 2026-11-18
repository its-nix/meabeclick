<script lang="ts">
  import DriveWorkspace from '$lib/components/DriveWorkspace.svelte';
  import TutorPageHeader from '$lib/components/TutorPageHeader.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>מרחב ההוראה — מאה בקליק</title></svelte:head>

{#if data.nativeWorkspace}
  <DriveWorkspace workspace={data.nativeWorkspace} centralDrive={data.centralDrive}/>
{:else}
  <main class="workspace-page" id="workspace-content" tabindex="-1">
    <TutorPageHeader title="מרחב ההוראה" description="מצגות, תרגול ותיקי תלמידים — במקום אחד ב־Google Drive.">
      {#snippet actions()}<a class="workspace-button workspace-button-primary" href="/app/library/connection">מרחב Google</a>{/snippet}
    </TutorPageHeader>
    <p class="note" role="status">מרחב ההוראה עדיין לא הוקם. אחרי החיבור והעברת התוכן הקודם לארכיון ב־Google Drive, השיעורים החדשים יוכנו שם.</p>
  </main>
{/if}

<style>
  .note { color: var(--text-muted-strong); font-size: .95rem; line-height: 1.7; margin: 24px 0 0; max-width: 65ch; }
</style>
