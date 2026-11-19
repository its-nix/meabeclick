<script lang="ts">
  /**
   * What is owed, what was paid, how to pay, and "I paid" — for whoever pays.
   * Shared by the parent view and the self-learner's home. The caller only
   * mounts it for an account session that is the payer of record; the claim
   * endpoint enforces that again on the server.
   */
  import SectionCard from './SectionCard.svelte';
  import DataTable from './DataTable.svelte';
  import Icon from '$lib/icons/Icon.svelte';
  import { PAYBOX_LINK } from '$lib/contact.ts';
  import { formatAgorot } from '$lib/plans.ts';
  import { formatDateHe, KIND_LABEL, STATUS_LABEL, type Audience, type Balance, type Charge } from '$lib/family-format.ts';

  let { balance, charges, audience, studentName = '', hidden = false, headless = false }: {
    balance?: Balance | null; charges: Charge[]; audience: Audience; studentName?: string; hidden?: boolean; headless?: boolean;
  } = $props();

  let claimBusy = $state<number | null>(null);
  let claimError = $state('');
  /* Claims made on this screen. A claim never changes what is owed: the
     charge only turns paid when the tutor confirms it. */
  let claimedHere = $state<number[]>([]);
  const isClaimed = (c: Charge) => !!c.claimed_at || claimedHere.includes(c.id);

  async function claimPaid(c: Charge) {
    if (claimBusy !== null) return;
    claimBusy = c.id; claimError = '';
    try {
      const r = await fetch('/api/payments/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: c.id }) });
      if (!r.ok) throw new Error(String(r.status));
      claimedHere = [...claimedHere, c.id];
    } catch { claimError = 'לא הצלחנו לשמור. נסו שוב.'; }
    finally { claimBusy = null; }
  }
</script>

{#snippet claimAction(c: Charge)}{#if c.status === 'owed'}{#if isClaimed(c)}<span class="claim-pending"><Icon name="calendar" size={14} /> ממתין לאישור</span>{:else}<button type="button" class="claim-btn" disabled={claimBusy !== null} onclick={() => claimPaid(c)}><Icon name="check" size={16} /> שילמתי</button>{/if}{/if}{/snippet}

<SectionCard icon="payments" title={audience === 'learner' ? 'התשלומים שלי' : 'תשלומים'} {hidden} {headless} class="family-payments">
  {#if balance}
    <div class="payments-summary">
      <div class="pay-sum-card pending">
        <div class="psc-amount">{formatAgorot(balance.dueAgorot)}</div>
        <div class="psc-label">לתשלום עכשיו</div>
      </div>
      <div class="pay-sum-card total">
        <div class="psc-amount">{formatAgorot(balance.upcomingAgorot)}</div>
        <div class="psc-label">מתוכנן קדימה</div>
      </div>
      <div class="pay-sum-card paid">
        <div class="psc-amount">{formatAgorot(balance.paidAgorot)}</div>
        <div class="psc-label">שולם עד כה</div>
      </div>
    </div>
    {#if audience === 'parent'}<p class="pay-note">הסכומים הם של כל המשפחה. הרשימה למטה היא של {studentName}.</p>{/if}
  {/if}
  <!-- The way to pay, beside what is owed. An app link: on a phone it opens PayBox. -->
  <a class="pay-btn" href={PAYBOX_LINK} target="_blank" rel="noopener"><Icon name="payments" size={18} /> לתשלום ב-PayBox</a>
  <p class="pay-note">התשלום אחרי כל שיעור.</p>

  {#if claimError}<p class="pay-note" role="alert">{claimError}</p>{/if}
  <DataTable class="charges-table">
    {#snippet head()}<th>תאריך</th><th>שיעור</th><th>סכום</th><th>סטטוס</th>{/snippet}
    {#if !charges.length}
      <tr><td colspan="4" class="empty-row">אין עדיין חיובים</td></tr>
    {:else}
      {#each charges as c (c.id)}
        <tr>
          <td>{formatDateHe(c.date)}</td>
          <td>{KIND_LABEL[c.kind] ?? c.kind}</td>
          <td style="font-weight:700">{formatAgorot(c.amount_agorot)}</td>
          <td><span class="pay-badge {c.status}">{STATUS_LABEL[c.status] ?? c.status}</span> {@render claimAction(c)}</td>
        </tr>
      {/each}
    {/if}
  </DataTable>
  <ul class="mobile-charges" aria-label={audience === 'learner' ? 'החיובים שלי' : 'החיובים של התלמיד/ה'}>
    {#each charges as charge (charge.id)}
      <li><div><strong>{formatDateHe(charge.date)}</strong><span class="charge-kind">{KIND_LABEL[charge.kind] ?? charge.kind}</span></div><div><strong>{formatAgorot(charge.amount_agorot)}</strong><span class="pay-badge {charge.status}">{STATUS_LABEL[charge.status] ?? charge.status}</span>{@render claimAction(charge)}</div></li>
    {:else}<li>אין עדיין חיובים</li>{/each}
  </ul>
</SectionCard>

<style>
  .payments-summary { display:flex;flex-direction:column;gap:0;margin-bottom:16px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--r-lg);overflow:hidden; }
  .pay-sum-card { display:flex;align-items:center;justify-content:space-between;gap:16px;border-radius:0;padding:18px 20px;background:var(--bg-card);border:0;border-bottom:1px solid var(--border);text-align:start; }
  .pay-sum-card.paid { border:0; }
  .psc-amount { font-size:1.25rem;font-weight:600;font-variant-numeric:tabular-nums;color:var(--text-primary); }
  .psc-label { order:-1;font-size:.9375rem;font-weight:500;color:var(--text-muted);margin:0; }
  .claim-btn, .claim-pending { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 14px; border-radius: var(--radius-pill); font-size: .875rem; font-weight: 700; }
  .claim-btn { background: transparent; border: 1.5px solid var(--action-fill); color: var(--text-primary); cursor: pointer; }
  .claim-btn:disabled { opacity: .6; }
  .claim-pending { color: var(--text-muted); white-space: nowrap; }
  .pay-note { font-size: 0.82rem; color: var(--text-muted); margin: 0.7rem 0 0.2rem; }
  .pay-btn {
    display: inline-flex; align-items: center; gap: 6px; min-height: 44px; margin-top: 12px;
    padding: 0 20px; border-radius: var(--radius-pill); background: var(--action-fill); color: #fff;
    font-weight: 700; text-decoration: none;
  }
  .pay-badge { font-size: 0.75rem; font-weight: 700; padding: 3px 10px; border-radius: 20px; }
  .pay-badge.paid { background: var(--accent3-dim); border: 1px solid var(--accent3-strong); color: var(--accent3-strong); }
  .pay-badge.owed { background: var(--warning-bg); border: 1px solid var(--warning-text); color: var(--warning-text); }
  .pay-badge.void { background: var(--bg-base); border: 1px solid var(--border-strong); color: var(--text-muted); text-decoration: line-through; }
  .mobile-charges { display: none; }
  @media (max-width: 600px) {
    .mobile-charges { display:grid;gap:0;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--r-lg);padding:0 16px; }
    .mobile-charges li { display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding-block:16px;border-bottom:1px solid var(--border); }
    .mobile-charges li:last-child { border:0; }
    .mobile-charges li > div { display:flex;flex-direction:column;gap:8px;min-width:0; }
    .mobile-charges strong { font-size:1rem;font-weight:600; }
    .mobile-charges .charge-kind { font-size:.8125rem;color:var(--text-muted); }
    /* The scoped class sits on DataTable's root, so reach it as a global. */
    :global(.charges-table) { display: none; }
  }
</style>
