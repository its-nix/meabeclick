<script lang="ts">
  /**
   * Hebrew text with plain formulas in it («א. 8-x-3=5-x»), each formula
   * isolated left to right — see $lib/bidi.ts. For LaTeX-delimited answers
   * use $lib/math/MathText.svelte instead.
   */
  import { mathText } from '$lib/learning/math.ts';
  import 'katex/dist/katex.min.css';
  let { text }: { text: string } = $props();
  const markup = $derived(mathText(text));
</script>

<span class="formula-text">{@html markup}</span>

<style>
  /* One formula, one line: "-2(x" at the end of a line and "+ 5)" at the
     start of the next reads as two things. Formulas here are short. */
  .formula-text :global(bdi) { white-space: nowrap; }
  .formula-text :global(.learning-math) { display: inline-block; max-width: 100%; overflow-x: auto; overflow-y: hidden; vertical-align: middle; direction: ltr; unicode-bidi: isolate; }
</style>
