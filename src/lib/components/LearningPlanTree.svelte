<script lang="ts">
  import { tick } from 'svelte';
  import { matchesPlanFilter, type FilterKind } from '$lib/plan-status.ts';

  type Kind = 'subject' | 'topic' | 'subtopic' | 'goal';
  type Activity = { id: string; title: string; url: string | null; source: string; type: 'משחק' | 'תרגול'; dataId: string | null; completed: boolean; score: number | null; total: number | null; lastPlayedAt: string | null };
  type Lesson = {
    slug: string; title: string | null; topic: string | null; context: string | null;
    homework: unknown[]; games: { title: string; url: string | null; dataId?: string | null; completed?: boolean; score?: number | null; total?: number | null; lastPlayedAt?: string | null; broken: boolean }[];
  };
  type Progress = { total: number; completed: number; mastered: number; percent: number };
  type CurriculumSkill = { id: number; title: string; status: string; visibility: string; changed?: boolean; recommended?: boolean; blocked?: boolean };
  type CurriculumBranch = { id: number; title: string; visibility: string; progress: Progress; skills: CurriculumSkill[] };
  type CurriculumTopic = { id: number; title: string; visibility: string; progress: Progress; branches: CurriculumBranch[] };
  type Student = { id: string; name: string; subject: string; goals: string; level: string; progress: number };
  type Node = {
    id: string; sourceId?: number; sourceStatus?: string; kind: Kind; title: string; subtitle: string; status: string; progress: Progress;
    children: Node[]; activities: Activity[];
  };
  type FlatNode = Node & { depth: number; hasChildren: boolean };

  /* library: plan node id → its skill's ready library lesson. Only the
     tutor's plan page passes it; the family's view has none. */
  let { student, lessons = [], topics = [], filter = 'all', returnTo = '/app/dashboard', onstatus, library = {} }: { student: Student; lessons?: Lesson[]; topics?: CurriculumTopic[]; filter?: FilterKind; returnTo?: string; onstatus?: (nodeId: number, status: string) => void | Promise<void>; library?: Record<number, string> } = $props();
  let expanded = $state<string[]>([]);
  let collapsed = $state<string[]>([]);
  let filterContext = '';
  $effect(() => {
    const context = student.id + ':' + filter;
    if (context !== filterContext) {
      collapsed = [];
      selected = null;
      editingStatus = null;
      filterContext = context;
    }
  });
  let selected = $state<Node | null>(null);

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

  function activityFor(lesson: Lesson, game: Lesson['games'][number], index: number): Activity {
    return { id: `${lesson.slug}:${game.dataId || game.title}:${index}`, title: game.title, url: game.url, source: lesson.title || lesson.topic || lesson.slug, type: 'משחק', dataId: game.dataId ?? null, completed: !!game.completed, score: game.score ?? null, total: game.total ?? null, lastPlayedAt: game.lastPlayedAt ?? null };
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

  function activitiesFor(title: string): Activity[] {
    return lessons
      .filter(lesson => lesson.topic === title || lesson.title === title)
      .flatMap(lesson => lesson.games.map((game, index) => activityFor(lesson, game, index)));
  }

  function buildCurriculumTopics(): Node[] {
    return topics.filter(topic => topic.visibility !== 'hidden').map(topic => {
      const topicActivities = activitiesFor(topic.title);
      const branches = topic.branches.filter(branch => branch.visibility !== 'hidden').map(branch => {
        const branchActivities = activitiesFor(branch.title);
        const skills = branch.skills
          .filter(skill => matchesPlanFilter(skill, filter))
          .map(skill => ({
            id: `goal:${skill.id}`, sourceId: skill.id, sourceStatus: skill.status, kind: 'goal' as const, title: skill.title,
            subtitle: 'יכולת מתוך תכנית הלימודים', status: statusFor(skill.status),
            progress: skillProgress(skill.status),
            activities: [...branchActivities, ...topicActivities], children: [],
          }));
        return {
          id: `subtopic:${branch.id}`, kind: 'subtopic' as const, title: branch.title,
          subtitle: `${branch.progress.completed} מתוך ${branch.progress.total} יעדים הושלמו`, status: skills.some(skill => skill.status === 'נדרש חיזוק') ? 'נדרש חיזוק' : branch.progress.completed ? 'בתהליך' : 'טרם התחלנו', progress: branch.progress,
          activities: [...branchActivities, ...topicActivities], children: skills,
        };
      }).filter(branch => filter === 'all' || branch.children.length > 0);
      return {
        id: `topic:${topic.id}`, kind: 'topic' as const, title: topic.title,
        subtitle: `${topic.progress.completed} מתוך ${topic.progress.total} יעדים הושלמו · ${topicActivities.length} פעילויות`,
        status: topic.progress.completed ? 'בתהליך' : 'טרם התחלנו', progress: topic.progress,
        activities: topicActivities, children: branches,
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
        activities: curriculumTopics.flatMap(t => collectActivities(t)), children: curriculumTopics,
      };
    }
    const relevant = lessons;
    const lessonTopics = relevant.length
      ? relevant.map((lesson, i) => {
          const topicTitle = lesson.topic || lesson.title || `נושא ${i + 1}`;
          const activities = lesson.games.map((game, j) => activityFor(lesson, game, j));
          const subtopic: Node = {
            id: `subtopic:${lesson.slug}`, kind: 'subtopic', title: 'תרגול והעמקה',
            subtitle: lesson.context || 'התרגול שנוצר עבור השיעור הזה', status: 'בתהליך', progress: { total: 1, completed: 0, mastered: 0, percent: 0 },
            activities, children: [{
              id: `goal:${lesson.slug}`, kind: 'goal', title: `יעד: ${topicTitle}`,
              subtitle: lesson.context || 'ממשיכים לפי מה שנלמד בפועל', status: 'בתהליך', progress: { total: 1, completed: 0, mastered: 0, percent: 0 },
              activities, children: [],
            }],
          };
          return {
            id: `topic:${lesson.slug}`, kind: 'topic', title: topicTitle,
            subtitle: `${activities.length} פעילויות מחוברות`, status: lesson.games.length ? 'בתהליך' : 'נדרש חיזוק', progress: { total: 1, completed: 0, mastered: 0, percent: 0 },
            activities, children: [subtopic],
          } satisfies Node;
        })
      : [{
          id: 'topic:start', kind: 'topic', title: 'מיפוי והתחלה',
          subtitle: student.goals || 'נוסיף כאן את הנושא הראשון לאחר השיעור', status: 'טרם התחלנו', progress: { total: 1, completed: 0, mastered: 0, percent: 0 },
          activities: [], children: [{
            id: 'subtopic:start', kind: 'subtopic', title: 'אבחון קצר', subtitle: 'ניסיון ראשון לפני בחירת תרגול',
            status: 'טרם התחלנו', progress: { total: 1, completed: 0, mastered: 0, percent: 0 }, activities: [], children: [{
              id: 'goal:start', kind: 'goal', title: 'להגדיר יעד ראשון', subtitle: 'היעד יתעדכן לאחר דיווח השיעור',
              status: 'טרם התחלנו', progress: { total: 1, completed: 0, mastered: 0, percent: 0 }, activities: [], children: [],
            }],
          }],
        } satisfies Node];

    return {
      id: `subject:${student.id}`, kind: 'subject', title: student.subject || 'תכנית אישית',
      subtitle: `${student.level || 'רמה לא הוגדרה'} · ${topics.length} נושאים`,
      status: student.progress >= 100 ? 'הושלם' : student.progress > 0 ? 'בתהליך' : 'טרם התחלנו', progress: { total: lessonTopics.length, completed: 0, mastered: 0, percent: 0 },
        activities: lessonTopics.flatMap(t => collectActivities(t)), children: lessonTopics,
    };
  }

  function collectActivities(node: Node): Activity[] {
    return [...node.activities, ...node.children.flatMap(collectActivities)];
  }

  const tree = $derived(buildTree());
  const selectedLesson = $derived(selected ? lessonFor(selected) : null);
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

  let activityDrawer = $state<HTMLElement>();
  let activityOrigin: HTMLButtonElement | undefined;
  async function openActivities(node: Node, origin: HTMLButtonElement) {
    selected = node;
    activityOrigin = origin;
    await tick();
    if (window.innerWidth <= 700) activityDrawer?.scrollIntoView({ block: 'start', behavior: 'auto' });
    activityDrawer?.focus({ preventScroll: true });
  }
  function closeActivities() { selected = null; activityOrigin?.focus(); }

  function assignedFor(node: Node): Activity[] {
    return collectActivities(node)
      .filter((a, i, arr) => arr.findIndex(x => x.id === a.id) === i);
  }

  function lessonFor(node: Node): Lesson | null {
    return lessons.find(lesson => lesson.topic === node.title || lesson.title === node.title)
      ?? lessons.find(lesson => assignedFor(node).some(activity => activity.id.startsWith(`${lesson.slug}:`)))
      ?? null;
  }

  function activityCount(node: Node): number { return assignedFor(node).length; }
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

  <div class="tree-canvas" class:has-drawer={selected !== null}>
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
          <button class="activity-trigger" onclick={(event) => openActivities(node, event.currentTarget)} aria-label={`משחקים ותרגולים עבור ${node.title}`}>
            <span>☷</span><b>{activityCount(node)}</b><small>פעילויות</small>
          </button>
        </div>
      {/each}
    </div>

    {#if selected}
      <aside class="activity-drawer" bind:this={activityDrawer} tabindex="-1" aria-label={`פעילויות עבור ${selected.title}`}>
        <button class="drawer-close" onclick={closeActivities} aria-label="סגירת חלונית">×</button>
        <span class="drawer-kicker">פעילויות מחוברות</span>
        <h4>{selected.title}</h4>
        <p class="drawer-path">{student.subject} › {selected.title}</p>
        {#if selected.sourceId != null && library[selected.sourceId]}
          {@const libSlug = library[selected.sourceId]}
          <div class="library-card">
            <span class="activity-icon">📚</span>
            <span><strong>שיעור מוכן מהספרייה</strong><small>שיעור על המיומנות הזו נבנה ממנו</small></span>
            <span class="library-links"><a href="/lessons/{libSlug}" target="_blank" rel="noopener">צפייה ↗</a><a href="/app/lessons/{libSlug}/edit?returnTo={encodeURIComponent(returnTo)}">עריכה</a></span>
          </div>
        {/if}
        {#if assignedFor(selected).length}
          <div class="activity-list">
            {#each assignedFor(selected) as activity (activity.id)}
              {#if activity.url}
                <a class="activity-card" href={activity.url} target="_blank" rel="noopener">
                  <span class="activity-icon">🎮</span><span><strong>{activity.title}</strong><small>{activity.type} · {activity.source} · {activity.completed ? `בוצע${activity.score != null && activity.total != null ? ` (${activity.score}/${activity.total})` : ''}` : 'טרם בוצע'}</small></span><span class="open-arrow">↗</span>
                </a>
              {:else}
                <div class="activity-card unavailable"><span class="activity-icon">📝</span><span><strong>{activity.title}</strong><small>{activity.type} · ממתין לקישור</small></span></div>
              {/if}
            {/each}
          </div>
        {:else}
          <div class="drawer-empty"><span>◌</span><strong>עדיין אין פעילות בענף הזה</strong><p>אפשר לבחור פעילות קיימת או לפתוח את מאגר המשחקים כדי לבחור תבנית.</p></div>
        {/if}
        {#if selectedLesson}
          <a class="catalog-link" href="/app/games?lesson={encodeURIComponent(selectedLesson.slug)}&student={encodeURIComponent(student.id)}{selected.sourceId ? `&node=${selected.sourceId}` : ''}&returnTo={encodeURIComponent(returnTo)}">הוספת משחק לשיעור</a>
        {:else}
          <a class="catalog-link" href="/app/games?returnTo={encodeURIComponent(returnTo)}">פתיחת מאגר המשחקים</a>
        {/if}
      </aside>
    {/if}
  </div>
</section>

<style>
  .learning-tree{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--r-lg);color:var(--text-primary);min-width:0}
  .tree-intro{padding:24px;border-bottom:1px solid var(--border)}
  .tree-kicker,.drawer-kicker{color:var(--text-muted);font-size:.8125rem;font-weight:500}
  .tree-intro h3{font-size:1.25rem;font-weight:600;margin:6px 0 8px}
  .tree-intro p{color:var(--text-muted);font-size:.875rem;line-height:1.6;margin:0}
  .tree-path{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 24px;font-size:.8125rem;color:var(--text-muted);border-bottom:1px solid var(--border)}
  .tree-path strong{font-weight:500;color:var(--text-primary)}
  .path-separator{color:var(--text-muted)}
  .tree-canvas{display:grid;grid-template-columns:minmax(0,1fr);min-height:160px;position:relative}
  .tree-canvas.has-drawer{grid-template-columns:minmax(0,1fr) minmax(260px,34%)}
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
  .activity-trigger{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--border);background:var(--bg-card);color:var(--accent-deep);border-radius:10px;padding:8px 10px;min-height:44px;min-width:64px;cursor:pointer;font:inherit}
  .activity-trigger span{font-size:1rem}.activity-trigger b{font-size:.875rem;font-weight:500}.activity-trigger small{font-size:.75rem;color:var(--text-muted)}
  .activity-trigger:hover{background:var(--accent-dim)}
  .activity-drawer{border-inline-start:1px solid var(--border);background:var(--bg-card);padding:24px;position:sticky;top:calc(var(--workspace-header-height,65px) + 16px);align-self:start;min-width:0;scroll-margin-top:calc(var(--workspace-header-height,65px) + 16px)}
  .activity-drawer:focus{outline:none}
  .drawer-close{position:absolute;inset-inline-end:8px;top:8px;border:0;background:transparent;color:var(--text-muted);font:inherit;font-size:1.5rem;min-width:44px;min-height:44px;cursor:pointer}
  .activity-drawer h4{font-size:1.125rem;font-weight:600;margin:8px 0;padding-inline-end:24px}
  .drawer-path{color:var(--text-muted);font-size:.8125rem;margin:0 0 20px;overflow-wrap:anywhere}
  .activity-list{display:flex;flex-direction:column;gap:8px}
  .activity-card{display:flex;align-items:center;gap:10px;padding:12px;border:1px solid var(--border);border-radius:12px;text-decoration:none;color:var(--text-primary);background:var(--bg-card);min-height:56px}
  .activity-card:hover{background:var(--bg-card-solid)}
  .activity-card span:nth-child(2){display:flex;flex-direction:column;gap:6px;min-width:0;flex:1}
  .activity-card strong{font-size:.875rem;font-weight:600;overflow-wrap:anywhere}.activity-card small{font-size:.8125rem;color:var(--text-muted);overflow-wrap:anywhere}
  .activity-icon{font-size:1.125rem}.open-arrow{color:var(--accent-deep);font-size:1rem}.unavailable{color:var(--text-muted)}
  .drawer-empty{padding:24px 4px;color:var(--text-muted)}.drawer-empty>span{font-size:1.5rem}.drawer-empty strong{display:block;font-size:.9375rem;font-weight:600;color:var(--text-primary);margin-top:8px}.drawer-empty p{font-size:.875rem;line-height:1.6}
  .catalog-link{display:inline-flex;align-items:center;min-height:44px;margin-top:16px;color:var(--accent-deep);font-size:.875rem;font-weight:500;text-decoration:none}
  .library-card{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px;border:1px solid var(--border);border-radius:12px;background:var(--bg-card-solid);margin-bottom:12px}
  .library-card>span:nth-child(2){display:flex;flex-direction:column;gap:6px;min-width:0;flex:1}.library-card strong{font-size:.875rem;font-weight:600}.library-card small{font-size:.8125rem;color:var(--text-muted)}
  .library-links{display:flex;gap:12px}.library-links a{display:inline-flex;align-items:center;min-height:44px;color:var(--accent-deep);font-size:.875rem}
  .status-editor-wrap{position:relative;flex:none}.status-edit{min-height:44px;border:1px solid var(--border);border-radius:10px;background:var(--bg-card);color:var(--accent-deep);font:inherit;font-size:.8125rem;padding:8px 12px;cursor:pointer}
  .status-editor{position:absolute;z-index:5;inset-inline-start:0;top:48px;display:flex;flex-direction:column;gap:4px;min-width:160px;padding:8px;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;box-shadow:0 8px 24px var(--shadow-md)}
  .status-editor button{min-height:44px;border:0;background:transparent;border-radius:8px;padding:10px;text-align:start;font:inherit;font-size:.875rem;cursor:pointer;color:var(--text-primary)}
  .status-editor button:hover,.status-editor button.active{background:var(--accent-dim);color:var(--accent-deep)}
  .tree-node:focus-visible,.status-edit:focus-visible,.activity-trigger:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
  @media(max-width:700px){
    .tree-intro{padding:20px}.tree-path{padding:12px 20px}.tree-branches{padding:12px}.tree-canvas.has-drawer{grid-template-columns:minmax(0,1fr)}
    .activity-drawer{position:relative;top:auto;border-inline-start:0;border-top:1px solid var(--border);padding:20px}
    .tree-row{display:grid;grid-template-columns:minmax(0,1fr) auto;padding-inline-start:min(calc(var(--depth) * 8px),24px);gap:8px}
    .connector{inset-inline-start:calc(var(--depth) * 8px - 4px)}.tree-node{grid-column:1 / -1;flex-wrap:wrap}.node-copy{flex-basis:calc(100% - 40px)}
    .status-editor-wrap{justify-self:start}.activity-trigger{justify-self:end}.activity-trigger small{display:none}.status-editor{position:relative;top:auto;margin-top:4px}
  }
</style>
