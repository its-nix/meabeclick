<script lang="ts">
  import { matchesPlanFilter, type FilterKind } from '$lib/plan-status.ts';

  type Kind = 'subject' | 'topic' | 'subtopic' | 'goal';
  type Progress = { total: number; completed: number; mastered: number; percent: number };
  type CurriculumSkill = { id: number; title: string; status: string; visibility: string; changed?: boolean; recommended?: boolean; blocked?: boolean };
  type CurriculumBranch = { id: number; title: string; visibility: string; progress: Progress; skills: CurriculumSkill[] };
  type CurriculumTopic = { id: number; title: string; visibility: string; progress: Progress; branches: CurriculumBranch[] };
  type Student = { id: string; name: string; subject: string; goals: string; level: string; progress: number };
  type Node = {
    id: string; sourceId?: number; sourceStatus?: string; kind: Kind; title: string; subtitle: string; status: string; progress: Progress;
    children: Node[];
  };
  type FlatNode = Node & { depth: number; hasChildren: boolean };

  let { student, topics = [], filter = 'all', returnTo = '/app/dashboard', onstatus }: { student: Student; topics?: CurriculumTopic[]; filter?: FilterKind; returnTo?: string; onstatus?: (nodeId: number, status: string) => void | Promise<void> } = $props();
  let expanded = $state<string[]>([]);
  let collapsed = $state<string[]>([]);
  let filterContext = '';
  $effect(() => {
    const context = student.id + ':' + filter;
    if (context !== filterContext) {
      collapsed = [];
      editingStatus = null;
      filterContext = context;
    }
  });
  let editingStatus = $state<string | null>(null);
  const statusOptions = [
    ['not_checked', 'לא נבדק'], ['started', 'התחלה'], ['guided', 'בתרגול מודרך'],
    ['with_help', 'בוצע עם עזרה'], ['independent', 'בוצע עצמאית'], ['needs_review', 'דורש חזרה'],
  ] as const;

  const statusLabels = ['טרם התחלנו', 'בתהליך', 'נדרש חיזוק', 'הושלם'];
  const statusClass: Record<string, string> = {
    'טרם התחלנו': 'status-not-started', 'בתהליך': 'status-progress',
    'נדרש חיזוק': 'status-needs-help', 'הושלם': 'status-done',
  };

  function slug(value: string): string {
    return value.toLocaleLowerCase('he').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/(^-|-$)/g, '') || 'item';
  }

  function statusFor(status: string): string {
    if (status === 'independent') return 'הושלם';
    if (status === 'guided' || status === 'with_help') return 'בתהליך';
    if (status === 'needs_review' || status === 'blocked') return 'נדרש חיזוק';
    return 'טרם התחלנו';
  }

  function skillProgress(status: string): Progress {
    const completed = status === 'independent' || status === 'with_help' ? 1 : 0;
    return { total: 1, completed, mastered: status === 'independent' ? 1 : 0, percent: completed ? 100 : 0 };
  }

  function aggregateProgress(items: Progress[]): Progress {
    const total = items.reduce((n, p) => n + p.total, 0);
    const completed = items.reduce((n, p) => n + p.completed, 0);
    const mastered = items.reduce((n, p) => n + p.mastered, 0);
    return { total, completed, mastered, percent: total ? Math.round((completed / total) * 100) : 0 };
  }

  function buildCurriculumTopics(): Node[] {
    return topics.filter(topic => topic.visibility !== 'hidden').map(topic => {
      const branches = topic.branches.filter(branch => branch.visibility !== 'hidden').map(branch => {
        const skills = branch.skills
          .filter(skill => matchesPlanFilter(skill, filter))
          .map(skill => ({
            id: `goal:${skill.id}`, sourceId: skill.id, sourceStatus: skill.status, kind: 'goal' as const, title: skill.title,
            subtitle: 'יכולת מתוך תכנית הלימודים', status: statusFor(skill.status),
            progress: skillProgress(skill.status),
            children: [],
          }));
        return {
          id: `subtopic:${branch.id}`, kind: 'subtopic' as const, title: branch.title,
          subtitle: `${branch.progress.completed} מתוך ${branch.progress.total} יעדים הושלמו`, status: skills.some(skill => skill.status === 'נדרש חיזוק') ? 'נדרש חיזוק' : branch.progress.completed ? 'בתהליך' : 'טרם התחלנו', progress: branch.progress,
          children: skills,
        };
      }).filter(branch => filter === 'all' || branch.children.length > 0);
      return {
        id: `topic:${topic.id}`, kind: 'topic' as const, title: topic.title,
        subtitle: `${topic.progress.completed} מתוך ${topic.progress.total} יעדים הושלמו`,
        status: topic.progress.completed ? 'בתהליך' : 'טרם התחלנו', progress: topic.progress,
        children: branches,
      };
    }).filter(topic => filter === 'all' || topic.children.length > 0);
  }

  function buildTree(): Node {
    if (topics.length) {
      const curriculumTopics = buildCurriculumTopics();
      return {
        id: `subject:${student.id}`, kind: 'subject', title: student.subject || 'תכנית אישית',
        subtitle: `${student.level || 'לפי רמת התלמיד'} · ${curriculumTopics.length} נושאים · ${curriculumTopics.reduce((n, t) => n + t.progress.completed, 0)} יעדים הושלמו`,
        status: curriculumTopics.some(t => t.progress.completed) ? 'בתהליך' : 'טרם התחלנו', progress: aggregateProgress(curriculumTopics.map(t => t.progress)),
        children: curriculumTopics,
      };
    }
    const startTopics = [{
      id: 'topic:start', kind: 'topic', title: 'מיפוי והתחלה',
      subtitle: student.goals || 'נוסיף כאן את הנושא הראשון לאחר השיעור', status: 'טרם התחלנו', progress: { total: 1, completed: 0, mastered: 0, percent: 0 },
      children: [{
        id: 'subtopic:start', kind: 'subtopic', title: 'אבחון קצר', subtitle: 'ניסיון ראשון לפני בחירת תרגול',
        status: 'טרם התחלנו', progress: { total: 1, completed: 0, mastered: 0, percent: 0 }, children: [{
          id: 'goal:start', kind: 'goal', title: 'להגדיר יעד ראשון', subtitle: 'היעד יתעדכן לאחר דיווח השיעור',
          status: 'טרם התחלנו', progress: { total: 1, completed: 0, mastered: 0, percent: 0 }, children: [],
        }],
      }],
    } satisfies Node];

    return {
      id: `subject:${student.id}`, kind: 'subject', title: student.subject || 'תכנית אישית',
      subtitle: `${student.level || 'רמה לא הוגדרה'} · ${topics.length} נושאים`,
      status: student.progress >= 100 ? 'הושלם' : student.progress > 0 ? 'בתהליך' : 'טרם התחלנו', progress: { total: startTopics.length, completed: 0, mastered: 0, percent: 0 },
      children: startTopics,
    };
  }

  const tree = $derived(buildTree());
  const visibleNodes = $derived.by(() => {
    const output: FlatNode[] = [];
    function visit(node: Node, depth: number) {
      output.push({ ...node, depth, hasChildren: node.children.length > 0 });
      if (isExpanded(node)) node.children.forEach(child => visit(child, depth + 1));
    }
    visit(tree, 0);
    return output;
  });


  function isExpanded(node: Node): boolean {
    return filter === 'all' ? expanded.includes(node.id) : !collapsed.includes(node.id);
  }
  function toggle(node: Node) {
    if (filter !== 'all') {
      collapsed = collapsed.includes(node.id) ? collapsed.filter(id => id !== node.id) : [...collapsed, node.id];
      return;
    }
    const index = expanded.indexOf(node.id);
    if (index >= 0) expanded = expanded.slice(0, index);
    else expanded = [...expanded, node.id];
  }

  async function updateStatus(node: Node, status: string, event: MouseEvent) {
    event.stopPropagation();
    if (!node.sourceId || !onstatus) return;
    editingStatus = null;
    await onstatus(node.sourceId, status);
  }
</script>

<section class="learning-tree" dir="rtl" aria-label={`תכנית הלמידה של ${student.name}`}>
  <div class="tree-intro">
    <div>
      <span class="tree-kicker">מפת הלמידה</span>
      <h3>מתקדמים בצעד שאפשר לראות</h3>
      <p>פתחו נושא כדי לראות את היעדים והתרגול שלו.</p>
    </div>

  </div>

  <div class="tree-path" aria-live="polite">
    <span>תכנית אישית</span>
    {#each visibleNodes.filter(n => expanded.includes(n.id)).slice(-3) as n}
      <span class="path-separator">›</span><strong>{n.title}</strong>
    {/each}
  </div>

  <div class="tree-canvas">
    <div class="tree-branches">
      {#if filter !== 'all' && tree.children.length === 0}<p role="status">אין מיומנויות שמתאימות למסנן. אפשר לבחור ״הכל״ להצגת התכנית.</p>{/if}
      {#each visibleNodes as node (node.id)}
        <div class="tree-row" style={`--depth:${node.depth}`}>
          {#if node.depth > 0}<span class="connector" aria-hidden="true"></span>{/if}
          <button class={`tree-node ${node.kind}`} class:selected={isExpanded(node)} onclick={() => toggle(node)} aria-expanded={node.hasChildren ? isExpanded(node) : undefined}>
            <span class="node-icon" aria-hidden="true">{node.kind === 'subject' ? '◈' : node.kind === 'topic' ? '◇' : node.kind === 'subtopic' ? '✦' : '●'}</span>
            <span class="node-copy"><strong>{node.title}</strong><small>{node.subtitle}</small></span>
            <span class={`status ${statusClass[node.status]}`}>{node.status}</span>
            <span class="node-progress" aria-label={`${node.progress.percent}% התקדמות, ${node.progress.completed} מתוך ${node.progress.total} יעדים`}>
              <span class="progress-track"><span style={`width:${node.progress.percent}%`}></span></span><small>{node.progress.percent}%</small>
            </span>
            {#if node.hasChildren}<span class="node-chevron" aria-hidden="true">{isExpanded(node) ? '⌃' : '⌄'}</span>{/if}
          </button>
          {#if node.kind === 'goal' && onstatus}
            <div class="status-editor-wrap">
              <button class="status-edit" aria-label={`עדכון סטטוס עבור ${node.title}`} aria-expanded={editingStatus === node.id} onclick={(e) => { e.stopPropagation(); editingStatus = editingStatus === node.id ? null : node.id; }}>עדכון</button>
              {#if editingStatus === node.id}
                <div class="status-editor" role="group" aria-label={`סטטוס עבור ${node.title}`}>
                  {#each statusOptions as [value, label]}
                    <button class:active={node.sourceStatus === value} onclick={(e) => updateStatus(node, value, e)}>{label}</button>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>

  </div>
</section>

<style>
  .learning-tree{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--r-lg);color:var(--text-primary);min-width:0}
  .tree-intro{padding:24px;border-bottom:1px solid var(--border)}
  .tree-kicker{color:var(--text-muted);font-size:.8125rem;font-weight:500}
  .tree-intro h3{font-size:1.25rem;font-weight:600;margin:6px 0 8px}
  .tree-intro p{color:var(--text-muted);font-size:.875rem;line-height:1.6;margin:0}
  .tree-path{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 24px;font-size:.8125rem;color:var(--text-muted);border-bottom:1px solid var(--border)}
  .tree-path strong{font-weight:500;color:var(--text-primary)}
  .path-separator{color:var(--text-muted)}
  .tree-canvas{display:grid;grid-template-columns:minmax(0,1fr);min-height:160px;position:relative}
  .tree-branches{padding:20px;min-width:0}
  .tree-row{display:flex;align-items:center;gap:8px;position:relative;margin-top:8px;padding-inline-start:calc(var(--depth) * 16px)}
  .tree-row:first-child{margin-top:0}
  .connector{position:absolute;inset-inline-start:calc(var(--depth) * 16px - 8px);top:-8px;bottom:-8px;width:1px;background:var(--border)}
  .connector::after{content:'';position:absolute;inset-inline-start:0;top:50%;width:8px;height:1px;background:var(--border)}
  .tree-node{flex:1;min-width:0;display:flex;align-items:center;gap:10px;text-align:start;border:1px solid var(--border);border-radius:12px;padding:12px;min-height:60px;background:var(--bg-card);color:var(--text-primary);cursor:pointer;transition:background var(--motion-fast),border-color var(--motion-fast)}
  .tree-node:hover{background:var(--bg-card-solid);border-color:var(--border-strong)}
  .tree-node.subject{background:var(--control-bg);border-color:transparent}
  .tree-node.topic{background:var(--bg-card-solid)}
  .tree-node.subtopic,.tree-node.goal{background:var(--bg-card)}
  .tree-node.selected{border-color:var(--accent);background:var(--accent-dim)}
  .node-icon{font-size:1rem;width:20px;text-align:center;flex:none;color:var(--text-muted)}
  .node-copy{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}
  .node-copy strong{font-size:.9375rem;font-weight:600;white-space: normal;overflow-wrap:anywhere}
  .node-copy small{font-size:.8125rem;color:var(--text-muted);white-space: normal;overflow-wrap:anywhere}
  .status{font-size:.75rem;font-weight:500;border-radius:6px;padding:4px 8px;white-space: normal;background:var(--control-bg);color:var(--text-muted-strong)}
  .status-progress{color:var(--accent-deep);background:var(--accent-dim)}
  .status-needs-help{color:var(--warning-text);background:var(--warning-bg)}
  .status-done{color:var(--accent3-strong);background:var(--accent3-dim)}
  .node-chevron{font-size:1rem;width:16px;flex:none}
  .node-progress{display:flex;align-items:center;gap:6px;min-width:64px;font-size:.75rem;color:var(--text-muted-strong);font-variant-numeric:tabular-nums}
  .progress-track{display:block;width:34px;height:4px;background:var(--border);border-radius:4px;overflow:hidden}
  .progress-track span{display:block;height:100%;border-radius:inherit;background:var(--action-fill)}
  .status-editor-wrap{position:relative;flex:none}.status-edit{min-height:44px;border:1px solid var(--border);border-radius:10px;background:var(--bg-card);color:var(--accent-deep);font:inherit;font-size:.8125rem;padding:8px 12px;cursor:pointer}
  .status-editor{position:absolute;z-index:5;inset-inline-start:0;top:48px;display:flex;flex-direction:column;gap:4px;min-width:160px;padding:8px;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;box-shadow:0 8px 24px var(--shadow-md)}
  .status-editor button{min-height:44px;border:0;background:transparent;border-radius:8px;padding:10px;text-align:start;font:inherit;font-size:.875rem;cursor:pointer;color:var(--text-primary)}
  .status-editor button:hover,.status-editor button.active{background:var(--accent-dim);color:var(--accent-deep)}
  .tree-node:focus-visible,.status-edit:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
  @media(max-width:700px){
    .tree-intro{padding:20px}.tree-path{padding:12px 20px}.tree-branches{padding:12px}
    .tree-row{display:grid;grid-template-columns:minmax(0,1fr) auto;padding-inline-start:min(calc(var(--depth) * 8px),24px);gap:8px}
    .connector{inset-inline-start:calc(var(--depth) * 8px - 4px)}.tree-node{grid-column:1 / -1;flex-wrap:wrap}.node-copy{flex-basis:calc(100% - 40px)}
    .status-editor-wrap{justify-self:start}.status-editor{position:relative;top:auto;margin-top:4px}
  }
</style>
