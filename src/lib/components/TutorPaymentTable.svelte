<script lang="ts">
  import { formatAgorot } from '$lib/plans.ts';
  import { paymentRows, type PaymentFilter, type PaymentDateOrder } from '$lib/payment-table.ts';

  type Charge = { id: number; date: string; kind: string; amount_agorot: number; status: string };
  let { charges, selected, disabled = false, formatDate, onpick, ontogglepaid, onvoid, onmark }: {
    charges: Charge[] | undefined;
    selected: ReadonlySet<number>;
    disabled?: boolean;
    formatDate: (date: string) => string;
    onpick: (id: number) => void;
    ontogglepaid: (id: number) => void;
    onvoid: (id: number) => void;
    onmark: (status: 'paid' | 'owed' | 'void') => void;
  } = $props();

  const KIND_LABEL: Record<string, string> = { single: 'יחיד', double: 'כפול', triple: 'משולש' };
  const STATUS_LABEL: Record<string, string> = { owed: 'לתשלום', paid: 'שולם', void: 'בוטל' };
  let filter = $state<PaymentFilter>('all');
  let order = $state<PaymentDateOrder>('newest');
  const rows = $derived(paymentRows(charges ?? [], filter, order));
  const selectedCount = $derived((charges ?? []).filter(charge => selected.has(charge.id)).length);
  const hiddenSelectedCount = $derived(selectedCount - rows.filter(charge => selected.has(charge.id)).length);
</script>

<fieldset class="ledger" {disabled}>
  <legend class="sr-only">רישומי תשלום</legend>
  {#if charges?.length}
    <div class="table-controls">
      <label>הצגת תשלומים
        <select bind:value={filter}>
          <option value="all">הכול</option>
          <option value="owed">לא שולם</option>
          <option value="paid">שולם</option>
        </select>
      </label>
      <label>סדר תאריכים
        <select bind:value={order}>
          <option value="newest">מהחדש לישן</option>
          <option value="oldest">מהישן לחדש</option>
        </select>
      </label>
    </div>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need to focus this region to scroll the table.) -->
    <div class="table-scroll" role="region" aria-label="טבלת חיובים ותשלומים — ניתן לגלול אופקית" tabindex="0">
      <table>
        <caption class="sr-only">חיובים ותשלומים</caption>
        <thead><tr><th scope="col">בחירה</th><th scope="col" aria-sort={order === 'newest' ? 'descending' : 'ascending'}>תאריך</th><th scope="col">סוג</th><th scope="col">סכום</th><th scope="col">מצב</th><th scope="col">פעולות</th></tr></thead>
        <tbody>
          {#each rows as charge (charge.id)}
            <tr>
              <td class="selection-cell">
                <label class="charge-target">
                  <input type="checkbox" aria-label="בחירת חיוב מ־{formatDate(charge.date)} בסך {formatAgorot(charge.amount_agorot)}" checked={selected.has(charge.id)} onchange={() => onpick(charge.id)} />
                </label>
              </td>
              <td><bdi>{formatDate(charge.date)}</bdi></td>
              <td>{KIND_LABEL[charge.kind] ?? charge.kind}</td>
              <td><bdi>{formatAgorot(charge.amount_agorot)}</bdi></td>
              <td>{STATUS_LABEL[charge.status] ?? charge.status}</td>
              <td>
                {#if charge.status !== 'void'}
                  <div class="ledger-actions">
                    <button type="button" class="workspace-button" onclick={() => ontogglepaid(charge.id)}>{charge.status === 'paid' ? 'סמן כלא שולם' : 'סמן כשולם'}</button>
                    <button type="button" class="workspace-button danger" onclick={() => onvoid(charge.id)}>ביטול חיוב</button>
                  </div>
                {/if}
              </td>
            </tr>
          {:else}
            <tr><td colspan="6">אין חיובים בסינון שנבחר.</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="selection-summary" role="status">
      נבחרו {selectedCount} חיובים{#if hiddenSelectedCount} · מתוכם {hiddenSelectedCount} מוסתרים בסינון{/if}
    </p>
    <div class="pay-actions">
      <button type="button" class="workspace-button" disabled={!selectedCount} onclick={() => onmark('paid')}>סימון הנבחרים כשולם</button>
      <button type="button" class="workspace-button" disabled={!selectedCount} onclick={() => onmark('owed')}>החזרת הנבחרים לחוב</button>
      <button type="button" class="workspace-button danger" disabled={!selectedCount} onclick={() => onmark('void')}>ביטול החיובים שנבחרו</button>
    </div>
  {:else if charges}
    <p>אין רישומי תשלום עדיין.</p>
  {/if}
</fieldset>

<style>
  .ledger { border: 0; padding: 0; margin: 0; min-inline-size: 0; }
  .table-controls, .ledger-actions, .pay-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .table-controls { margin-block-end: 12px; gap: 12px; }
  .table-controls label { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: .85rem; color: var(--text-muted-strong); }
  select { min-block-size: 44px; max-inline-size: 100%; border: 1px solid var(--border-strong); border-radius: var(--r-sm); padding: 8px 12px; font: inherit; font-size: 1rem; color: var(--text-primary); background: var(--bg-card); }
  .table-scroll { max-inline-size: 100%; overflow-x: auto; border: 1px solid var(--border-strong); border-radius: var(--r-sm); }
  table { inline-size: 100%; min-inline-size: 650px; border-collapse: collapse; font-size: .85rem; }
  th, td { text-align: start; padding: 8px 10px; border-block-end: 1px solid var(--border-strong); color: var(--text-primary); }
  th { background: var(--accent-dim); color: var(--accent-deep); font-weight: 700; white-space: nowrap; }
  td { overflow-wrap: anywhere; }
  td:nth-child(2), td:nth-child(4) { white-space: nowrap; }
  tr:last-child td { border-block-end: 0; }
  tbody tr:hover { background: var(--accent-dim); }
  .selection-cell { padding: 0; inline-size: 44px; }
  .charge-target { display: inline-flex; align-items: center; justify-content: center; min-inline-size: 44px; min-block-size: 44px; cursor: pointer; }
  .charge-target input { inline-size: 18px; block-size: 18px; margin: 0; accent-color: var(--accent); cursor: pointer; }
  .ledger-actions { align-items: center; }
  .ledger-actions .workspace-button { padding: 6px 10px; font-size: .8rem; white-space: nowrap; }
  .workspace-button.danger { color: var(--danger-text); border-color: var(--danger-border); background: var(--danger-bg); }
  .workspace-button:disabled { cursor: default; }
  .selection-summary { margin-block: 10px; font-size: .85rem; color: var(--text-muted-strong); }
  .sr-only { position: absolute; inline-size: 1px; block-size: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
