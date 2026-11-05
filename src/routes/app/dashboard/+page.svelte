<script lang="ts">
  import Icon from '$lib/icons/Icon.svelte';
  import FormulaText from '$lib/components/FormulaText.svelte';
  import TutorPageHeader from '$lib/components/TutorPageHeader.svelte';
  import ReportQueue from '$lib/components/ReportQueue.svelte';
  import EngineNotice from '$lib/components/EngineNotice.svelte';
  import TutorsCard from '$lib/components/TutorsCard.svelte';
  import LearningPlanTree from '$lib/components/LearningPlanTree.svelte';
  import { lockScroll } from '$lib/scroll-lock.ts';
  import type { TutorHomework } from '$lib/tutor-homework.ts';
  import { GRADES, GRADE_BUTTON, GRADE_LABEL, type HomeworkGrade } from '$lib/homework-grade.ts';
  import { formatDateTime, israelDay, israelToday } from '$lib/dates.ts';
  import { sessionAware } from '$lib/tutor-session.ts';
  import { readIssueWords } from '$lib/calendar-words.ts';
  /**
   * Port of pages/app/dashboard.html. Auth is handled entirely by
   * +page.server.ts (requireAuth) — see the comment there for why the old
   * page's client-side lock screen (a readable PASSWORD constant, gated by
   * sessionStorage) is not carried forward.
   *
   * Two independent data stores, exactly as in the source page — this is
   * not something introduced by the port:
   *   - `data.students` — legacy local data used only for the one-time import
   *     bridge and as a temporary fallback while server activity loads.
   *   - the REAL entity model (/api/students) — accounts and students,
   *     rendered in the "כניסה לפורטל" panel below and created via the
   *     "+ תלמיד חדש" modal. It carries no passwords: families reach their
   *     page through a signed link (/api/students/:code/link).
   *   These share no identity (a local student's `id` is a client-generated
   *   `stu_<timestamp>`, unrelated to a real student's `code`) and never did.
   *
   * Ruling P13: the old dashboard.html:725 rendered a lesson's game links as
   * `href="/${g.url}"` unguarded — a new-shape {template,dataId} entry (no
   * `url`) rendered `href="/undefined"`. Fixed at the source: GET
   * /api/lessons (src/routes/api/lessons/+server.ts) now normalizes every
   * game entry the same way /api/portal/[code] already did, and — because
   * this is the tutor's own admin view rather than a child's — keeps a
   * malformed entry visible with `broken: true` instead of dropping it, so
   * a bad link is never silently missing. See that file's header comment
   * for the full reasoning, including why `slidesUrl` is derived via
   * lessonUrl(slug) rather than trusting the stored `slides` string (always
   * a fresh lessonUrl() call, never a stored value — nothing to normalize).
   *
   * `g.url` itself is still mixed-shape the same way parent/student's `url`
   * field is (an old-shape entry has no leading slash; a new-shape one,
   * already run through gameUrl() by the endpoint above, does) — rendering
   * it raw would resolve a legacy link relative to /app/dashboard instead
   * of root, a third silent-failure mode (a real but wrong URL, no visible
   * sign anything's off) that P13 exists to rule out just as much as the
   * other two. toHref() ($lib/urls.ts, shared with parent/ and student/)
   * reconciles it — see that file's header for the full shape writeup.
   *
   * Scoped-CSS trap inventory (every class the old inline <script> toggled
   * via classList after initial render) — all converted to reactive
   * `class:` directives, none left to a bare classList.toggle():
   *   - #save-indicator.show      → saveIndicatorVisible
   *   - .sc-tab.active / .sc-panel.active (per-student tab switch) → activeTab record
   *   - .add-form.open (add-session / add-hw inline forms) → openForms record
   *   - add-student modal → native dialog, modalOpen owns the scroll lock
   *   - #confirm-bg.open (confirm dialog)   → confirmMsg !== null
   */
  import { onMount, untrack } from 'svelte';
  import { page } from '$app/state';
  import { SvelteSet } from 'svelte/reactivity';
  import { toHref } from '$lib/urls.ts';
  import { formatAgorot } from '$lib/plans.ts';
  import { idsForPanel, dueAgorot } from '$lib/payments-selection.ts';
  import { computeImportCandidates, buildImportPayload, type ImportCandidate } from '$lib/import-candidates.ts';
  import type { PageData } from './$types';

  // Named apart from the local fake-CRM `data` below (see that variable's
  // own comment) — this one is the real, server-rendered roster.
  let { data: pageData }: { data: PageData } = $props();
  const selectedStudentCode = $derived(pageData.selectedStudentCode);
  let dashboardPlans = $state(untrack(() => pageData.learningPlans ?? {}));

  /* ═══════════════════ local fake-CRM store ═══════════════════
   * As of this change, this store is no longer where the card's profile
   * comes from (see the real `/api/students` roster below) — only
   * sessions/homework/next-lesson are still genuinely local (task 3: they
   * are explicitly out of scope for this migration and stay in the
   * browser). The old per-field shape (`LocalStudent`) is kept ONLY so a
   * browser that already has a `tutor_dashboard_v2` blob can still be read
   * for the one-time import panel below — nothing here writes goals/
   * style/notes/progress into it any more.
   *
   * Going forward, local extras are keyed by the real student's `code`
   * (`cardExtras`), not by the old client-generated `stu_<timestamp>` id —
   * that id never matched a real student and can't be used to reattach a
   * session/homework list to the card that now renders from the server. */
  interface SessionRec { id: string; date: string; type: string; amount: number; paid: boolean; notes: string; void?: boolean }
  interface NextLesson { date: string; time: string; type: string; tutor?: string | null }
  interface LocalStudent {
    id: string; name: string; subject: string; level: string; style: string; emoji: string;
    goals: string; phone: string; parent: string; progress: number; progressNote: string;
    nextLesson: NextLesson; sessions: SessionRec[]; homework: TutorHomework[]; notes: string;
  }
  interface CardExtras { nextLesson: NextLesson; sessions: SessionRec[]; homework: TutorHomework[] }
  interface ServerActivity extends CardExtras { lessons: { id: number; slug: string; title: string | null; topic: string | null; status: string; lessonAt: string | null }[] }
  interface Store {
    students: LocalStudent[];
    cardExtras?: Record<string, CardExtras>;
    // Set once the tutor has actually clicked "import to server" (see
    // runImport). Its only job is stopping the import panel from silently
    // reappearing every reload and re-offering to overwrite whatever she has
    // since typed on the server — a stale-but-non-empty local value would
    // otherwise clobber freely, since "never blank a real value" only
    // protects an *empty* local value. Persisted via the same save() as
    // everything else in this blob, never touched by anything but a
    // successful import.
    importedProfilesAt?: string;
  }

  function loadData(): Store {
    if (typeof localStorage === 'undefined') return { students: [] };
    try {
      const raw = localStorage.getItem('tutor_dashboard_v2');
      return raw ? JSON.parse(raw) : { students: [] };
    } catch {
      return { students: [] };
    }
  }

  let data = $state<Store>({ students: [] });
  let serverExtras = $state<Record<string, CardExtras>>({});
  let saveIndicatorVisible = $state(false);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  function save() {
    localStorage.setItem('tutor_dashboard_v2', JSON.stringify(data));
    saveIndicatorVisible = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveIndicatorVisible = false; }, 1800);
  }

  const emptyExtras = (): CardExtras => ({ nextLesson: { date: '', time: '', type: 'יחיד' }, sessions: [], homework: [] });

  /** Read-only lookup — used by derived totals, never mutated in place. */
  function extrasFor(code: string): CardExtras {
    return serverExtras[code] ?? emptyExtras();
  }


  // Still used by the add-student modal below: it sets the *enrollment's*
  // level (enrollments.level, a real server column), which is a different
  // thing from the per-card "level" badge/select the old profile tab had —
  // that had no server column at all and is dropped, not migrated (see the
  // profile tab's comment).
  const LEVELS = ['מתחיל', 'בינוני', 'מתקדם', 'מצטיין'];
  const STYLES = ['ויזואלי', 'שמיעתי', 'קינסתטי', 'קריאה/כתיבה'];

  function formatDate(d?: string | null): string {
    if (!d) return '—';
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y}`;
  }

  function studentTotals(code: string) {
    const ex = extrasFor(code);
    const charges = (chargesFor[code] ?? []).filter(c => c.status !== 'void');
    const paid = charges.reduce((a, c) => a + (c.status === 'paid' ? c.amount_agorot : 0), 0) / 100;
    const owed = charges.reduce((a, c) => a + c.amount_agorot, 0) / 100;
    return { paid, owed, balance: owed - paid, hwPending: ex.homework.filter(h => !h.submitted && !h.graded).length };
  }

  // totalSessions / nextLessonsCount are declared further down, once
  // `realStudents` (the real roster) exists — both now depend on it.

  /* The headline money used to be $derived from data.students, the
     browser-local fake CRM — so the tutor's total differed per device and
     vanished when she cleared her browser. It is the same query the parents'
     figures come from now, so the two screens cannot disagree. */
  let allBalance = $state<{ dueAgorot: number; upcomingAgorot: number; paidAgorot: number } | null>(null);
  let balanceError = $state('');
  let balanceSequence = 0;

  async function loadAllBalance() {
    const sequence = ++balanceSequence;
    try {
      const r = await api('/api/payments/all', { cache: 'no-store' });
      if (!r.ok) throw new Error('balance');
      const body = await r.json();
      if (balanceSequence !== sequence) return;
      allBalance = body.balance;
      balanceError = '';
    } catch {
      if (balanceSequence === sequence) balanceError = 'היתרה אינה מעודכנת כרגע.';
    }
  }

  /* ═══════════════════ notifications ═══════════════════
     Non-blocking replacements for alert()/confirm(), same as the source. */
  interface Toast { id: number; message: string; kind: 'info' | 'success' | 'error'; sticky: boolean; link?: { href: string; text: string } }
  let toasts = $state<Toast[]>([]);
  let toastSeq = 0;

  /* Every request on this page goes through `api`. The first 401 says the
     sign-in ran out, once, with the way back; see tutor-session.ts. */
  const session = sessionAware((input, init) => fetch(input, init), () => toast(
    'ההתחברות הסתיימה, והשינוי האחרון לא נשמר. צריך להתחבר מחדש.',
    { kind: 'error', sticky: true, link: { href: '/login?next=/app/dashboard', text: 'להתחברות' } },
  ));
  const api = session.fetch;

  function toast(message: string, opts: { kind?: Toast['kind']; sticky?: boolean; link?: Toast['link'] } = {}) {
    const id = ++toastSeq;
    const kind = opts.kind ?? 'info';
    const sticky = opts.sticky ?? false;
    /* Once the sign-in is gone, every failure is that one, told wrong. */
    if (session.over && kind === 'error' && !opts.link) return;
    toasts.push({ id, message, kind, sticky, link: opts.link });
    if (!sticky) setTimeout(() => dismissToast(id), 5000);
  }
  function dismissToast(id: number) {
    toasts = toasts.filter(t => t.id !== id);
  }

  let confirmMsg = $state<string | null>(null);
  let confirmResolver: ((ok: boolean) => void) | null = null;
  function confirmDialog(message: string): Promise<boolean> {
    return new Promise(resolve => {
      confirmMsg = message;
      confirmResolver = resolve;
    });
  }
  function confirmDone(ok: boolean) {
    confirmResolver?.(ok);
    confirmResolver = null;
    confirmMsg = null;
  }

  /* ═══════════════════ add-student modal ═══════════════════ */
  let modalOpen = $state(false);
  let studentDialog: HTMLDialogElement;
  let newStudentTrigger = $state<HTMLButtonElement>();
  let studentSaving = $state(false);
  let studentError = $state('');
  let nsName = $state(''); let nsSubject = $state(''); let nsEmail = $state('');
  let nsLevel = $state(LEVELS[0]); let nsStyle = $state('');
  let nsGoals = $state(''); let nsPhone = $state('');

  $effect(() => { if (modalOpen) return lockScroll(); });
  function openModal() {
    studentError = '';
    modalOpen = true;
    studentDialog.showModal();
    studentDialog.querySelector<HTMLInputElement>('#ns-name')?.focus();
  }
  function closeModal() { studentDialog.close(); }
  function studentDialogClosed() {
    modalOpen = false;
    newStudentTrigger?.focus();
  }

  async function addStudent() {
    if (studentSaving) return;
    const name = nsName.trim();
    if (!name) {
      studentError = 'נא להזין שם תלמיד/ה.';
      studentDialog.querySelector<HTMLInputElement>('#ns-name')?.focus();
      return;
    }

    studentSaving = true;
    studentError = '';
    const email = nsEmail.trim();
    try {
      const r = await api('/api/students', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, subject: nsSubject || '', level: nsLevel || '', phone: nsPhone || '' }),
      });
      const body = await r.json();
      if (!r.ok) {
        if (session.over) closeModal();
        else studentError = body.error || 'הוספת התלמיד/ה נכשלה. אפשר לנסות שוב.';
        return;
      }

      // goals/style have a server home now (migration 010) — write them
      // right after creation if the tutor filled them in. Best-effort: the
      // student was already created successfully, so a failure here is
      // reported but does not undo that.
      const createdCode = body.student?.code as string | undefined;
      const extra: Record<string, string> = {};
      if (nsGoals.trim()) extra.goals = nsGoals.trim();
      if (nsStyle) extra.style = nsStyle;
      if (createdCode && Object.keys(extra).length) {
        try {
          const pr = await api(`/api/students/${createdCode}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(extra),
          });
          if (!pr.ok) toast('התלמיד/ה נוצר/ה, אך המטרות/הסגנון לא נשמרו', { kind: 'error' });
        } catch {
          toast('התלמיד/ה נוצר/ה, אך המטרות/הסגנון לא נשמרו — אין חיבור לשרת', { kind: 'error' });
        }
      }

      // The family link is minted inside the student record, not the roster.
      toast(
        `הכרטיס של ${name} נוצר. קישור הכניסה למשפחה נמצא בתיק התלמיד/ה.`,
        { kind: 'success', sticky: true, ...(createdCode ? { link: { href: `/app/students/${encodeURIComponent(createdCode)}`, text: 'פתיחת התיק' } } : {}) },
      );
    } catch {
      studentError = 'אין חיבור לשרת — התלמיד/ה לא נוסף/ה. אפשר לנסות שוב.';
      return;
    } finally {
      studentSaving = false;
    }

    closeModal();
    nsName = nsEmail = nsSubject = nsPhone = nsGoals = nsStyle = '';
    nsLevel = LEVELS[0];
    loadCodes();
  }

  /* ═══════════════════ per-student card UI state ═══════════════════ */
  let activeTab = $state<Record<string, string>>({});
  function tabFor(sid: string): string {
    const requested = page.url.searchParams.get('tab');
    return activeTab[sid] ?? (['overview', 'learning-plan', 'payments', 'homework', 'profile'].includes(requested ?? '') ? requested! : 'overview');
  }
  function switchTab(sid: string, tab: string) { activeTab[sid] = tab; }

  let openForms = $state<Record<string, boolean>>({});
  function toggleForm(key: string) { openForms[key] = !openForms[key]; }

  interface SessionForm { date: string; type: string; amount: number; paid: string; notes: string }
  let sessionForms = $state<Record<string, SessionForm>>({});
  function sessionForm(sid: string): SessionForm {
    return sessionForms[sid] ?? { date: israelToday(), type: 'יחיד · 45 דק׳', amount: 120, paid: 'true', notes: '' };
  }
  function setSessionField<K extends keyof SessionForm>(sid: string, field: K, value: SessionForm[K]) {
    sessionForms[sid] = { ...sessionForm(sid), [field]: value };
  }

  interface HwForm { task: string; date: string }
  let hwForms = $state<Record<string, HwForm>>({});
  function hwForm(sid: string): HwForm {
    return hwForms[sid] ?? { task: '', date: israelToday() };
  }
  function setHwField<K extends keyof HwForm>(sid: string, field: K, value: HwForm[K]) {
    hwForms[sid] = { ...hwForm(sid), [field]: value };
  }

  /** Only `nextLesson` is left here — the rest of what this function used
   *  to touch (name/subject/level/style/emoji/phone/parent/goals/notes/
   *  progress/progressNote) is now either server-backed (see
   *  saveProfileField below) or dropped for having no server home
   *  (see the profile tab's comment). Keyed by the student's real `code`,
   *  same as every other local extra now. */
  let activityLoading = $state<Record<string, boolean>>({});
  let activityError = $state<Record<string, string>>({});
  const activitySequence: Record<string, number> = {};
  let ledgerBusy = $state<Record<string, boolean>>({});
  let ledgerLoading = $state<Record<string, boolean>>({});
  let ledgerError = $state<Record<string, string>>({});
  const ledgerSequence: Record<string, number> = {};

  async function refreshActivity(code: string) {
    const sequence = activitySequence[code] = (activitySequence[code] ?? 0) + 1;
    activityLoading[code] = true;
    try {
      const response = await api(`/api/students/${code}/activity`, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('activity load failed');
      const activity = await response.json() as ServerActivity;
      if (activitySequence[code] !== sequence) return;
      serverExtras[code] = activity;
      activityError[code] = '';
    } catch {
      if (activitySequence[code] === sequence) activityError[code] = 'לא ניתן לטעון כרגע. הנתונים הקודמים, אם מוצגים, אינם מעודכנים.';
      throw new Error('activity refresh failed');
    } finally {
      if (activitySequence[code] === sequence) activityLoading[code] = false;
    }
  }
  async function refreshCharges(code: string) {
    const sequence = ledgerSequence[code] = (ledgerSequence[code] ?? 0) + 1;
    ledgerLoading[code] = true;
    try {
      const response = await api(`/api/payments?student=${encodeURIComponent(code)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('charges load failed');
      const result = await response.json();
      if (ledgerSequence[code] !== sequence) return;
      chargesFor[code] = result.charges;
      ledgerError[code] = '';
    } catch {
      if (ledgerSequence[code] === sequence) ledgerError[code] = 'לא ניתן לטעון כרגע את החיובים. הרשימה הקודמת, אם מוצגת, אינה מעודכנת.';
      throw new Error('charges refresh failed');
    } finally {
      if (ledgerSequence[code] === sequence) ledgerLoading[code] = false;
    }
  }
  async function retryActivity(code: string) {
    await refreshActivity(code).catch(() => {});
  }
  async function refreshLedger(code: string) {
    await Promise.allSettled([refreshActivity(code), refreshCharges(code), loadAllBalance()]);
  }

  async function addSession(code: string) {
    const f = sessionForm(code);
    if (!f.date || !f.amount) return;
    if (ledgerBusy[code] || ledgerLoading[code] || ledgerError[code]) return;
    ledgerBusy[code] = true;
    try {
      const r = await api('/api/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentCode: code, date: f.date, kind: f.type.startsWith('כפול') ? 'double' : f.type.startsWith('משולש') ? 'triple' : 'single', amountAgorot: Math.round(+f.amount * 100), paid: f.paid === 'true', note: f.notes }) });
      if (!r.ok) throw new Error();
      await refreshLedger(code);
    } catch { toast('לא ניתן לשמור את השיעור', { kind: 'error' }); }
    finally { ledgerBusy[code] = false; }
  }

  async function togglePaid(code: string, sessId: string) {
    const sess = chargesFor[code]?.find(x => x.id === Number(sessId) && x.status !== 'void');
    if (!sess) return;
    if (ledgerBusy[code] || ledgerLoading[code] || ledgerError[code]) return;
    ledgerBusy[code] = true;
    try {
      const r = await api('/api/payments/mark', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [Number(sessId)], status: sess.status === 'paid' ? 'owed' : 'paid' }) });
      if (!r.ok) throw new Error();
      await refreshLedger(code);
    } catch { toast('לא ניתן לעדכן את התשלום', { kind: 'error' }); }
    finally { ledgerBusy[code] = false; }
  }
  async function voidSession(code: string, sessId: string) {
    if (!await confirmDialog('לבטל את החיוב הזה?')) return;
    if (ledgerBusy[code] || ledgerLoading[code] || ledgerError[code]) return;
    ledgerBusy[code] = true;
    try {
      const r = await api('/api/payments/mark', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [Number(sessId)], status: 'void' }) });
      if (!r.ok) throw new Error();
      await refreshLedger(code);
    } catch { toast('לא ניתן לבטל את הרישום', { kind: 'error' }); }
    finally { ledgerBusy[code] = false; }
  }

  async function addHomework(code: string) {
    const f = hwForm(code);
    const task = f.task.trim();
    if (!task) return;
    try {
      const r = await api(`/api/students/${code}/activity`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'homework', task, date: f.date }) });
      if (!r.ok) throw new Error();
      await refreshActivity(code);
    } catch { toast('לא ניתן לשמור את שיעורי הבית', { kind: 'error' }); }
  }
  async function toggleHw(code: string, hwId: string) {
    const hw = extrasFor(code).homework.find(x => x.id === hwId);
    if (!hw) return;
    try {
      const r = await api(`/api/students/${code}/activity`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'homework', id: Number(hwId), submitted: !hw.submitted }) });
      if (!r.ok) throw new Error();
      await refreshActivity(code);
    } catch { toast('לא ניתן לעדכן את שיעורי הבית', { kind: 'error' }); }
  }
  /** Stage two: she judged it. `null` takes a grade back — a slip of the
   *  finger must be as cheap to undo as the checkbox is. */
  async function gradeHw(code: string, hwId: string, grade: HomeworkGrade | null) {
    try {
      const r = await api(`/api/students/${code}/activity`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'homework', id: Number(hwId), grade }) });
      if (!r.ok) throw new Error();
      await refreshActivity(code);
    } catch { toast('לא ניתן לשמור את הבדיקה', { kind: 'error' }); }
  }

  async function deleteHw(code: string, hwId: string) {
    if (!await confirmDialog('למחוק את שיעורי הבית האלה?')) return;
    try {
      const r = await api(`/api/students/${code}/activity?id=${encodeURIComponent(hwId)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error();
      await refreshActivity(code);
    } catch { toast('לא ניתן למחוק את שיעורי הבית', { kind: 'error' }); }
  }

  /**
   * The card is now a real server student, so "delete" means the real
   * DELETE /api/students/:code — leaving the button wired to nothing but a
   * local-only cleanup would make it lie about what it does. The endpoint
   * already refuses (409) a student with real history (lessons, payments,
   * results), so this cannot silently erase the ledger — see
   * deleteStudentCascade's own comment in entities.ts.
   */
  async function deleteStudent(code: string) {
    if (!await confirmDialog('למחוק את התלמיד/ה?')) return;
    try {
      const r = await api(`/api/students/${code}`, { method: 'DELETE' });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast(body.error || 'המחיקה נכשלה', { kind: 'error' });
        return;
      }
      realStudents = realStudents.filter(x => x.code !== code);
      if (data.cardExtras) delete data.cardExtras[code];
      save();
      if (selectedStudentCode === code) location.href = '/app/dashboard';
    } catch {
      toast('אין חיבור לשרת — התלמיד/ה לא נמחק/ה', { kind: 'error' });
    }
  }

  /* ═══════════════════ real /api/students — access panel ═══════════════════ */
  // Mirrors server/entities.ts RosterRow — this is also now the shape the
  // student cards render from (task: the card's profile comes from the
  // server, not from `tutor_dashboard_v2`).
  interface RealStudent {
    code: string; name: string; emoji: string | null;
    account_id: number;
    progress: number; progress_note: string | null;
    goals: string | null; style: string | null; notes: string | null;
    email: string | null; account_name: string; account_phone: string | null;
    subjects: string | null;
    enrollments: { id: number; subject: string; teacherId: number | null }[];
  }
  interface AccessAccount {
    accountId: number;
    accountName: string;
    email: string | null;
    issueCode: string;
    students: RealStudent[];
  }
  type AccessScope = 'account' | 'student';
  interface IssuedAccess {
    scope: AccessScope;
    name?: string;
    accountName?: string;
    link: string;
    joinCode?: string;
  }
  // Seeded from the server load so a first, JS-free GET already carries the
  // roster (and the plan link on each row); loadCodes() below still keeps
  // it fresh after a link is minted or a student is added client-side.
  // untrack: this is a one-time seed of the initial value, not a binding —
  // the panel never needs to react to `pageData` changing again, and
  // loadCodes() below is what keeps it fresh from here on.
  let realStudents = $state<RealStudent[]>(untrack(() => pageData.roster ?? []));
  const accessAccounts = $derived.by(() => {
    const accounts = new Map<number, AccessAccount>();
    for (const student of realStudents) {
      const account = accounts.get(student.account_id);
      if (account) {
        account.students.push(student);
      } else {
        accounts.set(student.account_id, {
          accountId: student.account_id,
          accountName: student.account_name,
          email: student.email,
          issueCode: student.code,
          students: [student],
        });
      }
    }
    return [...accounts.values()];
  });
  /* The tutors, live: the "מורים" card reports each save (onsaved), so a
     tutor set up on this page is ready in the picker at once, not after a
     reload. */
  let tutors = $state(untrack(() => pageData.tutors));
  const tutorName = (id: number | null): string | null => tutors.find(t => t.id === id)?.name ?? null;
  /** "ניקול", or "ניקול, ליאור" for a student with subjects at both. */
  const tutorsOf = (s: RealStudent): string =>
    [...new Set((s.enrollments ?? []).map(e => tutorName(e.teacherId)).filter(Boolean))].join(', ');

  /** The picker's value for an enrollment: its tutor, or '' when it has
   *  none or theirs is no longer active (the "—" option). */
  const pickerValue = (teacherId: number | null): string =>
    teacherId != null && tutors.some(t => t.id === teacherId) ? String(teacherId) : '';

  /** Moves one enrollment to another tutor. Lessons already booked stay with
   *  the tutor they were booked with; the next booking goes to the new one. */
  async function moveStudent(s: RealStudent, enrollmentId: number, select: HTMLSelectElement) {
    const teacherId = Number(select.value);
    /* A move that did not happen must not stay on screen as if it had — and
       it goes back to what is saved when the undo runs, not when it began. */
    const undo = () => {
      select.value = pickerValue(realStudents.find(x => x.code === s.code)?.enrollments.find(e => e.id === enrollmentId)?.teacherId ?? null);
    };
    if (!Number.isInteger(teacherId) || teacherId <= 0) { undo(); return; }
    /* One move at a time per picker, so a reply that lands late can never
       leave it on a tutor other than the one saved. */
    select.disabled = true;
    try {
      const r = await api(`/api/enrollments/${enrollmentId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ teacherId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { undo(); toast(j.error || 'ההעברה לא הצליחה', { kind: 'error' }); return; }
      realStudents = realStudents.map(x => (x.code !== s.code ? x : {
        ...x, enrollments: x.enrollments.map(e => (e.id === enrollmentId ? { ...e, teacherId } : e)),
      }));
      const to = tutors.find(t => t.id === teacherId);
      /* Moved to a tutor who cannot take bookings yet: the family is offered
         no hours until that tutor's settings are complete. Said now, not
         discovered by the family. */
      const notReady = to && to.missing.length
        ? ` ${to.name} עוד לא מקבל/ת הזמנות — עד שההגדרות יושלמו, למשפחה לא יוצגו שעות פנויות.`
        : '';
      toast(`${s.name} עכשיו אצל ${to?.name ?? tutorName(teacherId)}. שיעורים שכבר נקבעו נשארים כמו שהם.${notReady}`);
    } catch {
      undo();
      toast('אין חיבור לשרת — ההעברה לא נשמרה', { kind: 'error' });
    } finally {
      select.disabled = false;
    }
  }
  let codesLoading = $state(false);
  let codesError = $state('');

  async function updateDashboardPlanStatus(code: string, nodeId: number, status: string) {
    const plan = dashboardPlans[code];
    if (!plan?.planId) return;
    /* Said, not thrown: the tree awaits this and catches nothing, so a
       throw here was a change that silently did not happen. */
    try {
      const response = await api(`/api/plans/${plan.planId}/events`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'status', nodeId, status, evidence: null, note: null }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { toast(body.error || 'עדכון הסטטוס נכשל', { kind: 'error' }); return; }
      dashboardPlans = { ...dashboardPlans, [code]: { ...plan, topics: body.tree } };
    } catch {
      toast('אין חיבור לשרת — הסטטוס לא עודכן', { kind: 'error' });
    }
  }

  async function loadCodes() {
    codesLoading = true;
    codesError = '';
    try {
      const r = await api('/api/students', { cache: 'no-store' });
      const roster = ((await r.json()).students ?? []) as RealStudent[];
      realStudents = selectedStudentCode ? roster.filter(s => s.code === selectedStudentCode) : roster;
    } catch {
      codesError = 'אין חיבור לשרת';
    } finally {
      codesLoading = false;
    }
  }

  async function loadActivities() {
    await Promise.allSettled(realStudents.flatMap(s => [refreshActivity(s.code), refreshCharges(s.code)]));
  }

  // Depend on the real roster now that the student cards render from it —
  // declared here (rather than up near the other derived values) because
  // `realStudents` doesn't exist yet at that point in the script.
  /** Handed in, not yet judged — across every student, for the header. */
  const awaitingReview = $derived(realStudents.reduce(
    (n, st) => n + extrasFor(st.code).homework.filter(h => h.submitted && !h.graded).length, 0));
  const totalSessions = $derived(realStudents.reduce((n, s) => n + extrasFor(s.code).sessions.length, 0));
  const nextLessonsCount = $derived(realStudents.filter(s => {
    const nl = extrasFor(s.code).nextLesson;
    return nl?.date && nl.date >= israelToday();
  }).length);

  const upcomingStudents = $derived(realStudents.filter(s => {
    const next = extrasFor(s.code).nextLesson;
    return next.date && next.date >= israelToday();
  }).sort((a, b) => {
    const left = extrasFor(a.code).nextLesson, right = extrasFor(b.code).nextLesson;
    return (left.date + left.time).localeCompare(right.date + right.time);
  }));

  // Drafts are editable local text, never represented as confirmed server values.
  type ProfileField = 'goals' | 'style' | 'notes' | 'progress' | 'progressNote';
  let profileDrafts = $state<Record<string, string | number | undefined>>({});
  let profileSaving = $state<Record<string, boolean>>({});
  let profileSaved = $state<Record<string, boolean>>({});
  let profileError = $state<Record<string, string>>({});

  async function saveProfileField(code: string, field: ProfileField, value: string | number): Promise<boolean> {
    const key = code + ':' + field;
    if (profileSaving[key]) return false;
    profileDrafts[key] = value;
    profileSaving[key] = true;
    profileError[key] = '';
    profileSaved[key] = false;
    try {
      const r = await api(`/api/students/${code}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(session.over ? 'לא נשמר' : body.error || 'השמירה נכשלה');
      const column = field === 'progressNote' ? 'progress_note' : field;
      // A concurrent save of another field cannot replace this field's draft.
      realStudents = realStudents.map(rs => rs.code === code ? { ...rs, [column]: body.student[column] } : rs);
      if (profileDrafts[key] === value) profileDrafts[key] = undefined;
      profileSaved[key] = true;
      return true;
    } catch (error) {
      profileError[key] = error instanceof Error ? error.message : 'אין חיבור לשרת. הטיוטה לא נשמרה.';
      return false;
    } finally { profileSaving[key] = false; }
  }

  async function onProfileFieldChange(
    s: RealStudent, field: ProfileField, el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  ) {
    const value = field === 'progress' ? Number(el.value) : el.value;
    profileDrafts[s.code + ':' + field] = value;
    await saveProfileField(s.code, field, value);
  }

  /* Admin-only assisted issuance. Account and student are separate actions:
     issuing one scope must not revoke an unused credential for the other. */
  let links = $state<Record<string, IssuedAccess>>({});
  let linkReveal = $state<Record<string, 'available' | 'visible'>>({});
  let linkBusy = $state('');
  let linkConfirm = $state('');

  const accessKey = (scopeId: string | number, scope: AccessScope) => `${scopeId}:${scope}`;

  async function loadLink(code: string, accountId: number, scope: AccessScope) {
    const key = accessKey(scope === 'account' ? accountId : code, scope);
    linkBusy = key;
    const { [key]: _stale, ...withoutStale } = links;
    links = withoutStale;
    const { [key]: _oldReveal, ...withoutReveal } = linkReveal;
    linkReveal = withoutReveal;
    try {
      const r = await api(`/api/students/${code}/link`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope }),
      });
      if (!r.ok) { toast('לא הצלחנו להכין כניסה חדשה. נסו שוב.', { kind: 'error' }); return; }
      links = { ...links, [key]: await r.json() };
      linkConfirm = '';
    } catch {
      toast('לא הצלחנו להכין כניסה חדשה. נסו שוב.', { kind: 'error' });
    } finally {
      linkBusy = '';
    }
  }

  function accessShareHref(access: IssuedAccess): string {
    const who = access.scope === 'account'
      ? `למשפחה של ${access.accountName ?? ''}`
      : `ל${access.name ?? 'התלמיד/ה'} בלבד`;
    const message = `כניסה אישית ${who} במאה בקליק:\n${access.link}\nהקישור תקף ל־15 דקות ולכניסה אחת.`;
    return `https://wa.me/?text=${encodeURIComponent(message)}`;
  }

  function copyAccess(label: string, key: string, value: string) {
    navigator.clipboard.writeText(value)
      .then(() => toast(`${label} הועתק`, { kind: 'success' }))
      .catch(() => {
        linkReveal = { ...linkReveal, [key]: 'available' };
        toast('לא הצלחנו להעתיק. אפשר להציג את הקישור ולהעתיק ידנית.', { kind: 'error' });
      });
  }

  /* ═══════════════════ explicit, reviewed import of the browser's local
     goals/style/notes/progress/progressNote ═══════════════════
   * Never automatic (אין להעתיק נתוני דפדפן אוטומטית בלי בדיקה) — this
   * panel only ever appears when the browser actually has something to
   * show, requires a click to do anything, and never touches localStorage
   * afterwards EXCEPT to record that the click happened (importedProfilesAt
   * — see the Store interface's comment): a stale-but-non-empty local value
   * would otherwise re-offer to overwrite a server edit made since, and the
   * "never blank a real value" rule the server enforces only protects an
   * *empty* local value, not a stale one.
   *
   * computeImportCandidates / buildImportPayload live in
   * $lib/import-candidates.ts — pure, unit-tested there — this file only
   * wires them to the browser's local blob, the roster, and the fetch call.
   * The server side (importLocalStudentProfiles) independently enforces
   * "never blank a real value with an empty local one" and "never create a
   * student"; this UI's job is only to show the tutor, before she clicks,
   * exactly what would be sent, to which student, and what it would replace.
   */
  type ImportOutcome =
    | { code: string; result: 'updated'; fields: string[] }
    | { code: string; result: 'skipped-no-match' }
    | { code: string; result: 'skipped-empty' };
  interface ImportResultRow {
    label: string;
    result: ImportOutcome['result'] | 'skipped-ambiguous';
    fields?: string[];
  }

  let importCandidates = $state<ImportCandidate[]>([]);
  let importRunning = $state(false);
  let importResults = $state<ImportResultRow[] | null>(null);
  // The panel hides itself once `data.importedProfilesAt` is set (see the
  // Store comment) — this is the escape hatch for the genuine "I have
  // another device/browser to import from" case, set only by an explicit
  // click, never automatically.
  let showImportPanelAnyway = $state(false);

  async function runImport() {
    const toSend = buildImportPayload(importCandidates);

    importRunning = true;
    try {
      const r = await api('/api/students/import-local', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: toSend }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { toast('ההעברה נכשלה', { kind: 'error' }); return; }
      const outcomes = (body.results ?? []) as ImportOutcome[];

      // Line up every candidate with an outcome, including the ones that
      // never had a match (or had more than one, and so were never sent) —
      // the tutor sees the full picture, not just what reached the server.
      importResults = importCandidates.map((c): ImportResultRow => {
        if (c.status === 'ambiguous') return { label: c.localName, result: 'skipped-ambiguous' };
        if (c.status !== 'matched' || !c.code) return { label: c.localName, result: 'skipped-no-match' };
        const found = outcomes.find(o => o.code === c.code);
        if (!found) return { label: c.localName, result: 'skipped-no-match' };
        return { label: c.localName, result: found.result, fields: 'fields' in found ? found.fields : undefined };
      });

      // Record that the click happened — this is what keeps the panel from
      // reappearing (and re-offering to overwrite) on the next reload. Set
      // regardless of how many entries actually matched: the tutor reviewed
      // and clicked, which is the action this marker exists to remember.
      data.importedProfilesAt = new Date().toISOString();
      save();
      showImportPanelAnyway = false;

      // Re-render the cards with whatever the import just wrote.
      await loadCodes();
    } catch {
      toast('אין חיבור — שום דבר לא הועבר', { kind: 'error' });
    } finally {
      importRunning = false;
    }
  }

  /* ═══════════════════ real payments — tutor marks charges ═══════════════════
     Driven by realStudents (the real entity model above), not data.students
     (the localStorage CRM) — see this file's header comment. */
  const KIND_LABEL: Record<string, string> = { single: 'יחיד', double: 'כפול', triple: 'משולש' };
  const STATUS_LABEL: Record<string, string> = { owed: 'לתשלום', paid: 'שולם', void: 'בוטל' };

  let chargesFor = $state<Record<string, Array<{ id: number; date: string; kind: string; amount_agorot: number; status: string }>>>({});
  let picked = $state(new SvelteSet<number>());


  function toggle(id: number) {
    if (picked.has(id)) picked.delete(id); else picked.add(id);
  }

  async function mark(code: string, status: 'owed' | 'paid' | 'void') {
    if (ledgerBusy[code] || ledgerLoading[code] || ledgerError[code]) return;
    const ids = idsForPanel(picked, chargesFor[code] ?? []);
    if (!ids.length) { toast('לא נבחרו חיובים', { kind: 'error' }); return; }
    if (status === 'void' && !await confirmDialog('לבטל את החיובים שנבחרו?')) return;
    ledgerBusy[code] = true;
    try {
      const r = await api('/api/payments/mark', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, status }),
      });
      if (!r.ok) throw new Error('payment update');
      for (const id of ids) picked.delete(id);
      await refreshLedger(code);
    } catch { toast('לא ניתן לעדכן את החיובים. בדקו את הרשימה לפני ניסיון נוסף.', { kind: 'error' }); }
    finally { ledgerBusy[code] = false; }
  }

  /* ═══════════════════ calendar-write failures ═══════════════════ */
  interface CalendarFailure { id: number; name: string; start: string }
  let calendarFailures = $state<CalendarFailure[]>([]);

  /* ═══════════════════ calendar-READ issues ═══════════════════
     A feed /api/availability couldn't read this cycle — never identified by
     URL (that's a secret), only by position among the configured feeds. */
  interface CalendarSourceIssue { tutorId: number; tutorName: string; index: number; total: number; at: string; reason: string }
  const ORDINALS = ['הראשון', 'השני', 'השלישי', 'הרביעי', 'החמישי', 'השישי', 'השביעי', 'השמיני', 'התשיעי', 'העשירי'];
  /** «היומן השני של ליאור»: by tutor and position, never by address (a secret). */
  const feedLabel = (s: CalendarSourceIssue): string =>
    `${s.total > 1 ? `היומן ${ORDINALS[s.index - 1] ?? s.index}` : 'היומן'} של ${s.tutorName}`;
  let calendarSourceIssues = $state<CalendarSourceIssue[]>([]);

  async function loadCalendarFailures() {
    try {
      const r = await api('/api/calendar-failures');
      if (!r.ok) return;
      const j = await r.json();
      calendarFailures = (j.failures ?? []) as CalendarFailure[];
      calendarSourceIssues = (j.sourceIssues ?? []) as CalendarSourceIssue[];
    } catch { /* not critical — the booking email already has the same warning */ }
  }
  async function resolveCalendarFailure(id: number) {
    await api(`/api/calendar-failures/${id}/resolve`, { method: 'POST' }).catch(() => {});
    loadCalendarFailures();
  }

  /* ═══════════════════ homework results (/api/results) ═══════════════════ */
  interface TopMissed { item: string; times: number }
  interface ResultsStudent { plays: number; lastPlayed: string | null; accuracy: number | null; wrong: number; tries: number | null; minutes: number; topMissed: TopMissed[] }
  let hwResults = $state<Record<string, ResultsStudent> | null>(null);
  let hwLoading = $state(true);
  let hwError = $state('');

  async function loadHomeworkResults() {
    hwLoading = true;
    hwError = '';
    try {
      const r = await api(`/api/results${selectedStudentCode ? `?studentCode=${encodeURIComponent(selectedStudentCode)}` : ''}`, { credentials: 'same-origin' });
      const j = await r.json();
      if (r.status === 401) { location.href = '/login'; return; }
      if (r.status !== 200) throw new Error(j.error || String(r.status));
      hwResults = j.students ?? {};
    } catch {
      hwError = 'לא הצלחתי לטעון תוצאות כרגע';
    } finally {
      hwLoading = false;
    }
  }
  function accuracyColor(acc: number | null): string {
    if (acc === null) return 'var(--text-muted)';
    if (acc >= 80) return 'var(--accent3-strong)';
    if (acc >= 55) return 'var(--accent2-strong)';
    return 'var(--danger)';
  }

  /* ═══════════════════ auto-generated lessons (/api/lessons) ═══════════════════ */
  interface LessonGame { title: string; url: string | null; broken: boolean }
  interface LessonEntry {
    slug: string; student: string; subject: string | null; title: string | null; topic: string | null;
    context: string | null; status: string; problem: string | null; slidesUrl: string | null;
    homework: unknown[]; games: LessonGame[]; level: string | null;
  }
  let lessons = $state<LessonEntry[]>([]);
  let lessonsLoading = $state(true);
  let lessonsError = $state('');

  const LESSON_BADGE: Record<string, [string, string, string]> = {
    generating: ['בתהליך…', 'var(--text-muted)', 'var(--bg-surface)'],
    ready:      ['מוכן',    'var(--accent3-strong)', 'var(--accent3-dim)'],
    held:       ['לבדיקה',  'var(--accent2-strong)', 'var(--accent2-dim)'],
    failed:     ['נכשל',    'var(--danger)', 'rgba(220,38,38,0.08)'],
  };
  function lessonBadge(status: string): [string, string, string] {
    return LESSON_BADGE[status] ?? LESSON_BADGE.generating;
  }

  async function loadLessons() {
    lessonsLoading = true;
    lessonsError = '';
    try {
      const r = await api(`/api/lessons${selectedStudentCode ? `?studentCode=${encodeURIComponent(selectedStudentCode)}` : ''}`, { credentials: 'same-origin' });
      const j = await r.json();
      if (!r.ok) throw new Error(String(r.status));
      lessons = (j.lessons ?? []) as LessonEntry[];
    } catch {
      lessonsError = 'לא הצלחתי לטעון שיעורים';
    } finally {
      lessonsLoading = false;
    }
  }

  onMount(() => {
    data = loadData();
    // Computed once, off the browser's existing local blob and the roster
    // already seeded from the page load — never re-run automatically after
    // this, per the task's "never automatic" rule. Reviewing/importing is a
    // one-time, explicit action for as long as this panel is visible.
    importCandidates = computeImportCandidates(data.students, realStudents);
    loadCodes();
    loadActivities();
    loadAllBalance();
    if (selectedStudentCode) {
      loadHomeworkResults();
      loadLessons();
    }
    loadCalendarFailures();
  });
</script>

{#snippet profileFeedback(code: string, field: ProfileField)}
  {@const key = code + ':' + field}
  <div class="profile-feedback" role="status" aria-live="polite">
    {#if profileSaving[key]}
      שומרים…
    {:else if profileError[key]}
      <span class="field-error">{profileError[key]} הטקסט נשאר כטיוטה.</span>
      <button class="link-btn" onclick={() => saveProfileField(code, field, profileDrafts[key] ?? '')}>ניסיון שמירה נוסף</button>
    {:else if profileDrafts[key] !== undefined}
      שינויים שטרם נשמרו
      <button class="link-btn" onclick={() => saveProfileField(code, field, profileDrafts[key] ?? '')}>שמירה</button>
    {:else if profileSaved[key]}נשמר{/if}
  </div>
{/snippet}


<svelte:head>
  <title>{selectedStudentCode ? `${realStudents[0]?.name ?? 'תלמיד/ה'} — תיק תלמיד` : 'לוח בקרה — שיעורים פרטיים'}</title>
</svelte:head>

<main class="page workspace-page" id="workspace-content" tabindex="-1">
  <span class="save-indicator" class:show={saveIndicatorVisible} role="status">{saveIndicatorVisible ? '✓ נשמר' : ''}</span>
  {#if !selectedStudentCode}
  <TutorPageHeader title="לוח בקרה" description="השיעורים הקרובים, התלמידים והמשימות שצריכות תשומת לב.">
    {#snippet actions()}
      <a class="workspace-button" href="#student-roster">כל התלמידים</a>
      <button class="workspace-button workspace-button-primary" bind:this={newStudentTrigger} onclick={openModal}><Icon name="add" size={18} /> תלמיד/ה חדש/ה</button>
    {/snippet}
  </TutorPageHeader>
  <EngineNotice alert={pageData.engineAlert} />

  {#if calendarFailures.length}
    <div class="cf-banner">
      <div class="cf-title">⚠️ {calendarFailures.length} שיעור/ים לא נוספו ליומן אוטומטית — צריך להוסיף ידנית</div>
      {#each calendarFailures as f (f.id)}
        <div class="cf-row">
          <span>{f.name} · {String(f.start).slice(0, 16).replace('T', ' ')}</span>
          <button class="cf-resolve" onclick={() => resolveCalendarFailure(f.id)}>הוספתי ליומן <Icon name="check" size={15} /></button>
        </div>
      {/each}
    </div>
  {/if}

  {#if calendarSourceIssues.length}
    <div class="cs-banner" role="alert">
      <div class="cs-title">⛔ קריאת יומן נכשלה — ייתכן ששעות תפוסות מוצגות כפנויות</div>
      {#each calendarSourceIssues as s (`${s.tutorId}-${s.index}`)}
        <div class="cs-row">
          <span class="cs-src">{feedLabel(s)}:</span>
          <span class="cs-reason">{readIssueWords(s.reason)} · {formatDateTime(s.at)}</span>
        </div>
      {/each}
      <div class="cs-note">השעות של היומן/ים האלה לא נבדקו בהצלחה לאחרונה, ולכן ייתכן שהן מוצעות כפנויות בטופס ההזמנה למרות שהן תפוסות בפועל. מומלץ לבדוק ידנית עד שהיומן יחזור להתעדכן.</div>
    </div>
  {/if}

  {#if importResults}
    <div class="import-panel">
      <div class="import-title"><Icon name="done" size={16} /> מה הועבר</div>
      <ul class="import-results">
        {#each importResults as r}
          <li>
            <b>{r.label}</b> —
            {#if r.result === 'updated'}
              נשמר במערכת ({r.fields?.join(', ') ?? ''})
            {:else if r.result === 'skipped-ambiguous'}
              שם כפול בין כמה תלמידים ברשימה — לא ניתן היה לקבוע התאמה ודאית, לא נשלח (טיפול ידני)
            {:else if r.result === 'skipped-no-match'}
              לא נמצא/ה תלמיד/ה בשם הזה במערכת — לא הועבר
            {:else}
              אין מה להעביר (השדות ריקים)
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {:else if importCandidates.length && data.importedProfilesAt && !showImportPanelAnyway}
    <div class="import-hint">
      <span>💾 הפרטים מהמכשיר הזה כבר הועברו למערכת ({formatDate(israelDay(data.importedProfilesAt))}).</span>
      <button class="btn btn-ghost btn-sm tap44" onclick={() => showImportPanelAnyway = true}>
        להציג שוב (למשל, כדי להעביר גם ממכשיר אחר)
      </button>
    </div>
  {:else if importCandidates.length}
    <div class="import-panel">
      <div class="import-title">📋 יש פרטים ששמורים רק במכשיר הזה</div>
      <p class="import-copy">
        מטרות, סגנון למידה, הערות והתקדמות שנכתבו פעם בכרטיס הישן נשמרו רק במכשיר הזה.
        «העברה למערכת» שומרת אותם במערכת, כך שיופיעו בכל מכשיר. שום דבר לא נמחק מהמכשיר.
        אימוג'י, רמה וטלפונים מהכרטיס הישן <b>לא</b> עוברים — כדאי להעתיק אותם אם הם חשובים.
      </p>
      <p class="import-copy" style="font-weight:700">
        ⚠️ מה שכתוב כאן יחליף את מה ששמור עכשיו במערכת (השורה «עכשיו:» בכל תא). תא ריק כאן לא מוחק כלום.
      </p>
      <div class="import-table-wrap">
        <table class="import-table">
          <thead>
            <tr>
              <th>תלמיד/ה (מקומי)</th><th>מטרות</th><th>סגנון</th><th>הערות</th>
              <th>התקדמות (%)</th><th>הערת התקדמות</th><th>תלמיד/ה במערכת</th>
            </tr>
          </thead>
          <tbody>
            {#each importCandidates as c}
              {@const srv = c.code ? realStudents.find(rs => rs.code === c.code) : null}
              <tr>
                <td>{c.localName}</td>
                <td>{c.goals || '—'}<div class="import-server-val">עכשיו: {srv?.goals || '—'}</div></td>
                <td>{c.style || '—'}<div class="import-server-val">עכשיו: {srv?.style || '—'}</div></td>
                <td>{c.notes || '—'}<div class="import-server-val">עכשיו: {srv?.notes || '—'}</div></td>
                <td>{c.progress || 0}%<div class="import-server-val">עכשיו: {srv?.progress ?? 0}%</div></td>
                <td>{c.progressNote || '—'}<div class="import-server-val">עכשיו: {srv?.progress_note || '—'}</div></td>
                <td>
                  {#if c.status === 'matched'}
                    {c.matchName} · <code style="direction:ltr">{c.code}</code>
                  {:else if c.status === 'ambiguous'}
                    <span style="color:var(--danger)">⚠ שם כפול — לא ברור למי, לא יועבר</span>
                  {:else}
                    <span style="color:var(--danger)">⚠ אין תלמיד/ה בשם הזה — לא יועבר</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <button class="btn btn-gold tap44" disabled={importRunning} onclick={runImport}>
        {importRunning ? 'מעבירים…' : '⬆ העברה למערכת'}
      </button>
    </div>
  {/if}

  <h2 class="operations-title">לטיפול היום</h2>
  <ReportQueue lessons={pageData.pendingReports} />
  {#if Object.values(activityError).some(Boolean) || Object.values(ledgerError).some(Boolean)}
    <p role="status">חלק מפרטי התיקים אינם מעודכנים. <button class="link-btn" onclick={loadActivities}>ניסיון עדכון נוסף</button></p>
  {/if}
  <div class="operations">
    <section aria-labelledby="homework-review-title">
      <h2 id="homework-review-title">עבודות ממתינות לבדיקה</h2>
      <ul class="operation-list">
        {#each realStudents.filter(s => extrasFor(s.code).homework.some(h => h.submitted && !h.graded)) as s (s.code)}
          <li><a href="/app/students/{s.code}?tab=homework">{s.name}</a><span>{extrasFor(s.code).homework.filter(h => h.submitted && !h.graded).length} ממתינות לבדיקה</span></li>
        {:else}
          <li>{Object.keys(serverExtras).length === realStudents.length ? 'אין עבודות שממתינות לבדיקה בנתונים שנטענו' : 'ממתינים לפרטי העבודות'}</li>
        {/each}
      </ul>
    </section>
    <section aria-labelledby="upcoming-title">
      <h2 id="upcoming-title">השיעורים הקרובים</h2>
      {#if Object.keys(serverExtras).length < realStudents.length}
        <p role="status">חלק מפרטי השיעורים עדיין לא נטענו. <button class="link-btn" onclick={loadActivities}>עדכון</button></p>
      {/if}
      <ul class="operation-list">
        {#each upcomingStudents as s (s.code)}
          {@const next = extrasFor(s.code).nextLesson}
          <li><a href="/app/students/{s.code}">{s.name}</a><span><bdi>{formatDate(next.date)} · {next.time}</bdi>{next.tutor ? ' · ' + next.tutor : ''}</span></li>
        {:else}
          <li>{Object.keys(serverExtras).length === realStudents.length ? 'אין שיעורים קרובים שנקבעו' : 'ממתינים לפרטי השיעורים'}</li>
        {/each}
      </ul>
    </section>
    <section aria-labelledby="payment-followup-title">
      <h2 id="payment-followup-title">מעקב תשלומים</h2>
      {#if balanceError}<p role="status">{balanceError} <button class="link-btn" onclick={loadAllBalance}>ניסיון נוסף</button></p>{/if}
      <p>{allBalance ? formatAgorot(allBalance.dueAgorot) + ' לגבייה' : 'היתרה הכוללת טרם נטענה'}</p>
      <ul class="operation-list">
        {#each realStudents.filter(s => chargesFor[s.code] && dueAgorot(chargesFor[s.code], israelToday()) > 0) as s (s.code)}
          <li><a href="/app/students/{s.code}?tab=payments">{s.name}</a><span>{formatAgorot(dueAgorot(chargesFor[s.code], israelToday()))} לתשלום עכשיו</span></li>
        {:else}
          <li>{Object.keys(chargesFor).length === realStudents.length && !Object.values(ledgerError).some(Boolean) ? 'אין יתרות פתוחות בנתונים שנטענו' : 'חלק מפרטי החיובים אינם זמינים כרגע'}</li>
        {/each}
      </ul>
    </section>
  </div>
  <h2 class="workspace-tutors-title" id="student-roster">תלמידים</h2>
  <div class="roster-table-wrap">
    <table class="roster-table">
      <caption class="sr-only">תלמידים — פתיחת תיק תלמיד/ה</caption>
      <thead><tr><th scope="col">תלמיד/ה</th><th scope="col">מורה</th><th scope="col">השיעור הבא</th></tr></thead>
      <tbody>
        {#each realStudents as s (s.code)}
          {@const next = extrasFor(s.code).nextLesson}
          {@const reports = pageData.pendingReports.filter(l => l.studentCode === s.code).length}
          <tr>
            <td>
              <a class="student-row-link" href="/app/students/{s.code}">{s.name}</a>
              <span class="roster-meta">{s.subjects || '—'}</span>
              {#if reports}<span class="roster-meta">{reports} מחכים לדיווח</span>{/if}
            </td>
            <td>{tutorsOf(s) || 'טרם שויך'}</td>
            <td>{#if activityError[s.code]}לא מעודכן{:else if !serverExtras[s.code]}טוענים…{:else if next.date}<bdi>{formatDate(next.date)}</bdi><span class="roster-meta"><bdi>{next.time}</bdi></span>{:else}טרם נקבע{/if}</td>
          </tr>
        {:else}
          <tr><td colspan="3">אין תלמידים עדיין — לחצו ״תלמיד חדש״ כדי להתחיל.</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
  <h2 class="workspace-tutors-title">מורים</h2>
  <TutorsCard tutors={pageData.tutors} googleReady={pageData.googleReady}
    onsaved={(t) => { tutors = tutors.map(x => (x.id === t.id ? { ...x, ...t } : x)); }} />
  {:else}
  <TutorPageHeader title={realStudents[0]?.name ?? 'תיק תלמיד/ה'}>
    {#snippet actions()}<a class="workspace-button" href="/app/dashboard">כל התלמידים</a>{/snippet}
  </TutorPageHeader>
  <ReportQueue lessons={pageData.pendingReports} />
  <div class="students-grid">
    {#if !realStudents.length}
      <div class="empty">אין תלמידים עדיין — לחצו "תלמיד חדש" כדי להתחיל</div>
    {:else}
      {#each realStudents as s (s.code)}
        {@const t = studentTotals(s.code)}
        {@const ex = extrasFor(s.code)}
        {@const sf = sessionForm(s.code)}
        {@const hf = hwForm(s.code)}
        <div class="student-card">
          <div class="sc-header">
            <div class="sc-header-left">
              <div class="sc-avatar">{s.emoji || '🎓'}</div>
              <div>
                <div class="sc-name">{s.name}</div>
                <div class="sc-subject">{s.subjects || '—'}{tutorsOf(s) ? ` · ${tutorsOf(s)}` : ''}</div>
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
              <div class="sc-badges">
                {#if s.style}<span class="badge badge-style">{s.style}</span>{/if}
                {#if ledgerError[s.code]}
                  <span class="badge">היתרה אינה מעודכנת</span>
                {:else if ledgerLoading[s.code] || !chargesFor[s.code]}
                  <span class="badge">טוענים יתרה…</span>
                {:else if t.balance > 0}
                  <span class="badge badge-warn">₪{t.balance} חוב</span>
                {:else}
                  <span class="badge badge-ok">שולם ✓</span>
                {/if}
                {#if t.hwPending > 0}
                  <span class="badge badge-warn">{t.hwPending} ש"ב פתוחים</span>
                {/if}
              </div>
              <button class="btn btn-danger btn-sm" onclick={() => deleteStudent(s.code)}><Icon name="delete" size={15} /> מחק</button>
            </div>
          </div>

          <div class="sc-body">
            <nav class="sc-tabs" aria-label="תיק התלמיד/ה">
              <button type="button" class="sc-tab" class:active={tabFor(s.code) === 'overview'} aria-pressed={tabFor(s.code) === 'overview'} onclick={() => switchTab(s.code, 'overview')}>סקירה</button>
              <button type="button" class="sc-tab" class:active={tabFor(s.code) === 'learning-plan'} aria-pressed={tabFor(s.code) === 'learning-plan'} onclick={() => switchTab(s.code, 'learning-plan')}>תכנית למידה</button>
              <button type="button" class="sc-tab" class:active={tabFor(s.code) === 'payments'} aria-pressed={tabFor(s.code) === 'payments'} onclick={() => switchTab(s.code, 'payments')}>תשלומים</button>
              <button type="button" class="sc-tab" class:active={tabFor(s.code) === 'homework'} aria-pressed={tabFor(s.code) === 'homework'} onclick={() => switchTab(s.code, 'homework')}>שיעורי בית</button>
              <button type="button" class="sc-tab" class:active={tabFor(s.code) === 'profile'} aria-pressed={tabFor(s.code) === 'profile'} onclick={() => switchTab(s.code, 'profile')}>פרופיל</button>
            </nav>
            {#if activityError[s.code]}
              <div class="activity-notice" role="status">
                <p>{activityError[s.code]}</p>
                <button class="btn btn-outline" disabled={activityLoading[s.code]} onclick={() => retryActivity(s.code)}>עדכון פרטי השיעור ושיעורי הבית</button>
              </div>
            {:else if activityLoading[s.code] && !serverExtras[s.code]}
              <p class="activity-notice" role="status">טוענים את פרטי השיעור ושיעורי הבית…</p>
            {/if}


            <!-- OVERVIEW -->
            <div class="sc-panel" class:active={tabFor(s.code) === 'overview'}>
              {#if ex.nextLesson?.date}
                <div class="next-lesson-box" style="margin-bottom:14px">
                  <div class="nl-label">📅 שיעור הבא</div>
                  <div class="nl-date">{formatDate(ex.nextLesson.date)}{ex.nextLesson.time ? ' · ' + ex.nextLesson.time : ''}</div>
                  <div class="nl-meta">סוג: {ex.nextLesson.type || 'יחיד'}{ex.nextLesson.tutor ? ` · עם ${ex.nextLesson.tutor}` : ''}</div>
                </div>
              {:else}
                <div class="next-lesson-box" style="margin-bottom:14px">
                  <div class="nl-label">📅 שיעור הבא</div>
                  <div class="nl-date" style="font-size:1rem;color:var(--text-muted)">{!serverExtras[s.code] || activityError[s.code] ? 'פרטי השיעור אינם זמינים כרגע' : 'לא קבוע'}</div>
                </div>
              {/if}

              <div class="divider"></div>

              <!-- Progress / progress-note are server-backed: saving is
                   never optimistic, so this input only ever shows the
                   server's last confirmed value. -->
              <!-- No hand-typed percentage: families see progress computed
                   from the plan and the homework (src/lib/server/progress.ts),
                   and the number typed here reached nobody. -->
              <div class="field">
                <label for="note-{s.code}">הערה להורים על ההתקדמות — מוצגת להורים בלבד, לא לתלמיד/ה</label>
                <textarea id="note-{s.code}" value={profileDrafts[s.code + ':progressNote'] ?? s.progress_note ?? ''}
                  oninput={(e) => { profileDrafts[s.code + ':progressNote'] = e.currentTarget.value; }}
                  onchange={(e) => onProfileFieldChange(s, 'progressNote', e.currentTarget)}></textarea>
                {@render profileFeedback(s.code, 'progressNote')}

              </div>
            </div>

            <!-- PERSONAL LEARNING PLAN -->
            <div class="sc-panel" class:active={tabFor(s.code) === 'learning-plan'}>
              <LearningPlanTree
                returnTo={'/app/students/' + encodeURIComponent(s.code) + '?tab=learning-plan'}
                student={{ id: s.code, name: s.name, subject: s.subjects || '', goals: s.goals || '', level: '', progress: s.progress }}
                lessons={lessons.filter((lesson) => lesson.student === s.name).map((lesson) => ({
                  slug: lesson.slug, title: lesson.title, topic: lesson.topic, context: lesson.context,
                  homework: lesson.homework, games: lesson.games,
                }))}
                topics={dashboardPlans[s.code]?.topics ?? []}
                onstatus={(nodeId, status) => updateDashboardPlanStatus(s.code, nodeId, status)}
              />
            </div>

            <!-- PAYMENTS -->
            <div class="sc-panel" class:active={tabFor(s.code) === 'payments'}>
              {#if ledgerLoading[s.code]}<p role="status">טוענים את הרישומים…</p>{/if}
              {#if ledgerError[s.code]}
                <p class="field-error" role="status">{ledgerError[s.code]}</p>
                <button class="btn btn-outline" disabled={ledgerLoading[s.code]} onclick={() => refreshLedger(s.code)}>ניסיון טעינה נוסף</button>
              {/if}
              {#if chargesFor[s.code]}
              <div class="payment-summary">
                <div class="ps-item"><div class="psi-val" style="color:var(--text-primary)">₪{t.owed}</div><div class="psi-lbl">סה"כ</div></div>
                <div class="ps-item"><div class="psi-val" style="color:var(--accent3-strong)">₪{t.paid}</div><div class="psi-lbl">שולם</div></div>
                <div class="ps-item"><div class="psi-val" style="color:{t.balance > 0 ? 'var(--danger)' : 'var(--accent3-strong)'}">₪{t.balance}</div><div class="psi-lbl">יתרה</div></div>
                <div class="ps-item"><div class="psi-val" style="color:var(--text-primary)">{chargesFor[s.code].filter(c => c.status !== 'void').length}</div><div class="psi-lbl">שיעורים</div></div>
              </div>
              {/if}

              <div class="add-form" class:open={openForms[`${s.code}:session`]}>
                <h4>➕ הוסף שיעור</h4>
                <div class="field-row three">
                  <div class="field"><label for="sf-date-{s.code}">תאריך</label>
                    <input id="sf-date-{s.code}" type="date" value={sf.date} oninput={(e) => setSessionField(s.code, 'date', e.currentTarget.value)} /></div>
                  <div class="field"><label for="sf-type-{s.code}">סוג</label>
                    <select id="sf-type-{s.code}" value={sf.type} onchange={(e) => setSessionField(s.code, 'type', e.currentTarget.value)}>
                      <option value="יחיד · 45 דק׳">יחיד · 45 דק׳</option>
                      <option value="כפול · 90 דק׳">כפול · 90 דק׳</option>
                      <option value="משולש · 135 דק׳">משולש · 135 דק׳</option>
                    </select>
                  </div>
                  <div class="field"><label for="sf-amount-{s.code}">סכום ₪</label>
                    <input id="sf-amount-{s.code}" type="number" value={sf.amount} oninput={(e) => setSessionField(s.code, 'amount', +e.currentTarget.value)} /></div>
                </div>
                <div class="field-row">
                  <div class="field"><label for="sf-paid-{s.code}">סטטוס</label>
                    <select id="sf-paid-{s.code}" value={sf.paid} onchange={(e) => setSessionField(s.code, 'paid', e.currentTarget.value)}>
                      <option value="true">✅ שולם</option><option value="false">⏳ טרם שולם</option>
                    </select>
                  </div>
                  <div class="field"><label for="sf-notes-{s.code}">הערות</label>
                    <input id="sf-notes-{s.code}" type="text" placeholder="הערות לשיעור..." value={sf.notes} oninput={(e) => setSessionField(s.code, 'notes', e.currentTarget.value)} /></div>
                </div>
                <div style="display:flex;gap:8px;margin-top:10px">
                  <button class="btn btn-gold btn-sm" disabled={ledgerBusy[s.code] || ledgerLoading[s.code] || !!ledgerError[s.code] || !chargesFor[s.code]} onclick={() => addSession(s.code)}>שמור שיעור</button>
                  <button class="btn btn-ghost btn-sm" onclick={() => toggleForm(`${s.code}:session`)}>ביטול</button>
                </div>
              </div>

              <button class="btn btn-outline btn-sm" style="margin-bottom:10px" onclick={() => toggleForm(`${s.code}:session`)}>+ הוסף שיעור</button>

              <fieldset class="ledger" disabled={ledgerBusy[s.code] || ledgerLoading[s.code] || !!ledgerError[s.code] || !chargesFor[s.code]}>
                <legend class="sr-only">רישומי תשלום</legend>
                {#if chargesFor[s.code]?.length}
                  <table class="payments-table">
                    <caption class="sr-only">חיובים ותשלומים</caption>
                    <thead><tr><th scope="col">בחירה</th><th scope="col">תאריך</th><th scope="col">סוג</th><th scope="col">סכום</th><th scope="col">מצב</th><th scope="col">פעולות</th></tr></thead>
                    <tbody>
                      {#each chargesFor[s.code] as c (c.id)}
                        <tr>
                          <td data-label="בחירה"><input class="charge-check" type="checkbox" aria-label="בחירת חיוב מ־{formatDate(c.date)} בסך {formatAgorot(c.amount_agorot)}" checked={picked.has(c.id)} onchange={() => toggle(c.id)} /></td>
                          <td data-label="תאריך">{formatDate(c.date)}</td>
                          <td data-label="סוג">{KIND_LABEL[c.kind] ?? c.kind}</td>
                          <td data-label="סכום">{formatAgorot(c.amount_agorot)}</td>
                          <td data-label="מצב">{STATUS_LABEL[c.status] ?? c.status}</td>
                          <td data-label="פעולות"><div class="ledger-actions">
                            {#if c.status !== 'void'}
                              <button class="btn btn-ghost btn-sm" onclick={() => togglePaid(s.code, String(c.id))}>{c.status === 'paid' ? 'סמן כלא שולם' : 'סמן כשולם'}</button>
                              <button class="btn btn-danger btn-sm" onclick={() => voidSession(s.code, String(c.id))}>ביטול חיוב</button>
                            {/if}
                          </div></td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                  <div class="pay-actions">
                    <button class="btn btn-outline" onclick={() => mark(s.code, 'paid')}>סימון הנבחרים כשולם</button>
                    <button class="btn btn-outline" onclick={() => mark(s.code, 'owed')}>החזרת הנבחרים לחוב</button>
                    <button class="btn btn-danger" onclick={() => mark(s.code, 'void')}>ביטול החיובים שנבחרו</button>
                  </div>
                {:else if chargesFor[s.code] && !ledgerError[s.code]}
                  <p>אין רישומי תשלום עדיין.</p>
                {/if}
              </fieldset>
            </div>

            <!-- HOMEWORK -->
            <div class="sc-panel" class:active={tabFor(s.code) === 'homework'}>
              <div class="add-form" class:open={openForms[`${s.code}:hw`]}>
                <h4>➕ הוסף שיעור בית</h4>
                <div class="field-row">
                  <div class="field"><label for="hf-task-{s.code}">משימה</label>
                    <input id="hf-task-{s.code}" type="text" placeholder="תאר את המשימה..." value={hf.task} oninput={(e) => setHwField(s.code, 'task', e.currentTarget.value)} /></div>
                  <div class="field"><label for="hf-date-{s.code}">תאריך</label>
                    <input id="hf-date-{s.code}" type="date" value={hf.date} oninput={(e) => setHwField(s.code, 'date', e.currentTarget.value)} /></div>
                </div>
                <div style="display:flex;gap:8px;margin-top:10px">
                  <button class="btn btn-gold btn-sm" onclick={() => addHomework(s.code)}>שמור</button>
                  <button class="btn btn-ghost btn-sm" onclick={() => toggleForm(`${s.code}:hw`)}>ביטול</button>
                </div>
              </div>

              <button class="btn btn-outline btn-sm" style="margin-bottom:12px" onclick={() => toggleForm(`${s.code}:hw`)}>+ הוסף שיעור בית</button>

              {#if ex.homework.length}
                <div>
                  {#each ex.homework as hw (hw.id)}
                    <div class="hw-item">
                      <input class="hw-check" type="checkbox" aria-label="סימון הגשה: {hw.task}" checked={hw.submitted} onchange={() => toggleHw(s.code, hw.id)} />
                      <div class="hw-text">
                        <div class="hw-task" class:done-text={hw.submitted || hw.graded}><FormulaText text={hw.task} /></div>
                        <div class="hw-date">{formatDate(hw.date)}</div>
                        {#if hw.answer}
                          <!-- The generator's answer key: hers, closed by default so it is not
                               read out over her shoulder while the child is beside her. -->
                          <details class="hw-key"><summary>🔑 תשובון</summary><div class="hw-key-text"><FormulaText text={hw.answer} /></div></details>
                        {/if}
                        {#if hw.submitted && !hw.graded}
                          <!-- Handed in and waiting for her: the child sees
                               «הוגש — ממתין לבדיקה» until one of these. -->
                          <div class="hw-grade" role="group" aria-label="בדיקת שיעורי הבית">
                            {#each GRADES as g (g)}
                              <button class="btn btn-sm hw-grade-btn" onclick={() => gradeHw(s.code, hw.id, g)}>{GRADE_BUTTON[g]}</button>
                            {/each}
                          </div>
                        {:else if hw.graded && hw.grade}
                          <div class="hw-graded">{GRADE_LABEL[hw.grade]} · <button class="link-btn" onclick={() => gradeHw(s.code, hw.id, null)}>ביטול</button></div>
                        {/if}
                        {#if hw.heldUntil}
                          <!-- Held, not missing: the lesson report replaces it with
                               homework from what was taught, or it goes out by itself. -->
                          <div class="hw-held">ממתין לדיווח על השיעור · יישלח לבד ב-{formatDate(israelDay(hw.heldUntil))}</div>
                        {/if}
                      </div>
                      <button class="btn btn-danger btn-sm" aria-label="מחיקת שיעורי הבית" onclick={() => deleteHw(s.code, hw.id)}><Icon name="delete" size={14} /></button>
                    </div>
                  {/each}
                </div>
              {:else}
                <div class="empty">{!serverExtras[s.code] || activityError[s.code] ? 'פרטי שיעורי הבית אינם זמינים כרגע' : 'אין שיעורי בית עדיין'}</div>
              {/if}
            </div>

            <!-- PROFILE — every field here is either server-backed (goals/
                 style/notes) or a read-only render of the server row (name/
                 emoji/phone/account name are edited nowhere in this repo yet;
                 there is no PATCH support for them). -->
            <div class="sc-panel" class:active={tabFor(s.code) === 'profile'}>
              <div class="field-row">
                <div class="field"><span class="field-label">שם</span><div class="readonly-value">{s.name}</div></div>
                <div class="field"><span class="field-label">מקצועות</span><div class="readonly-value">{s.subjects || '—'}</div></div>
              </div>
              {#each s.enrollments ?? [] as en (en.id)}
                <div class="field-row single">
                  <div class="field"><label for="pf-tutor-{en.id}">מורה{s.enrollments.length > 1 ? ` · ${en.subject}` : ''}</label>
                    <select id="pf-tutor-{en.id}" onchange={(e) => moveStudent(s, en.id, e.currentTarget)}>
                      {#if en.teacherId == null}<option value="" selected>— לא נבחר —</option>
                      {:else if !tutorName(en.teacherId)}<option value="" selected>— מורה שכבר לא פעיל/ה —</option>{/if}
                      {#each tutors as tt (tt.id)}<option value={tt.id} selected={en.teacherId === tt.id}>{tt.name}{tt.missing.length ? ' (עוד לא מקבל/ת הזמנות)' : ''}</option>{/each}
                    </select>
                  </div>
                </div>
              {/each}
              <div class="field-row">
                <div class="field"><span class="field-label">טלפון</span><div class="readonly-value" dir="ltr">{s.account_phone || '—'}</div></div>
                <div class="field"><span class="field-label">הורה / חשבון</span><div class="readonly-value">{s.account_name}</div></div>
              </div>
              <div class="field-row three">
                <div class="field"><label for="pf-style-{s.code}">סגנון למידה</label>
                  <select id="pf-style-{s.code}" onchange={(e) => onProfileFieldChange(s, 'style', e.currentTarget)}>
                    <option value="" selected={!s.style}>— לא נבחר —</option>
                    {#each STYLES as st}<option value={st} selected={s.style === st}>{st}</option>{/each}
                  </select>
                  {@render profileFeedback(s.code, 'style')}
                </div>
              </div>
              <div class="field-row single">
                <div class="field"><label for="pf-goals-{s.code}">מטרות</label>
                  <textarea id="pf-goals-{s.code}" value={profileDrafts[s.code + ':goals'] ?? s.goals ?? ''}
                  oninput={(e) => { profileDrafts[s.code + ':goals'] = e.currentTarget.value; }}
                  onchange={(e) => onProfileFieldChange(s, 'goals', e.currentTarget)}></textarea>
                {@render profileFeedback(s.code, 'goals')}
</div>
              </div>
              <div class="field-row single">
                <div class="field"><label for="pf-notes-{s.code}">הערות כלליות</label>
                  <textarea id="pf-notes-{s.code}" value={profileDrafts[s.code + ':notes'] ?? s.notes ?? ''}
                  oninput={(e) => { profileDrafts[s.code + ':notes'] = e.currentTarget.value; }}
                  onchange={(e) => onProfileFieldChange(s, 'notes', e.currentTarget)}></textarea>
                {@render profileFeedback(s.code, 'notes')}
</div>
              </div>

            </div>
          </div>
        </div>
      {/each}
    {/if}
  </div>

  <div class="sec-header" style="margin-top:2.2rem">
    <div>
      <div class="sec-label2">גישה</div>
      <h2 class="sec-h2">כניסה לפורטל</h2>
    </div>
  </div>
  <div class="codes-panel">
    {#if codesLoading}
      <div class="codes-msg">טוען…</div>
    {:else if codesError}
      <div class="codes-msg">{codesError}</div>
    {:else if !realStudents.length}
      <div class="codes-msg">עדיין אין תלמידים עם קוד. הוסיפו תלמיד חדש כדי לייצר קודים.</div>
    {:else}
      <table class="codes-table">
        <thead><tr><th>חשבון / תלמיד</th><th>כניסה</th></tr></thead>
        <tbody>
          {#each accessAccounts as account (account.accountId)}
            {@const accountKey = accessKey(account.accountId, 'account')}
            <tr class="account-access-row">
              <td>
                <span class="access-kind">חשבון</span>
                <strong>{account.accountName}</strong>
                <div class="rs-sub" dir="ltr">{account.email || '— אין מייל'}</div>
              </td>
              <td>
                <div class="rs-scope">
                  {#if links[accountKey]}
                    <p class="access-status" role="status">הכניסה מוכנה למשפחה של {account.accountName}</p>
                    <div class="rs-links">
                      <a class="copy-btn" href={accessShareHref(links[accountKey])} target="_blank" rel="noopener"><Icon name="message" size={15} /> שליחה בוואטסאפ</a>
                      <button class="copy-btn" onclick={() => copyAccess('הקישור למשפחה', accountKey, links[accountKey].link)}>העתקת קישור</button>
                    </div>
                    {#if linkReveal[accountKey] === 'available'}
                      <button class="copy-btn" onclick={() => { linkReveal = { ...linkReveal, [accountKey]: 'visible' }; }}>הצגת הקישור</button>
                    {:else if linkReveal[accountKey] === 'visible'}
                      <code class="raw-access-link" dir="ltr">{links[accountKey].link}</code>
                    {/if}
                    <span class="rs-sub">קישור למשפחה · תקף ל־15 דקות ולכניסה אחת.</span>
                  {:else if linkConfirm === accountKey}
                    <strong>הכנת כניסה חדשה למשפחה של {account.accountName}</strong>
                    <span class="rs-sub">קישורים קודמים למשפחה שעדיין לא שימשו יפסיקו לעבוד.</span>
                    <div class="rs-links">
                      <button class="copy-btn" disabled={linkBusy === accountKey} onclick={() => loadLink(account.issueCode, account.accountId, 'account')}>הכנת כניסה חדשה</button>
                      <button class="copy-btn" disabled={linkBusy === accountKey} onclick={() => { linkConfirm = ''; }}>ביטול</button>
                    </div>
                    {#if linkBusy === accountKey}<p class="access-status" role="status">מכינים…</p>{/if}
                  {:else}
                    <button class="copy-btn" onclick={() => { linkConfirm = accountKey; }}>כניסה למשפחה</button>
                  {/if}
                </div>
              </td>
            </tr>

            {#each account.students as rs (rs.code)}
              {@const studentKey = accessKey(rs.code, 'student')}
              <tr class="student-access-row">
                <td>
                  <span class="access-kind">תלמיד/ה</span>
                  <strong>{rs.name}</strong>
                  <a class="copy-btn plan-link" href="/app/plan/{rs.code}">תכנית</a>
                  <div class="rs-sub"><code dir="ltr">{rs.code}</code> {rs.subjects || ''}</div>
                  <div class="rs-sub">בחשבון של {account.accountName}</div>
                </td>
                <td>
                  <div class="rs-scope">
                    {#if links[studentKey]}
                      <p class="access-status" role="status">הכניסה מוכנה ל{rs.name} בלבד</p>
                      <div class="rs-links">
                        <a class="copy-btn" href={accessShareHref(links[studentKey])} target="_blank" rel="noopener"><Icon name="message" size={15} /> שליחה בוואטסאפ</a>
                        <button class="copy-btn" onclick={() => copyAccess('הקישור לתלמיד/ה', studentKey, links[studentKey].link)}>העתקת קישור</button>
                      </div>
                      {#if linkReveal[studentKey] === 'available'}
                        <button class="copy-btn" onclick={() => { linkReveal = { ...linkReveal, [studentKey]: 'visible' }; }}>הצגת הקישור</button>
                      {:else if linkReveal[studentKey] === 'visible'}
                        <code class="raw-access-link" dir="ltr">{links[studentKey].link}</code>
                      {/if}
                      <span class="rs-join">אין וואטסאפ? פתחו את <span dir="ltr">meabeclick.com/portal</span> והקלידו קוד צירוף: <b dir="ltr">{links[studentKey].joinCode}</b></span>
                      <span class="rs-sub">תקף ל־15 דקות ולכניסה אחת.</span>
                    {:else if linkConfirm === studentKey}
                      <strong>הכנת כניסה חדשה ל{rs.name} בלבד</strong>
                      <span class="rs-sub">קישור וקוד צירוף קודמים לתלמיד/ה שעדיין לא שימשו יפסיקו לעבוד.</span>
                      <div class="rs-links">
                        <button class="copy-btn" disabled={linkBusy === studentKey} onclick={() => loadLink(rs.code, rs.account_id, 'student')}>הכנת כניסה חדשה</button>
                        <button class="copy-btn" disabled={linkBusy === studentKey} onclick={() => { linkConfirm = ''; }}>ביטול</button>
                      </div>
                      {#if linkBusy === studentKey}<p class="access-status" role="status">מכינים…</p>{/if}
                    {:else}
                      <button class="copy-btn" onclick={() => { linkConfirm = studentKey; }}>כניסה לתלמיד/ה בלבד</button>
                    {/if}
                  </div>
                </td>
              </tr>
            {/each}
          {/each}
        </tbody>
      </table>
    {/if}
  </div>

  <div class="sec-header" style="margin-top:2.2rem">
    <div>
      <div class="sec-label2">שיעורי בית</div>
      <h2 class="sec-h2">מצב שיעורי בית 🎮</h2>
    </div>
    <button class="btn-ghost" style="align-self:center" onclick={loadHomeworkResults}>רענון ↻</button>
  </div>
  <div id="hw-results">
    {#if hwLoading}
      <div class="empty">טוען תוצאות…</div>
    {:else if hwError}
      <div class="empty">{hwError}</div>
    {:else if !hwResults || !Object.keys(hwResults).length}
      <div class="empty">עדיין אין תוצאות משחקים לתלמיד/ה.</div>
    {:else}
      {#each Object.entries(hwResults) as [name, res] (name)}
        <div class="hwr-card">
          <div class="hwr-head">
            <div class="hwr-name">{name}</div>
            <div class="hwr-when">{res.lastPlayed ? 'משחק אחרון: ' + formatDate(israelDay(res.lastPlayed)) : ''}</div>
          </div>
          <div class="hwr-stats">
            <div class="hwr-stat"><div class="hwr-val">{res.plays}</div><div class="hwr-lbl">משחקים</div></div>
            <div class="hwr-stat"><div class="hwr-val" style="color:{accuracyColor(res.accuracy)}">{res.accuracy === null ? '—' : res.accuracy + '%'}</div><div class="hwr-lbl">דיוק</div></div>
            <div class="hwr-stat"><div class="hwr-val" style="color:var(--danger)">{res.wrong}</div><div class="hwr-lbl">טעויות</div></div>
            {#if res.tries !== null}
              <div class="hwr-stat"><div class="hwr-val">{res.tries}</div><div class="hwr-lbl">ניסיונות</div></div>
            {/if}
            <div class="hwr-stat"><div class="hwr-val">{res.minutes}</div><div class="hwr-lbl">דקות</div></div>
          </div>
          {#if res.topMissed.length}
            <div class="hwr-missed">
              <div class="hwr-missed-title">🔁 מה חוזר על עצמו כטעות</div>
              {#each res.topMissed as m}
                <div class="hwr-miss"><span>{m.item}</span><span class="hwr-miss-n">×{m.times}</span></div>
              {/each}
            </div>
          {:else}
            <div class="hwr-missed"><div class="hwr-missed-title" style="color:var(--accent3-strong)">✅ אין טעויות חוזרות</div></div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>

  <div class="sec-header" style="margin-top:2.2rem">
    <div>
      <div class="sec-label2">אוטומטי</div>
      <h2 class="sec-h2">שיעורים שנוצרו ✨</h2>
    </div>
    <button class="btn-ghost" style="align-self:center" onclick={loadLessons}>רענון ↻</button>
  </div>
  <div id="lessons-list">
    {#if lessonsLoading}
      <div class="empty">טוען…</div>
    {:else if lessonsError}
      <div class="empty">{lessonsError}</div>
    {:else if !lessons.length}
      <div class="empty">עדיין אין שיעורים משויכים לתלמיד/ה.</div>
    {:else}
      {#each lessons as l (l.slug)}
        {@const b = lessonBadge(l.status)}
        <div class="lsn-card">
          <div class="lsn-head">
            <div>
              <div class="lsn-title">{l.title || l.topic || '—'}</div>
              <div class="lsn-meta">{l.student} · {l.subject || ''} {l.level || ''}</div>
            </div>
            <span class="lsn-badge" style="color:{b[1]};background:{b[2]}">{b[0]}</span>
          </div>
          {#if l.context}<div class="lsn-context">{l.context}</div>{/if}
          {#if l.problem}<div class="lsn-problem">⚠ {l.problem}</div>{/if}
          <div class="lsn-links">
            {#if l.slidesUrl}<a href={l.slidesUrl} target="_blank" rel="noopener">📊 מצגת</a>{/if}
            <!-- The release valve (PRODUCT.md, Lesson autopilot): only a lesson
                 that generated has a plan to edit. -->
            {#if l.status === 'ready'}<a href="/app/lessons/{l.slug}/edit">✏️ עריכה</a>{/if}
            {#each l.games as g}
              {#if g.url}
                <a href={toHref(g.url)} target="_blank" rel="noopener">🎮 {g.title}</a>
              {:else}
                <span class="lsn-broken" title="לא הצלחתי לבנות קישור למשחק הזה">⚠ {g.title} — קישור שבור</span>
              {/if}
            {/each}
          </div>
          {#if l.homework.length}<div class="lsn-hw">📝 {l.homework.length} משימות</div>{/if}
        </div>
      {/each}
    {/if}
  </div>
  {/if}
</main>

<!-- toasts -->
<div class="toast-stack">
  {#each toasts as t (t.id)}
    <div class="toast" class:success={t.kind === 'success'} class:error={t.kind === 'error'} role={t.kind === 'error' ? 'alert' : 'status'}>
      <div style="flex:1;white-space:pre-wrap">{t.message}{#if t.link}<a href={t.link.href}>{t.link.text}</a>{/if}</div>
      <button class="toast-close" aria-label="סגירה" onclick={() => dismissToast(t.id)}><Icon name="close" size={15} /></button>
    </div>
  {/each}
</div>

<!-- confirm dialog -->
<div class="confirm-bg" class:open={confirmMsg !== null}>
  <div class="confirm-box">
    <p>{confirmMsg}</p>
    <div class="row">
      <button onclick={() => confirmDone(false)}>ביטול</button>
      <button class="danger" onclick={() => confirmDone(true)}>אישור</button>
    </div>
  </div>
</div>

<!-- Native dialog provides focus containment and an inert background. -->
<dialog class="student-dialog" bind:this={studentDialog} aria-labelledby="new-student-title"
  onclose={studentDialogClosed} oncancel={(e) => { if (studentSaving) e.preventDefault(); }}>
  <form onsubmit={(e) => { e.preventDefault(); void addStudent(); }}>
    <div class="student-dialog-header">
      <div><h2 id="new-student-title">הוספת תלמיד/ה</h2><p>ניצור כרטיס תלמיד/ה וקישור כניסה למשפחה.</p></div>
      <button type="button" class="dialog-close" aria-label="סגירת הוספת תלמיד/ה" disabled={studentSaving} onclick={closeModal}><Icon name="close" size={20} /></button>
    </div>
    <div class="student-dialog-fields">
      <div class="field"><label for="ns-name">שם התלמיד/ה <span class="required-note">(חובה)</span></label><input id="ns-name" type="text" autocomplete="name" aria-required="true" aria-invalid={Boolean(studentError && !nsName.trim())} aria-describedby={studentError && !nsName.trim() ? 'student-create-error' : undefined} placeholder="שם מלא" bind:value={nsName} /></div>
      <div class="field-row">
        <div class="field"><label for="ns-subject">מקצוע</label><input id="ns-subject" type="text" placeholder="למשל, מתמטיקה" bind:value={nsSubject} /></div>
        <div class="field"><label for="ns-level">רמה</label><select id="ns-level" bind:value={nsLevel}>{#each LEVELS as l}<option value={l}>{l}</option>{/each}</select></div>
      </div>
      <div class="field"><label for="ns-email">אימייל לחשבון <span class="required-note">(לא חובה)</span></label>
        <input id="ns-email" type="email" inputmode="email" autocomplete="email" dir="ltr" placeholder="name@example.com" aria-describedby="ns-email-hint" bind:value={nsEmail} />
        <p class="field-hint" id="ns-email-hint">של ההורה או הלומד/ת, לצורך כניסה לחשבון.</p>
      </div>
      <div class="field"><label for="ns-phone">טלפון <span class="required-note">(לא חובה)</span></label><input id="ns-phone" type="tel" inputmode="tel" autocomplete="tel" dir="ltr" placeholder="050-000-0000" bind:value={nsPhone} /></div>
      <details class="student-extra"><summary>מטרות וסגנון למידה</summary>
        <div class="field"><label for="ns-style">סגנון למידה</label><select id="ns-style" bind:value={nsStyle}><option value="">לא נבחר</option>{#each STYLES as st}<option value={st}>{st}</option>{/each}</select></div>
        <div class="field"><label for="ns-goals">מטרות</label><textarea id="ns-goals" placeholder="מה נרצה להשיג יחד?" bind:value={nsGoals}></textarea></div>
      </details>
      {#if studentError}<p class="student-error" id="student-create-error" role="alert">{studentError}</p>{/if}
    </div>
    <div class="student-dialog-footer">
      <button type="button" class="workspace-button" disabled={studentSaving} onclick={closeModal}>ביטול</button>
      <button type="submit" class="workspace-button workspace-button-primary" disabled={studentSaving}>{studentSaving ? 'מוסיפים…' : 'הוספת תלמיד/ה'}</button>
    </div>
  </form>
</dialog>

<style>
  :global(body) { background: var(--bg-base); }

  input, textarea, select, button { font-family: 'Heebo', sans-serif; }
  input[type='text'], input[type='email'], input[type='date'], input[type='time'], input[type='number'], textarea, select {
    background: var(--bg-surface); border: 1.5px solid var(--border-strong);
    color: var(--text-primary); border-radius: var(--r-sm); padding: 8px 12px;
    font-size: 16px; width: 100%; outline: none; transition: border-color 0.2s;
  }
  input:focus, textarea:focus, select:focus { border-color: var(--accent); }
  #ns-email { min-width: 0; min-height: 44px; font-size: 1rem; }
  #ns-email:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
  textarea { resize: vertical; min-height: 70px; }

  /* ── Buttons ── */
  .btn {
    display: inline-flex; align-items: center; gap: 6px; border: none; cursor: pointer;
    font-family: 'Heebo', sans-serif; font-weight: 700; border-radius: var(--r-sm);
    padding: 8px 18px; font-size: .85rem; transition: opacity .2s, transform .15s;
    text-decoration: none;
  }
  .btn:hover { opacity: .88; transform: translateY(-1px); }
  .btn-gold { background: var(--accent); color: #fff; }
  .btn-outline { background: var(--accent-dim); border: 1.5px solid rgba(37,99,235,0.22); color: var(--accent-deep); }
  .btn-ghost { background: rgba(37,99,235,0.04); border: 1.5px solid var(--border-strong); color: var(--text-muted); cursor: pointer; font-family: 'Heebo', sans-serif; font-weight: 700; border-radius: var(--r-sm); padding: 8px 18px; font-size: .85rem; }
  .btn-danger { background: rgba(220,38,38,0.08); border: 1px solid rgba(220,38,38,0.28); color: var(--danger); }
  .btn-sm { padding: 5px 12px; font-size: .78rem; }

  /* ── Layout ── */
  .workspace-tutors-title { font-size: 1.2rem; margin: 2rem 0 0.75rem; }
  .operations-title { font-size: 1.15rem; margin: 0 0 16px; }
  .operations { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 16px; margin-block: 24px 28px; }
  .operations section { min-width: 0; padding: 20px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--r-md); }
  .operations h2 { font-size: 1.05rem; margin-bottom: 12px; }
  .operation-list { list-style: none; padding: 0; margin: 0; }
  .operation-list li { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px 16px; border-bottom: 1px solid var(--border); padding-block: 10px; }
  .operation-list li:last-child { border-bottom: 0; }
  .operation-list a { display: inline-flex; align-items: center; min-height: 44px; font-weight: 700; color: var(--accent); }
  #student-roster { scroll-margin-top: 80px; }
  .roster-table-wrap { border: 1px solid var(--border); border-radius: var(--r-sm); overflow-x: auto; }
  .roster-table { width: 100%; border-collapse: collapse; background: var(--bg-card); }
  .roster-table th { text-align: start; font-size: 0.85rem; color: var(--text-muted-strong); background: var(--bg-surface); }
  .roster-table th, .roster-table td { padding: 12px; overflow-wrap: anywhere; }
  .roster-table th:first-child { width: 42%; }
  .roster-table th:nth-child(2) { width: 22%; }
  .roster-table td:last-child { font-size: 0.875rem; }
  .roster-table td bdi { white-space: nowrap; }
  .roster-table tbody tr { position: relative; border-top: 1px solid var(--border); }
  .roster-table tbody tr:hover, .roster-table tbody tr:focus-within { background: var(--bg-surface); }
  .student-row-link { display: inline-flex; align-items: center; min-height: 44px; min-width: 44px; color: var(--accent-deep); font-weight: 700; text-decoration: underline; text-underline-offset: 3px; }
  .student-row-link::after { content: ''; position: absolute; inset: 0; }
  .student-row-link:focus-visible::after { outline: 3px solid var(--accent); outline-offset: -3px; }
  .roster-meta { display: block; color: var(--text-muted-strong); font-size: 0.85rem; line-height: 1.5; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

  .cf-banner { background: #FEF2F2; border: 1.5px solid #FCA5A5; border-radius: 14px; padding: 14px 16px; margin-bottom: 16px; }
  .cf-title { font-weight: 800; color: #B91C1C; margin-bottom: 8px; }
  .cf-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 6px 0; border-top: 1px solid #FECACA; font-size: .9rem; }
  .cf-resolve { border: 1.5px solid #B91C1C; background: none; color: #B91C1C; border-radius: 999px; padding: 3px 12px; cursor: pointer; font-size: .8rem; }

  /* Calendar-READ issue banner — a feed /api/availability could not read,
     so its hours may show as free when they aren't. Deliberately distinct
     from .cf-banner by more than colour: a dashed border and its own ⛔
     icon + explicit consequence text, not red alone. */
  .cs-banner { background: var(--bg-card); border: 1.5px dashed var(--danger); border-radius: 14px; padding: 14px 16px; margin-bottom: 16px; }
  .cs-title { font-weight: 800; color: var(--danger); margin-bottom: 8px; }
  .cs-row { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 6px 10px; padding: 6px 0; border-top: 1px solid var(--border-strong); font-size: .9rem; }
  .cs-src { font-weight: 700; color: var(--text-primary); }
  .cs-reason { color: var(--text-muted); font-size: .82rem; }
  .cs-note { margin-top: 8px; font-size: .82rem; color: var(--text-muted); line-height: 1.6; }

  /* ── Local-data import panel (task: explicit, reviewed import — never
     automatic) — a calm informational banner, not an alarm; same visual
     weight as .codes-panel rather than .cf-banner's red. ── */
  .import-panel { background: var(--bg-card); border: 1.5px solid var(--border-strong); border-radius: 14px; padding: 16px 18px; margin-bottom: 16px; }
  .import-title { font-weight: 800; color: var(--text-primary); margin-bottom: 8px; }
  .import-copy { font-size: .85rem; color: var(--text-muted); line-height: 1.6; margin: 0 0 12px; }
  .import-table-wrap { overflow-x: auto; margin-bottom: 12px; }
  .import-table { width: 100%; border-collapse: collapse; font-size: .82rem; }
  .import-table th, .import-table td { text-align: right; padding: 6px 10px; border-bottom: 1px solid var(--border); white-space: normal; }
  .import-table th { color: var(--text-muted); font-weight: 700; }
  .import-results { margin: 0; padding-inline-start: 1.2em; font-size: .88rem; color: var(--text-primary); }
  .import-results li { padding: 3px 0; }
  .import-server-val { color: var(--text-muted); font-size: .74rem; margin-top: 2px; }

  /* Shown instead of the full panel once the browser's local data has
     already been imported once (Store.importedProfilesAt) — a quiet nudge
     with an explicit escape hatch, not the full review table again. */
  .import-hint {
    display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
    background: var(--bg-card); border: 1.5px solid var(--border-strong); border-radius: 14px;
    padding: 12px 16px; margin-bottom: 16px; font-size: .85rem; color: var(--text-muted);
  }

  /* 44px tap target regardless of any font-size/padding a button's other
     classes (e.g. .btn-sm) set — used where a compact button still needs to
     be reliably tappable. */
  .tap44 { min-height: 44px; }


  /* ── Read-only server-sourced profile fields (no write endpoint exists
     for these) ── */
  .readonly-value { padding: 8px 12px; font-size: .88rem; color: var(--text-primary); background: var(--bg-surface); border: 1.5px solid var(--border); border-radius: var(--r-sm); min-height: 1.4em; }
  .field-error { font-size: .78rem; color: var(--danger); margin-top: 4px; }
  .field-hint { margin: 4px 0 0; font-size: .85rem; line-height: 1.5; color: var(--text-muted-strong); }

  /* ── Stats bar ── */


  /* ── Section header ── */
  .sec-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.2rem; }
  .sec-label2 { font-size: .75rem; color: var(--accent2-strong); letter-spacing: .1em; text-transform: uppercase; margin-bottom: 4px; }
  .sec-h2 { font-size: 1.3rem; font-weight: 800; }

  /* ── Homework results ── */
  /* min(340px, 100%): a card wants 340px, but on a phone narrower than that
     the column must shrink to the container instead of pushing the page
     into horizontal scroll. Same for #lessons-list below. */
  #hw-results { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(340px, 100%), 1fr)); gap: 16px; }
  .hwr-card { background: var(--bg-card); border: 1px solid var(--border-strong); border-radius: var(--r-md); padding: 18px 20px; box-shadow: 0 2px 12px var(--shadow); }
  .hwr-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 14px; }
  .hwr-name { font-size: 1.05rem; font-weight: 800; }
  .hwr-when { font-size: .74rem; color: var(--text-muted); white-space: nowrap; }
  .hwr-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(60px, 1fr)); gap: 8px; margin-bottom: 14px; }
  .hwr-stat { background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--r-sm); padding: 8px 4px; text-align: center; }
  .hwr-val { font-size: 1.25rem; font-weight: 900; line-height: 1.15; }
  .hwr-lbl { font-size: .68rem; color: var(--text-muted); margin-top: 2px; }
  .hwr-missed { border-top: 1px solid var(--border); padding-top: 10px; }
  .hwr-missed-title { font-size: .76rem; font-weight: 700; color: var(--text-muted); margin-bottom: 6px; }
  .hwr-miss { display: flex; align-items: center; justify-content: space-between; gap: 8px; background: rgba(220,38,38,0.08); border: 1px solid rgba(220,38,38,0.28); border-radius: var(--r-sm); padding: 5px 10px; margin-bottom: 5px; font-size: .82rem; }
  .hwr-miss-n { font-weight: 800; color: var(--danger); flex-shrink: 0; }
  /* ── Auto-generated lessons ── */
  #lessons-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(340px, 100%), 1fr)); gap: 16px; }
  .lsn-card { background: var(--bg-card); border: 1px solid var(--border-strong); border-radius: var(--r-md); padding: 16px 18px; box-shadow: 0 2px 12px var(--shadow); }
  .lsn-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
  .lsn-title { font-size: 1rem; font-weight: 800; line-height: 1.35; }
  .lsn-meta { font-size: .78rem; color: var(--text-muted); margin-top: 2px; }
  .lsn-badge { font-size: .7rem; font-weight: 800; border-radius: 999px; padding: 2px 10px; white-space: nowrap; flex-shrink: 0; }
  .lsn-context { font-size: .82rem; color: var(--text-muted); margin-top: 8px; line-height: 1.6; }
  .lsn-problem { font-size: .8rem; color: var(--danger); background: rgba(220,38,38,0.08); border-radius: var(--r-sm); padding: 6px 10px; margin-top: 8px; }
  .lsn-links { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .lsn-links a { font-size: .78rem; font-weight: 700; text-decoration: none; background: var(--accent-dim); color: var(--accent); border: 1px solid rgba(37,99,235,0.22); border-radius: 999px; padding: 4px 11px; }
  .lsn-links a:hover { background: var(--accent); color: #fff; }
  .lsn-broken { font-size: .78rem; font-weight: 700; background: rgba(220,38,38,0.08); color: var(--danger); border: 1px solid rgba(220,38,38,0.28); border-radius: 999px; padding: 4px 11px; }
  .lsn-hw { font-size: .78rem; color: var(--text-muted); margin-top: 8px; }

  /* ── Students grid ── */
  .students-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; }

  .student-card { background: var(--bg-card); border: 1px solid var(--border-strong); border-radius: var(--r-lg); overflow: hidden; box-shadow: 0 2px 16px var(--shadow); transition: border-color .2s, box-shadow .2s; }
  .student-card:hover { border-color: var(--accent-soft); box-shadow: 0 4px 24px var(--accent-glow); }

  .sc-header { background: linear-gradient(135deg, var(--accent-dim), rgba(250,130,49,0.04)); border-bottom: 1px solid var(--border-strong); padding: 18px 24px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .sc-header-left { display: flex; align-items: center; gap: 14px; }
  .sc-avatar { width: 48px; height: 48px; border-radius: 50%; background: var(--accent-dim); border: 2px solid rgba(37,99,235,0.22); display: flex; align-items: center; justify-content: center; font-size: 1.4rem; flex-shrink: 0; }
  .sc-name { font-size: 1.1rem; font-weight: 800; color: var(--text-primary); }
  .sc-subject { font-size: .82rem; color: var(--text-muted); margin-top: 2px; }
  .sc-badges { display: flex; gap: 6px; flex-wrap: wrap; }
  .badge { font-size: .72rem; font-weight: 700; padding: 3px 10px; border-radius: 20px; letter-spacing: .04em; }
  .badge-style { background: var(--accent2-dim); border: 1px solid var(--accent2-strong); color: var(--accent2-strong); }
  .badge-ok    { background: var(--accent3-dim); border: 1px solid var(--accent3-strong); color: var(--accent3-strong); }
  .badge-warn  { background: rgba(220,38,38,0.08); border: 1px solid rgba(220,38,38,0.28); color: var(--danger); }

  /* Tabs */
  .sc-tabs { display: flex; flex-wrap: wrap; border-bottom: 1px solid var(--border-strong); padding: 8px 16px; gap: 4px; }
  /* Five tabs are wider than a 360px phone: the row scrolls rather than
     pushing the page sideways. */
  @media (max-width: 480px) { .sc-tabs { padding: 0 8px; } .sc-tab { padding: 10px 11px; } }
  .sc-tab { background: none; border: 0; border-bottom: 2px solid transparent; min-height: 44px; font: inherit; font-size: .9rem; font-weight: 700; color: var(--text-muted-strong); padding: 8px 12px; cursor: pointer; }
  .sc-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .sc-tab:hover:not(.active) { color: var(--text-primary); }

  .sc-panel { display: none; padding: 20px 24px; }
  .sc-panel.active { display: block; }
  :is(button, a, input, select, textarea):focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
  .sc-panel { min-width: 0; }
  .sc-panel button { min-height: 44px; }
  @media (max-width: 600px) { .sc-panel { padding: 16px 12px; } .field-row, .field-row.three { grid-template-columns: minmax(0, 1fr); } .sc-header { flex-wrap: wrap; } }

  /* Fields */
  .activity-notice { margin: 16px 24px; color: var(--text-muted-strong); }
  .profile-feedback { font-size: .875rem; min-height: 24px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .profile-feedback button { min-height: 44px; }
  .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
  .field-row.single { grid-template-columns: 1fr; }
  .field-row.three  { grid-template-columns: 1fr 1fr 1fr; }
  .field { display: flex; flex-direction: column; gap: 5px; }
  .field label, .field-label { font-size: .72rem; font-weight: 700; color: var(--text-muted); letter-spacing: .05em; text-transform: uppercase; }

  /* Payments table */
  .ledger { border: 0; padding: 0; margin: 0; min-width: 0; }
  .ledger-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .charge-check { width: 44px; height: 44px; accent-color: var(--accent); }
  .payment-summary { flex-wrap: wrap; }
  @media (max-width: 700px) {
    .payments-table, .payments-table tbody, .payments-table tr, .payments-table td { display: block; width: 100%; }
    .payments-table thead { display: none; }
    .payments-table tr { border-bottom: 1px solid var(--border); padding-block: 12px; }
    .payments-table td { border: 0; padding: 4px 0; overflow-wrap: anywhere; }
    .payments-table td::before { content: attr(data-label); font-weight: 700; margin-inline-end: 12px; }
  }
  .payments-table { width: 100%; border-collapse: collapse; font-size: .85rem; }
  .payments-table th { text-align: right; padding: 8px 10px; color: var(--accent); font-size: .72rem; letter-spacing: .06em; text-transform: uppercase; border-bottom: 1.5px solid var(--border-strong); background: var(--accent-dim); }
  .payments-table td { padding: 8px 10px; border-bottom: 1px solid var(--border-strong); color: var(--text-primary); }
  .payments-table tr:last-child td { border-bottom: none; }
  .payments-table tr:hover td { background: var(--accent-dim); }

  .payment-summary { display: flex; gap: 20px; margin-bottom: 14px; padding: 12px 16px; background: var(--accent-dim); border: 1px solid rgba(37,99,235,0.22); border-radius: var(--r-md); }
  .ps-item { text-align: center; }
  .ps-item .psi-val { font-size: 1.3rem; font-weight: 900; }
  .ps-item .psi-lbl { font-size: .72rem; color: var(--text-muted); margin-top: 2px; }

  /* Next lesson */
  .next-lesson-box { background: var(--accent-dim); border: 1px solid rgba(37,99,235,0.22); border-radius: var(--r-md); padding: 16px; }
  .nl-label { font-size: .72rem; font-weight: 700; color: var(--accent); letter-spacing: .1em; text-transform: uppercase; margin-bottom: 10px; }
  .nl-date { font-size: 1.5rem; font-weight: 900; color: var(--text-primary); }
  .nl-meta { font-size: .85rem; color: var(--text-muted); margin-top: 4px; }

  /* Homework */
  .hw-item { display: flex; align-items: flex-start; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border-strong); }
  .hw-item:last-child { border-bottom: none; }
  .hw-check { width: 44px; height: 44px; flex: 0 0 44px; margin: 0; accent-color: var(--accent3-strong); cursor: pointer; }
  .hw-text { flex: 1; }
  .hw-task { font-size: .9rem; color: var(--text-primary); }
  .hw-task.done-text { text-decoration: line-through; color: var(--text-muted); }
  .hw-key { margin-top: 4px; font-size: .82rem; }
  .hw-key summary { cursor: pointer; color: var(--accent); font-weight: 700; min-height: 32px; line-height: 32px; }
  .hw-key-text { white-space: pre-wrap; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 6px 8px; }
  .hw-date { font-size: .75rem; color: var(--text-muted); margin-top: 2px; }
  .hw-grade { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .hw-grade-btn { min-height: 44px; }
  .hw-graded { font-size: .8rem; color: var(--accent3-strong); margin-top: 4px; font-weight: 600; }
  .link-btn { background: none; border: none; padding: 0; color: var(--accent); cursor: pointer; font: inherit; text-decoration: underline; }
  .hw-held { font-size: .75rem; color: var(--accent); margin-top: 2px; font-weight: 600; }

  /* Progress bar */

  /* Add form */
  .add-form { background: var(--bg-surface); border: 1.5px solid var(--border-strong); border-radius: var(--r-md); padding: 16px; margin-bottom: 14px; display: none; }
  .add-form.open { display: block; }
  .add-form h4 { font-size: .85rem; font-weight: 700; color: var(--accent); margin-bottom: 12px; }

  /* New student */
  .student-dialog { width: min(560px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); margin: auto; padding: 0; color: var(--text-primary); background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--r-lg); box-shadow: 0 24px 80px rgba(15,23,42,.2); overflow-y: auto; }
  .student-dialog::backdrop { background: rgba(15,23,42,.4); backdrop-filter: blur(4px); }
  .student-dialog-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 24px 24px 0; }
  .student-dialog h2 { font-size: 1.3rem; line-height: 1.4; margin: 0; }
  .student-dialog-header p { font-size: .85rem; color: var(--text-muted); line-height: 1.6; margin-top: 6px; }
  .dialog-close { min-width: 44px; min-height: 44px; margin-top: -8px; margin-inline-end: -10px; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: var(--r-sm); background: transparent; color: var(--text-muted); cursor: pointer; }
  .dialog-close:hover { background: var(--bg-base); }
  .student-dialog-fields { display: grid; gap: 16px; padding: 24px; }
  .student-dialog .field, .student-dialog .field-row { margin: 0; min-width: 0; }
  .student-dialog .field-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .student-dialog input, .student-dialog select, .student-dialog textarea { width: 100%; min-width: 0; min-height: 44px; padding: 8px 12px; background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-strong); border-radius: var(--r-sm); font-size: 16px; }
  .student-dialog input[aria-invalid='true'] { border-color: var(--danger); }
  .student-dialog label { color: var(--text-primary); font-size: .85rem; }
  .required-note { font-weight: 400; color: var(--text-muted); font-size: .8rem; }
  .student-extra { border-top: 1px solid var(--border); }
  .student-extra summary { min-height: 44px; padding-top: 12px; cursor: pointer; color: var(--text-muted-strong); font-size: .85rem; font-weight: 700; }
  .student-extra .field { margin-top: 14px; }
  .student-error { padding: 12px; border-radius: var(--r-sm); background: rgba(220,38,38,.06); color: var(--danger); font-size: .875rem; line-height: 1.6; }
  .student-dialog-footer { position: sticky; bottom: 0; display: flex; justify-content: flex-end; gap: 10px; padding: 16px 24px; border-top: 1px solid var(--border); background: var(--bg-card); }
  .student-dialog :is(input, select, textarea, summary, button):focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
  @media(max-width:600px) { .student-dialog-header { padding: 20px 20px 0; }.student-dialog-fields { padding: 20px; }.student-dialog-footer { padding: 16px 20px; } }

  /* Toasts */
  .toast-stack { position: fixed; top: 18px; left: 50%; transform: translateX(-50%); z-index: 900; display: flex; flex-direction: column; gap: 10px; width: min(420px, 92vw); pointer-events: none; }
  .toast { pointer-events: auto; background: var(--bg-card); border: 1.5px solid var(--border); border-radius: var(--r-md); padding: 14px 16px; box-shadow: 0 10px 32px var(--shadow-md); display: flex; align-items: flex-start; gap: 10px; font-size: .88rem; line-height: 1.6; }
  /* Tints over the card colour: a tint alone let the header show through. */
  .toast.success { border-color: var(--accent3-strong); background: linear-gradient(var(--accent3-dim), var(--accent3-dim)), var(--bg-card); }
  .toast.error   { border-color: rgba(220,38,38,0.28);   background: linear-gradient(rgba(220,38,38,0.08), rgba(220,38,38,0.08)), var(--bg-card); }
  /* Margin, not a space: Svelte trims the space at an {#if} edge. */
  .toast a { margin-inline-start: 0.4em; color: inherit; font-weight: 800; text-decoration: underline; }
  .toast-close { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; min-width: 44px; border: 0; background: none; cursor: pointer; font-size: 1rem; color: var(--text-muted); line-height: 1; padding: 0; flex: none; }

  .confirm-bg { position: fixed; inset: 0; background: rgba(26,51,51,0.4); backdrop-filter: blur(6px); z-index: 950; display: none; align-items: center; justify-content: center; }
  .confirm-bg.open { display: flex; }
  .confirm-box { background: var(--bg-card); border: 1px solid var(--border-strong); border-radius: var(--r-lg); padding: 26px 28px; width: min(360px, 92vw); box-shadow: 0 12px 48px var(--shadow-md); text-align: center; }
  .confirm-box p { font-size: .95rem; margin-bottom: 20px; white-space: pre-wrap; }
  .confirm-box .row { display: flex; gap: 10px; }
  .confirm-box button { flex: 1; border-radius: 999px; padding: 10px; font-family: inherit; font-weight: 700; font-size: .88rem; cursor: pointer; border: 1.5px solid var(--border); background: none; }
  .confirm-box button.danger { background: var(--danger); border-color: var(--danger); color: #fff; }

  /* Divider */
  .divider { height: 1px; background: var(--border-strong); margin: 14px 0; }

  /* Empty state */
  .empty { text-align: center; padding: 24px; color: var(--text-muted); font-size: .9rem; grid-column: 1/-1; }

  .save-indicator { position: fixed; top: 76px; inset-inline-end: 24px; z-index: 110; font-size: .8rem; padding: 6px 12px; border-radius: var(--r-sm); background: var(--bg-card); color: var(--accent3-strong); opacity: 0; pointer-events: none; transition: opacity .3s; }
  .save-indicator.show { opacity: 1; }

  /* Codes panel */
  .codes-panel { background: var(--bg-card); border: 1.5px solid var(--border-strong); border-radius: 18px; padding: 6px 4px; overflow-x: auto; }
  .codes-msg { padding: 16px; color: var(--text-muted); }
  .rs-sub { font-size: .78rem; color: var(--text-muted); margin-top: 3px; }
  .access-kind { display: block; color: var(--text-muted); font-size: .72rem; font-weight: 800; }
  .rs-scope { display: grid; gap: 8px; min-width: 0; }
  .rs-links { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .access-status { margin: 0; font-weight: 800; }
  .rs-join { font-size: .82rem; color: var(--text-muted); }
  .rs-join b { direction: ltr; unicode-bidi: isolate; letter-spacing: .08em; color: var(--accent-deep); }
  .raw-access-link { display: block; max-width: 100%; overflow-wrap: anywhere; unicode-bidi: isolate; }
  .codes-table { width: 100%; border-collapse: collapse; font-size: .9rem; min-width: 560px; }
  .codes-table thead th { text-align: right; color: var(--text-muted); font-size: .78rem; padding: 10px 12px; }
  .codes-table tbody tr { border-top: 1px solid var(--border); }
  .codes-table tbody .account-access-row { border-top: 2px solid var(--border-strong); background: var(--bg-surface); }
  .codes-table tbody .student-access-row td:first-child { padding-inline-start: 28px; }
  .codes-table td { padding: 12px; }
  .copy-btn { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 44px; border: 1.5px solid var(--border-strong); background: none; border-radius: 999px; padding: 5px 14px; cursor: pointer; font-size: .82rem; color: inherit; text-decoration: none; }
  /* .copy-btn alone sits around 28-30px tall — fine for the other buttons in
     this row, which sit beside plenty of other click targets, but this is
     the only way from the roster into the plan page on a phone, so it gets
     its own floor (task 7 review, finding 2). Layout-only: no change to
     .copy-btn's border/background/font-size, so it doesn't touch the
     pre-existing siblings in this row. */
  .plan-link { display: inline-flex; align-items: center; min-height: 44px; text-decoration: none; }

  /* Payments panel */
  .pay-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }

  @media (max-width: 600px) {
    .roster-table th, .roster-table td { padding: 10px 8px; }
    .codes-panel { overflow-x: visible; }
    .codes-table {
      display: block;
      min-width: 0;
      inline-size: 100%;
      max-inline-size: 100%;
      table-layout: fixed;
    }
    .codes-table thead { display: none; }
    .codes-table tbody, .codes-table tr, .codes-table td {
      display: block;
      box-sizing: border-box;
      inline-size: 100%;
      max-inline-size: 100%;
      min-width: 0;
    }
    .codes-table tbody tr { padding: 12px; }
    .codes-table td { padding: 4px 0; }
    .students-grid { grid-template-columns: 1fr; }
    .field-row { grid-template-columns: 1fr; }
    .field-row.three { grid-template-columns: 1fr; }
  }
</style>
