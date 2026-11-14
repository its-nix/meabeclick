<script lang="ts">
 import {onMount} from 'svelte';
 import Icon from '$lib/icons/Icon.svelte';
 import type {centralSyncController} from '$server/central-drive/sync.ts';
 type View=ReturnType<ReturnType<typeof centralSyncController>['view']>;
 let {initial,showManage=true}:{initial:View;showManage?:boolean}=$props();
 let latest=$state<View|null>(null),busy=$state(false),notice=$state('');
 const status=$derived(latest??initial);
 const label=$derived(!status.connected?'ממתין לחיבור':!status.enabled?'מושהה':status.phase==='running'?'מסנכרנים…':status.phase==='failed'?'נדרשת בדיקה':status.lastSuccess?'מעודכן':'מוכן לסנכרון');
 const last=$derived(status.lastSuccess?new Date(status.lastSuccess).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem',dateStyle:'medium',timeStyle:'short'}):null);
 async function action(action:string){
  busy=true;notice='';
  try{const response=await fetch('/api/central-drive',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})}),body=await response.json();if(!response.ok)throw Error(body.message??'הפעולה לא הושלמה. אפשר לנסות שוב.');latest=body;}
  catch(e){notice=e instanceof Error?e.message:'הפעולה לא הושלמה.';}finally{busy=false;}
 }
 onMount(()=>{
  let disposed=false,refreshing=false;
  async function refresh(){
   refreshing=true;
   try{const response=await fetch('/api/central-drive');if(!response.ok)throw Error();const body=await response.json();if(!disposed){latest=body;notice='';}}
   catch{if(!disposed)notice='מצב הסנכרון לא התעדכן. רעננו את העמוד כדי לבדוק שוב.';}
   refreshing=false;
  }
  const watcher=setInterval(()=>{if(status.phase==='running'&&!busy&&!refreshing)void refresh();},2500);
  return()=>{disposed=true;clearInterval(watcher);};
 });
</script>

<section class="central-drive" aria-labelledby="central-drive-title" data-central-drive>
 <div class="drive-heading"><div class="drive-icon" aria-hidden="true"><Icon name="subjects" size={22}/></div><div><h2 id="central-drive-title">האחסון המרכזי ב־Google Drive</h2><p>חיבור אחד לכל המורים והתלמידים. החומרים הקיימים והחדשים מסתנכרנים אוטומטית.</p></div><span class:needs-attention={status.phase==='failed'} class="drive-state" role="status">{label}</span></div>
 {#if status.account}<p class="drive-account"><bdi dir="ltr">{status.account}</bdi></p>{/if}
 {#if status.phase==='running'}
  <p class="drive-progress" role="status">{status.stage==='archiving'?'מאמתים את הארכיון ומכינים את מרחב ההוראה החדש…':status.stage==='reading'?'קוראים את חומרי הלמידה…':status.stage==='profiles'?'מעדכנים את תיקי התלמידים…':status.stage==='index'?'מעדכנים את גיליון הרישום…':status.total?`${status.done} מתוך ${status.total} קבצים נבדקו`:'מתחברים לתיקייה המרכזית…'}</p>
  {#if status.total}<progress value={status.done} max={status.total} aria-label="התקדמות סנכרון הקבצים"></progress>{/if}
 {:else if last}<p class="drive-last">סנכרון מלא אחרון: <bdi>{last}</bdi>{#if status.phase==='complete'} · {status.uploaded} קבצים חדשים, {status.reused} ללא שינוי.{/if}</p>
 {:else if status.connected}<p class="drive-last">הסנכרון הראשון יעתיק גם את החומרים שכבר קיימים באתר. אפשר להמשיך לעבוד בזמן הזה.</p>{/if}
 {#if notice||status.message}<p class="drive-notice" role="alert">{notice||status.message}</p>{/if}
 <div class="drive-actions">
  {#if !status.connected}<a class="workspace-button workspace-button-primary" href="/app/library/connection">חיבור האחסון עם Google</a>
  {:else}
   {#if status.indexUrl}<a class="workspace-button" href={status.indexUrl} target="_blank" rel="noopener noreferrer">פתיחת רישום הלמידה</a>{/if}
   {#if status.enabled}
    <button class="workspace-button" disabled={busy||status.phase==='running'} onclick={()=>action('sync')}>{status.phase==='failed'?'ניסיון נוסף':'סנכרון עכשיו'}</button>
    <button class="workspace-button workspace-button-quiet" disabled={busy} onclick={()=>action('pause')}>השהיית הסנכרון</button>
   {:else}<button class="workspace-button workspace-button-primary" disabled={busy} onclick={()=>action('resume')}>{status.lastSuccess?'המשך סנכרון אוטומטי':'הפעלת סנכרון אוטומטי'}</button>{/if}
   {#if showManage}<a class="workspace-button workspace-button-quiet" href="/app/library/connection">ניהול החיבור</a>{/if}
  {/if}
  {#if status.folderUrl}<a class="drive-folder" href={status.folderUrl} target="_blank" rel="noopener noreferrer">התיקייה המרכזית <span aria-hidden="true">↗</span></a>{/if}
 </div>
 <p class="drive-footnote">תיקי התלמידים נשארים לעריכה חופשית ב־Docs. לשוניות האתר מתעדכנות ב־Sheets. החיבור אינו מפרסם חומרים לתלמידים.</p>
</section>

<style>
 .central-drive{margin-block-start:28px;padding:24px;background:var(--bg-card);border:1px solid var(--border);border-radius:18px}
 .drive-heading{display:flex;gap:12px;align-items:flex-start}.drive-heading h2{font-size:1.1rem;line-height:1.5;margin:0 0 4px;color:var(--text-primary)}
 .drive-heading p,.drive-last,.drive-progress,.drive-account{font-size:.9rem;color:var(--text-muted-strong);line-height:1.75;margin:0}.drive-heading p{max-width:65ch}
 .drive-icon{display:grid;place-items:center;flex:0 0 42px;height:42px;border-radius:12px;background:var(--control-bg);color:var(--accent)}
 .drive-state{margin-inline-start:auto;white-space:nowrap;padding:5px 10px;border-radius:20px;font-size:.8rem;background:var(--control-bg);color:var(--text-muted-strong)}.needs-attention{font-weight:600}
 .drive-account,.drive-last,.drive-progress{margin-block-start:14px;overflow-wrap:anywhere}progress{width:100%;height:8px;margin-block:12px 0;accent-color:var(--accent)}
 .drive-actions{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-block-start:18px}.drive-folder{font-size:.875rem;min-height:44px;display:inline-flex;align-items:center;gap:6px;padding-inline:8px;color:var(--text-primary)}
 .drive-notice{background:var(--control-bg);border:1px solid var(--border);padding:12px 16px;border-radius:10px;line-height:1.7;color:var(--text-primary);font-size:.9rem;margin-block:16px 0}
 .drive-footnote{font-size:.8rem;line-height:1.8;color:var(--text-muted-strong);margin-block:16px 0}
 @media(max-width:600px){.central-drive{padding:20px}.drive-heading{flex-wrap:wrap}.drive-heading>div:nth-child(2){flex:1;min-width:180px}.drive-state{margin-inline-start:54px}.drive-actions .workspace-button{flex:1 1 100%}.drive-icon{flex-basis:36px;height:36px}}
</style>
