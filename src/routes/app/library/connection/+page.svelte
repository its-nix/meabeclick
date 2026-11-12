<script lang="ts">
 import TutorPageHeader from '$lib/components/TutorPageHeader.svelte';
 import type {PageData,ActionData} from './$types';
 let {data,form}:{data:PageData;form:ActionData}=$props();
 const checkedAt=$derived(data.status?.checkedAt?new Date(data.status.checkedAt).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem',dateStyle:'medium',timeStyle:'short'}):null);
</script>

<svelte:head><title>חיבור Google ללמידה — מאה בקליק</title><meta name="robots" content="noindex,nofollow" /></svelte:head>
<main class="workspace-page connection-page" id="workspace-content" tabindex="-1">
 <TutorPageHeader title="מרחב הלמידה ב־Google" description="הפרופילים, התכנון והחומרים במקום אחד בחשבון האישי.">
  {#snippet actions()}<a class="workspace-button workspace-button-quiet" href="/app/library">חזרה לספרייה</a>{/snippet}
 </TutorPageHeader>
 {#if form?.message||data.message}<p class="notice" role="alert">{form?.message??data.message}</p>{/if}
 <section class="connection-card" aria-labelledby="connection-title">
  {#if !data.configured}
   <span class="eyebrow">הכנת החיבור</span><h2 id="connection-title">החיבור עדיין לא הוגדר</h2>
   <p>מרחב הלמידה כבר נוצר ב־Drive. חיבור האתר זמין אחרי השלמת ההגדרות בשרת.</p>
  {:else}
   <span class="eyebrow">החשבון האישי</span><p class="account"><bdi dir="ltr">{data.account}</bdi></p>
   <h2 id="connection-title">{data.status?.state==='verified'?'מרחב הלמידה עבר בדיקה':data.status?.state==='failed'?'החיבור צריך בדיקה מחדש':'מחברים את מרחב הלמידה'}</h2>
   {#if checkedAt}
    <p>הבדיקה האחרונה: <bdi>{checkedAt}</bdi>. {data.status?.state==='verified'?'הבעלות, הגישה ומבנה הרישום אומתו.':'הבדיקה האחרונה לא הושלמה. בדקו שוב או התחברו מחדש.'}</p>
   {:else}
    <p>בוחרים את החשבון האישי ומאשרים את תשעת הפריטים שמוצגים בחלון Google. האתר יבדוק שהכול שייך למרחב הנכון לפני שמירת החיבור.</p>
   {/if}
   <div class="connection-actions">
    <form method="POST" action="?/connect"><button class="workspace-button workspace-button-primary" type="submit">{data.status?.checkedAt?'חיבור מחדש עם Google':'חיבור עם Google'}</button></form>
    {#if data.status?.checkedAt}<form method="POST" action="?/verify"><button class="workspace-button" type="submit">בדיקת החיבור עכשיו</button></form>{/if}
   </div>
   <details><summary>מה מחברים?</summary><p>הגישה מוגבלת לפריטים שנבחרים. יש לבחור את כל תשעת הפריטים כדי שהבדיקה תצליח.</p>
    <ul>{#each data.files as file}<li><span dir="auto">{file.name}</span></li>{/each}</ul>
   </details>
  {/if}
 </section>
 <section class="connection-card quiet-card" aria-labelledby="next-title">
  <h2 id="next-title">מה אפשר לעשות אחרי החיבור?</h2>
  <p>לבדוק את הרישום ולקרוא ממנו מידע לתכנון הלמידה. יצירת חומרים אוטומטית ופרסום לתלמידים יופעלו בהמשך, אחרי בדיקת התהליך המלא.</p>
  <p class="scope-note">כרגע החיבור קורא מידע בלבד. הרשאת Google מאפשרת גם עריכת קבצים נבחרים לצורך שלבי ההמשך.</p>
 </section>
</main>

<style>
 .connection-page{--workspace-width:840px}
 .connection-card{background:var(--bg-card);border:1px solid var(--border);border-radius:18px;padding:28px;margin-block-end:20px}
 .connection-card h2{font-size:1.25rem;line-height:1.5;margin-block:0 10px;color:var(--text-primary)}
 .connection-card p{color:var(--text-muted-strong);line-height:1.8;max-width:65ch;margin-block:0 18px;overflow-wrap:anywhere}
 .eyebrow{display:block;color:var(--text-muted-strong);font-size:.8rem;margin-block-end:6px}
 .connection-card .account{color:var(--text-primary);font-weight:600;margin-block-end:18px}
 .connection-actions{display:flex;flex-wrap:wrap;gap:12px;margin-block:24px}
 details{border-block-start:1px solid var(--border);padding-block-start:18px}
 summary{cursor:pointer;min-height:44px;font-weight:600;color:var(--text-primary)}
 summary:focus-visible{outline:3px solid var(--accent);outline-offset:3px;border-radius:4px}
 ul{padding-inline-start:24px;color:var(--text-muted-strong);line-height:2}
 .notice{padding:16px 20px;border:1px solid var(--border-strong);border-radius:12px;background:var(--control-bg);color:var(--text-primary);line-height:1.8;margin-block-end:20px}
 .quiet-card{background:transparent}.connection-card .scope-note{font-size:.85rem;margin-block-end:0}
 @media(max-width:600px){.connection-card{padding:22px 20px;border-radius:14px}.connection-actions form,.connection-actions button{width:100%}}
</style>
