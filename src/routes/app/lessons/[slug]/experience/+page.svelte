<script lang="ts">
  import { untrack } from 'svelte';
  import FormulaText from '$lib/components/FormulaText.svelte';
  import { PHASE_LABELS } from '$lib/learning/model.ts';
  import { formulaForVisual } from '$lib/learning/visual.ts';
  const parameterLabels = {
    fraction:['מונה n','מכנה d','חלוקה k'],geometry:['סוג צורה','a או רדיוס','b או גובה משולש','גובה גוף'], 'data-bars':['שכיחות 1','שכיחות 2','שכיחות 3','שכיחות 4'], normal:['ממוצע','סטיית תקן sigma','גבול תחתון','גבול עליון'], 'normal-school':['ממוצע','סטיית תקן s','גבול תחתון','גבול עליון'],
    quadratic: ['a · מקדם הפתיחה', 'h · מיקום אופקי', 'k · גובה הקודקוד'],
    linear: ['m · שיפוע', 'b · חיתוך עם הציר'],
    'number-line': ['מיקום על הציר'], balance: ['מקדם x', 'המספר שמוסיפים', 'אגף ימין'], steps: [],
  };
  let { data } = $props();
  let lesson = $state(untrack(() => structuredClone(data.learning)));
  let version = $state(untrack(() => data.version));
  let busy = $state(false), message = $state(''), failed = $state(false);
  let saved = $state(untrack(() => JSON.stringify(data.learning)));
  const dirty = $derived(JSON.stringify(lesson)!==saved);
  async function save(action:'draft'|'publish') {
    busy=true;message='';failed=false;
    try {
      const response=await fetch(`/api/lessons/${encodeURIComponent(data.slug)}/experience`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,expectedVersion:version,expectedTarget:data.materialSlug,learning:lesson})});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error??'השמירה לא הצליחה');
      version=result.version;saved=JSON.stringify(lesson);
      message=action==='publish'?'הגרסה פורסמה במרחב הלמידה.':'הטיוטה נשמרה. התלמיד/ה עדיין רואה את הגרסה שפורסמה.';
    }catch(e){failed=true;message=e instanceof Error?e.message:'השמירה לא הצליחה';}
    finally{busy=false;}
  }
</script>

<svelte:head><title>עריכת מרחב הלמידה · מאה בקליק</title></svelte:head>
<svelte:window onbeforeunload={e=>{if(dirty){e.preventDefault();e.returnValue='';}}} />
<main class="experience-editor">
  <nav><a href="/app/lessons/{data.slug}/edit">→ חזרה לשיעור ולמשחקים</a></nav>
  <header><div><p class="eyebrow">חומרי הלימוד · גרסה {version}</p><h1>עריכת מרחב הלמידה</h1><p>תיקון ממוקד של ההסבר, ההמחשה או התרגול. כל שמירה יוצרת גרסה חדשה.</p></div><a href="/app/learn/{data.slug}{data.variant==='homework'?'/homework':''}?solutions=1" target="_blank" rel="noreferrer">פתיחת הגרסה שפורסמה והתשובון ↗</a></header>
  <div class="toolbar"><a href="/app/lessons/{data.slug}/presenter" target="_blank" rel="noopener">הערות למצגת שפורסמה ↗</a><button onclick={()=>save('draft')} disabled={busy}>שמירת טיוטה</button><button class="primary" onclick={()=>save('publish')} disabled={busy}>פרסום לתלמיד/ה</button><span>{busy?'שומרים…':dirty?'יש שינויים שלא נשמרו':'כל השינויים נשמרו'}</span></div>
  {#if data.pendingRegeneration}<p>נוצרה הצעה חדשה שטרם אושרה. העריכה כאן ממשיכה מהעבודה ששמרת; אפשר להשוות להצעה בעורך השיעור.</p>{/if}
  {#if data.materialSlug!==data.slug}<p>זה התרגול שנבחר לפי מה שנלמד בשיעור. העריכה תעדכן את אותו תרגול שהתלמיד/ה פותח/ת.</p>{/if}
  {#if data.studentLearning}
    <details class="student-learning"><summary>מה כדאי לתרגל יחד?</summary>
      <p>הניסיונות האחרונים במרחב שפורסם: {data.studentLearning.title}. רמז או ניסיון נוסף הם כיוון לשיחה, ולא ציון שליטה.</p>
      {#each data.studentLearning.questions as question (question.id)}
        <div class="student-question"><FormulaText text={question.question} /><small>{question.solved?'נפתר':question.attempts?'כדאי לבדוק יחד':'טרם נבדק'} · ניסיונות: {question.attempts} · רמזים: {question.hints}</small></div>
      {/each}
    </details>
  {/if}
  {#if message}<p role="status" class:failed>{message}</p>{/if}
  <div class="editor-columns"><div>
    <section class="intro"><label>שם השיעור<input bind:value={lesson.title} maxlength="120" /></label>{#if !data.variant}<label>כותרת משנה<input bind:value={lesson.subtitle} maxlength="220" /></label><label>מה התלמיד/ה יוכל/תוכל לעשות?<input bind:value={lesson.objective} maxlength="220" /></label>{/if}</section>
    {#each lesson.scenes as scene,index (scene.id)}
      <details open={index===0}><summary><span>{String(index+1).padStart(2,'0')}</span>{scene.title}<small>{PHASE_LABELS[scene.phase]}</small></summary>
        {#if !data.variant}<label>כותרת<input bind:value={scene.title} maxlength="100" /></label><label>הנחיה קצרה<textarea bind:value={scene.prompt} rows="2" maxlength="280"></textarea></label>{/if}<label>הרעיון שנשאר<textarea bind:value={scene.takeaway} rows="2" maxlength="280"></textarea></label>
        {#if !data.variant}<details class="presenter-note-editor"><summary>הערות למורה בלבד</summary>
          <p>ההערות מופיעות בדף המורה, בנפרד מהמצגת ומהתרגול לתלמידים.</p>
          {#if scene.presenterNotes}
            <label>מה לומר<textarea bind:value={scene.presenterNotes.explanation} rows="4" maxlength="700"></textarea></label>
            <label>מה לשאול<textarea bind:value={scene.presenterNotes.ask} rows="2" maxlength="350"></textarea></label>
            <label>תשובה והבנה רצויות<textarea bind:value={scene.presenterNotes.expectedAnswer} rows="3" maxlength="500"></textarea></label>
            <label>אם נתקעים<textarea bind:value={scene.presenterNotes.ifStuck} rows="3" maxlength="500"></textarea></label>
            {#if !data.learning.scenes[index].presenterNotes}<button type="button" onclick={()=>{delete scene.presenterNotes;}}>ביטול הוספת ההערות</button>{/if}
          {:else}
            <p>השיעור הזה נוצר לפני שהוספנו הערות למורה.</p>
            <button onclick={()=>{scene.presenterNotes={explanation:'',ask:'',expectedAnswer:'',ifStuck:''};}}>הוספת הערות לשלב הזה</button>
          {/if}
        </details>
        {/if}
        {#if !data.variant || !scene.check}<h3>{data.variant?'המשימה':'שלבי ההסבר'}</h3>
        {#each scene.frames as frame,frameIndex}
          <fieldset><legend>שלב {frameIndex+1}</legend><label>הסבר קצר<textarea bind:value={frame.caption} rows="2" maxlength="180"></textarea></label>
            {#if scene.visual==='steps'&&!data.variant}<label>נוסחה<input bind:value={frame.tex} dir="ltr" /></label>{/if}
            {#if !data.variant}<div class="math-preview"><FormulaText text={'\\('+(scene.visual==='steps'?frame.tex:formulaForVisual(scene.visual,frame.values))+'\\)'} /></div>{/if}
            <div class="values">{#each frame.values as _,valueIndex}<label>{parameterLabels[scene.visual][valueIndex]}<input type="number" step="any" bind:value={frame.values[valueIndex]} /></label>{/each}</div></fieldset>
        {/each}
        {/if}
        {#if scene.check}
          <h3>שאלת התרגול</h3><label>השאלה<textarea bind:value={scene.check.question} rows="2" maxlength="280"></textarea></label>
          {#if scene.check.kind==='choice'}
            <fieldset><legend>אפשרויות — סמנו את התשובה הנכונה</legend>{#each scene.check.options as _,i}<label class="option"><input type="radio" name={'answer-'+scene.id} value={i} bind:group={scene.check.answer} /><input bind:value={scene.check.options[i]} dir="auto" aria-label={'אפשרות '+(i+1)} /></label>{/each}</fieldset>
          {:else if scene.check.kind==='number' && typeof scene.check.answer==='number'}
            <label>התשובה הנכונה<input type="number" step="any" bind:value={scene.check.answer} /></label>
          {:else if Array.isArray(scene.check.answer)}
            <fieldset><legend>פרמטרי גרף המטרה</legend><div class="values">{#each scene.check.answer as _,i}<label>{parameterLabels[scene.visual][i]}<input type="number" min="-5" max="5" step="1" bind:value={scene.check.answer[i]} /></label>{/each}</div></fieldset>
          {/if}
          {#each scene.check.hints as _,i}<label>רמז {i+1}<textarea bind:value={scene.check.hints[i]} rows="2" maxlength="250"></textarea></label>{/each}
          {#if scene.check.solution!==undefined}<label>פתרון בשלבים · מוצג אחרי ניסיון ובקשה<textarea bind:value={scene.check.solution} rows="4" maxlength="1400"></textarea></label>{/if}
          <label>משוב על הצלחה<textarea bind:value={scene.check.success} rows="2" maxlength="280"></textarea></label><label>משוב לניסיון נוסף<textarea bind:value={scene.check.retry} rows="2" maxlength="280"></textarea></label>
        {/if}
      </details>
    {/each}
  </div><aside><form method="POST" action="/api/lessons/{data.slug}/experience" target="learning-preview"><input type="hidden" name="variant" value={data.variant??''} /><input type="hidden" name="learning" value={JSON.stringify(lesson)} /><button type="submit">עדכון התצוגה המקדימה</button></form><iframe name="learning-preview" title="תצוגה מקדימה של מרחב הלמידה" sandbox="allow-scripts" src="/app/learn/{data.slug}{data.variant==='homework'?'/homework':''}"></iframe></aside></div>
</main>

<style>
  .student-learning p{font-size:13px;color:var(--text-muted);line-height:1.7}.student-question{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:12px 0;border-bottom:1px solid var(--border)}.student-question:last-child{border-bottom:0}.student-question small{color:var(--text-muted);white-space:nowrap}@media(max-width:650px){.student-question{display:block}.student-question small{display:block;margin-top:8px}}
  .experience-editor{max-width:1400px;margin:auto;padding:32px;color:var(--text-primary)}nav{margin-bottom:24px}a{color:var(--accent);font-size:14px}header{display:flex;justify-content:space-between;align-items:start;gap:24px}h1{font-size:30px;margin:4px 0}header p{color:var(--text-muted);font-size:14px}.eyebrow{font-size:12px}.toolbar{display:flex;align-items:center;gap:12px;padding:16px 0;position: sticky; top:var(--workspace-header-height,65px);background:var(--bg-base);z-index:2}.toolbar span{font-size:12px;color:var(--text-muted)}button{font:inherit;padding:10px 18px;min-height:44px;border:1px solid var(--border);border-radius:8px;background:var(--bg-card);color:var(--text-primary);cursor:pointer}.primary{background:var(--action-fill);color:white}.editor-columns{display:grid;grid-template-columns:minmax(320px,1fr) minmax(350px,1fr);gap:28px}.intro,details{background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:14px}label{display:block;font-size:13px;margin:12px 0}input,textarea{display:block;width:100%;font:inherit;font-size:16px;border:1px solid var(--border);border-radius:7px;padding:10px;margin-top:6px;background:var(--bg-base);color:var(--text-primary)}textarea{resize:vertical}summary{cursor:pointer;min-height:44px;font-weight:700;display:flex;align-items:center;gap:12px}summary span,summary small{font-size:12px;font-weight:400;color:var(--text-muted)}summary small{margin-inline-start:auto}fieldset{border:1px solid var(--border);border-radius:8px;margin:14px 0;padding:14px}legend{font-size:12px;color:var(--text-muted)}h3{font-size:16px;margin-top:24px}.values{display:flex;gap:12px}.values label{flex:1}.math-preview{direction:ltr;font-size:20px;padding:12px}.option{display:flex;gap:12px;align-items:center}.option input[type=radio]{width:auto}aside{position:sticky;top:80px;align-self:start}aside form{margin-bottom:12px}iframe{width:100%;height:calc(100vh - 170px);min-height:550px;border:1px solid var(--border);border-radius:12px;background:var(--bg-card)}.failed{color:#b84926}button:focus-visible,input:focus-visible,textarea:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:3px}@media(max-width:850px){.experience-editor{padding:20px}header{display:block}.editor-columns{display:block}aside{position:static}.toolbar{flex-wrap:wrap}.toolbar span{width:100%}}
</style>
