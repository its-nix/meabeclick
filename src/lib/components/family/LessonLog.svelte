<script lang="ts">
  /**
   * The lessons that have happened, newest first, with what was covered.
   * One booked for next week is not a lesson done (FamilyLesson.upcoming).
   */
  import SectionCard from './SectionCard.svelte';
  import DataTable from './DataTable.svelte';
  import { formatDateHe } from '$lib/family-format.ts';
  import type { FamilyLesson } from '$lib/family-lesson.ts';

  let { lessons, audience, hidden = false }: {
    lessons: FamilyLesson[]; audience: 'parent' | 'learner'; hidden?: boolean;
  } = $props();

  const sessions = $derived(
    lessons.filter(l => !l.upcoming).map(l => ({
      date: l.date,
      notes: [l.topic, l.summary].filter(Boolean).join(' — '),
    })).sort((a, b) => b.date.localeCompare(a.date)),
  );
</script>

<SectionCard icon="subjects" title={audience === 'learner' ? 'השיעורים שלי' : 'יומן שיעורים'} badge="{sessions.length} שיעורים" {hidden}>
  <DataTable>
    {#snippet head()}<th>תאריך</th><th>סוג / משך</th><th>נושא / הערות</th>{/snippet}
    {#if !sessions.length}
      <tr><td colspan="3" class="empty-row">עדיין לא נרשמו שיעורים<br /><a class="empty-book" href="/booking">להזמנת שיעור</a></td></tr>
    {:else}
      {#each sessions as sess}
        <tr>
          <td>{formatDateHe(sess.date)}</td>
          <td><span class="pill">שיעור</span></td>
          <td><div class="lesson-topic">{sess.notes || '—'}</div></td>
        </tr>
      {/each}
    {/if}
  </DataTable>
</SectionCard>

<style>
  .pill { display: inline-block; font-size: 0.72rem; font-weight: 700; padding: 3px 9px; border-radius: var(--radius-pill); background: var(--accent-dim); color: var(--accent); border: 1px solid rgba(37,99,235,0.2); }
  .lesson-topic { font-weight: 700; }
  .empty-book { display: inline-flex; align-items: center; min-height: 44px; margin-top: 6px; color: var(--accent); font-weight: 700; text-decoration: none; }
</style>
