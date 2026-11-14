<script lang="ts">
 import TutorPageHeader from './TutorPageHeader.svelte';
 import CentralDriveCard from './CentralDriveCard.svelte';
 import Icon from '$lib/icons/Icon.svelte';
 import type {NativeWorkspace} from '$server/learning-archive.ts';
 import type {centralSyncController} from '$server/central-drive/sync.ts';
 let {workspace,centralDrive}:{workspace:NativeWorkspace;centralDrive:ReturnType<ReturnType<typeof centralSyncController>['view']>}=$props();
 const folder=(id:string)=>`https://drive.google.com/drive/folders/${id}`;
 const cards=$derived([
  {title:'מצגות',format:'Google Slides',description:'המצגות החדשות, לעריכה ולהצגה ישירות ב־Google.',id:workspace.presentationsId,icon:'slides' as const},
  {title:'תרגול לבית',format:'Google Docs',description:'דפי התרגול וההסברים שממשיכים את השיעור.',id:workspace.homeworkId,icon:'homework' as const},
  {title:'משחקים ופעילויות',format:'Interactive',description:'חומרי המשחקים וההמחשות. הפעילויות עצמן נשארות באתר.',id:workspace.gamesId,icon:'games' as const},
  {title:'הערות למורה',format:'Google Docs',description:'הנחיות ההצגה והפתרונות, בנפרד מהחומר לתלמידים.',id:workspace.notesId,icon:'homework' as const},
 ]);
 const date=$derived(new Date(workspace.archivedAt).toLocaleDateString('he-IL',{timeZone:'Asia/Jerusalem'}));
</script>

<main class="workspace-page" id="workspace-content" tabindex="-1" data-native-workspace>
 <TutorPageHeader title="מרחב ההוראה" description="מצגות, תרגול ותיקי תלמידים — במקום אחד ב־Google Drive.">
  {#snippet actions()}<a class="workspace-button workspace-button-quiet" href="/app/library/connection">ניהול החיבור</a><a class="workspace-button workspace-button-primary" href={folder(workspace.workspaceId)} target="_blank" rel="noopener noreferrer">פתיחת המרחב ב־Drive <span aria-hidden="true">↗</span></a>{/snippet}
 </TutorPageHeader>
 <section class="fresh-start" aria-labelledby="fresh-title">
  <div><span class="eyebrow">מתחילים ספרייה חדשה</span><h2 id="fresh-title">מקום לחומרים שנרצה ללמד איתם</h2><p>החומרים הקודמים שמורים בארכיון. חומרים חדשים ייכנסו לספרייה אחרי בדיקה של ההסבר, המתמטיקה והחוויה לתלמיד/ה.</p></div>
  <a href={folder(workspace.reviewId)} class="workspace-button" target="_blank" rel="noopener noreferrer">חומרים לבדיקה <span aria-hidden="true">↗</span></a>
 </section>
 <section class="material-grid" aria-label="חומרי ההוראה">
  {#each cards as card (card.id)}
   <a class="material-card" href={folder(card.id)} target="_blank" rel="noopener noreferrer"><div class="card-top"><span class="card-icon" aria-hidden="true"><Icon name={card.icon} size={22}/></span><span class="format"><bdi>{card.format}</bdi></span></div><h2>{card.title}</h2><p>{card.description}</p><span class="open-label">פתיחת התיקייה <span aria-hidden="true">↗</span></span></a>
  {/each}
 </section>
 <section class="records" aria-labelledby="records-title"><h2 id="records-title">תלמידים ותכנון</h2><p>תיקי התלמידים ב־Docs נשארים לעריכה. הנתונים מהאתר מתעדכנים בגיליון הרישום.</p><div class="link-row"><a class="workspace-button" href={`https://docs.google.com/spreadsheets/d/${workspace.indexId}/edit`} target="_blank" rel="noopener noreferrer">רישום והתקדמות</a><a class="workspace-button" href={folder(workspace.studentsId)} target="_blank" rel="noopener noreferrer">תיקי התלמידים</a><a class="workspace-button workspace-button-quiet" href={folder(workspace.templatesId)} target="_blank" rel="noopener noreferrer">תבניות</a><a class="workspace-button workspace-button-quiet" href={`https://docs.google.com/document/d/${workspace.guideId}/edit`} target="_blank" rel="noopener noreferrer">מדריך למרחב</a></div></section>
 <details class="archive"><summary>ארכיון החומרים הקודמים <span>· {workspace.lessonCount} שיעורים</span></summary><p>נשמר ב־{date}: {workspace.artifactCount} מקורות, כולל גרסאות והערות למורה. זהו ארכיון היסטורי; החומרים אינם מוצעים לשימוש חדש.</p><p>היסטוריית השיעורים, ההגשות וההתקדמות נשמרה. היצירה האוטומטית הישנה הושבתה; בינתיים מכינים חומרים במרחב ההוראה.</p><a class="workspace-button" href={`https://docs.google.com/spreadsheets/d/${workspace.archiveIndexId}/edit`} target="_blank" rel="noopener noreferrer">פתיחת רישום הארכיון</a></details>
 <CentralDriveCard initial={centralDrive}/>
</main>

<style>
 .fresh-start{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:28px;border-radius:18px;background:var(--control-bg);border:1px solid var(--border)}
 .fresh-start h2{font-size:1.3rem;margin-block:8px}.eyebrow{font-size:.8rem;font-weight:700;color:var(--accent)}
 p{line-height:1.8;color:var(--text-muted-strong);margin-block:8px 0;max-width:65ch}h2{line-height:1.5;color:var(--text-primary)}
 .material-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin-block:24px}
 .material-card{display:flex;flex-direction:column;min-width:0;padding:24px;background:var(--bg-card);border:1px solid var(--border);border-radius:18px;color:var(--text-primary);text-decoration:none;transition:border-color .15s}
 .material-card:hover{border-color:var(--accent)}.material-card:focus-visible{outline:3px solid var(--accent);outline-offset:3px}.card-top{display:flex;align-items:center;justify-content:space-between;gap:12px}
 .card-icon{color:var(--accent);display:grid;place-items:center;width:44px;height:44px;border-radius:12px;background:var(--control-bg)}.format{font-size:.78rem;color:var(--text-muted-strong)}
 .material-card h2{font-size:1.1rem;margin-block:18px 0}.material-card p{font-size:.9rem;flex:1}.open-label{display:flex;align-items:center;gap:8px;color:var(--accent);font-weight:600;font-size:.875rem;margin-block-start:24px}
 .records{padding:24px;background:var(--bg-card);border:1px solid var(--border);border-radius:18px}.records h2{margin:0;font-size:1.1rem}.link-row{display:flex;flex-wrap:wrap;gap:10px;margin-block-start:20px}
 .archive{margin-block-start:24px;padding:20px 24px;border:1px solid var(--border);border-radius:16px}.archive summary{cursor:pointer;min-height:44px;align-content:center;font-weight:600}.archive summary span{font-size:.85rem;color:var(--text-muted-strong);font-weight:400}.archive p{font-size:.9rem}.archive .workspace-button{margin-block-start:16px}
 @media(max-width:600px){.fresh-start{padding:22px;align-items:stretch;flex-direction:column;gap:18px}.material-grid{grid-template-columns:minmax(0,1fr);gap:14px}.material-card,.records{padding:22px}.link-row .workspace-button{flex:1 1 100%}.archive{padding:18px 22px}}
 @media(prefers-reduced-motion:reduce){.material-card{transition:none}}
</style>
