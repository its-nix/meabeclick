<script lang="ts">
  import PlayGame from '../../../play/[template]/+page.svelte';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
</script>
<PlayGame {data}/>
