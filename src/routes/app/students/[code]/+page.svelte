<script lang="ts">
  // Reuse the tutor workspace, not the child's own homework page. A code
  // change must discard the previous student's forms and issued credentials.
  import TutorWorkspace from '../../dashboard/+page.svelte';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
</script>

{#key data.selectedStudentCode}
  <TutorWorkspace {data} />
{/key}
