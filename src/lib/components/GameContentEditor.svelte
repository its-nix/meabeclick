<script lang="ts">
  type Issue = { path: string; message: string };
  let { body, template, issues = [], onchange }: {
    body: Record<string, unknown>;
    template: string;
    issues?: Issue[];
    onchange: (body: Record<string, unknown>) => void;
  } = $props();

  const constraintsByTemplate: Record<string, string> = {
    memory: 'יש להזין 6–16 זוגות. כל זוג וכל טקסט בכרטיס חייבים להיות ייחודיים.',
    matching: 'יש להזין 4–10 זוגות. שני הצדדים בכל זוג חייבים להיות ייחודיים.',
    sequence: 'יש להזין 3–8 שלבים ייחודיים בסדר הנכון.',
    sort: 'יש להזין 6–15 פריטים ייחודיים ולשייך כל אחד לאחת מ־2–3 קטגוריות ייחודיות.',
    labelling: 'יש להזין 3–10 יעדים. כל מזהה חייב להיות ייחודי ולהתאים לרכיב קיים ב־SVG, וכל תווית חייבת להיות ייחודית.',
    table: 'יש להזין 4–20 שורות. בכל שורה מספר התאים חייב להתאים למספר העמודות, ולפחות תא אחד צריך להיות תשובת תלמיד/ה.',
    quiz: 'יש להזין 4–15 שאלות. לכל שאלה לפחות שתי אפשרויות ייחודיות; מספר התשובה מתחיל ב־0 וחייב להתאים לאפשרות קיימת.',
    'error-hunt': 'יש להזין 2–8 סבבים. בכל סבב לפחות שני שלבים ייחודיים; מספר השלב השגוי מתחיל ב־0.',
    'two-truths': 'יש להזין 3–10 סבבים. בכל סבב בדיוק שלושה משפטים ייחודיים; מספר המשפט השקרי מתחיל ב־0.',
    'speed-drill': 'יש להזין 8–40 תרגילים וזמן גדול מאפס. לכל תרגיל 3–4 אפשרויות ייחודיות הכוללות את התשובה הנכונה.',
    'graph-match': 'יש להזין 2–8 סבבים. בכל סבב לפחות שתי נקודות ושתי אפשרויות שונות, עם אותו מספר נקודות ומספר תשובה שמתחיל ב־0.',
    'number-line': 'יש להזין 3–12 סבבים. המינימום קטן מהמקסימום; כל מטרה בתוך הציר וטווח הטעות גדול מאפס וקטן מטווח הציר.',
  };

  const LABELS: Record<string, string> = {
    title: 'כותרת המשחק', subject: 'נושא', pairs: 'זוגות', a: 'צד א', b: 'צד ב',
    left: 'צד אחד', right: 'הצד המתאים', hint: 'רמז', steps: 'שלבים',
    categories: 'קטגוריות', items: 'פריטים', text: 'טקסט', category: 'קטגוריה',
    svg: 'תרשים SVG', targets: 'יעדי תיוג', id: 'מזהה בתרשים', label: 'תווית',
    columns: 'עמודות', rows: 'שורות', cells: 'תאים', questions: 'שאלות', q: 'שאלה',
    options: 'אפשרויות', answer: 'תשובה נכונה (מספר החל מ־0)', why: 'הסבר',
    rounds: 'סבבים', problem: 'תרגיל', badStep: 'שלב שגוי (מספר החל מ־0)',
    statements: 'משפטים', lieIndex: 'המשפט השקרי (מספר החל מ־0)', seconds: 'זמן בשניות',
    mainLabel: 'כותרת הגרף', main: 'נקודות הגרף הראשי', prompt: 'הנחיה',
    min: 'ערך מינימלי', max: 'ערך מקסימלי', target: 'ערך מטרה', tolerance: 'טווח טעות',
  };
  const label = (key: string) => LABELS[key] ?? key;
  const clone = (): Record<string, unknown> =>
    structuredClone($state.snapshot(body)) as Record<string, unknown>;
  const emit = (next: Record<string, unknown>) => onchange(next);
  const primitive = (value: unknown) => typeof value === 'string' || typeof value === 'number';
  const fieldId = (path: string) => `game-${path.replaceAll('.', '-')}`;
  const issueFor = (path: string) => issues.find(issue => issue.path === path || issue.path === `game.${path}`);
  const describedBy = (path: string) => issueFor(path) ? `${fieldId(path)}-error` : undefined;

  function converted(raw: string, before: unknown): string | number {
    return typeof before === 'number' ? Number(raw) : raw;
  }
  function setTop(key: string, raw: string) {
    const next = clone();
    next[key] = converted(raw, next[key]);
    emit(next);
  }
  function setArrayItem(key: string, index: number, raw: string) {
    const next = clone();
    const list = next[key] as unknown[];
    list[index] = converted(raw, list[index]);
    emit(next);
  }
  function setObjectField(key: string, index: number, field: string, raw: string) {
    const next = clone();
    const item = (next[key] as Record<string, unknown>[])[index];
    item[field] = converted(raw, item[field]);
    emit(next);
  }
  function setNestedList(key: string, index: number, field: string, raw: string) {
    const next = clone();
    const item = (next[key] as Record<string, unknown>[])[index];
    const before = item[field] as unknown[];
    item[field] = raw.split('\n').map(line => converted(line, before[0]));
    emit(next);
  }
  function setNestedMatrix(key: string, index: number, field: string, matrixIndex: number, raw: string) {
    const next = clone();
    const item = (next[key] as Record<string, unknown>[])[index];
    const matrix = item[field] as unknown[][];
    matrix[matrixIndex] = raw.split(',').map(value => Number(value.trim()));
    emit(next);
  }
  function setCell(key: string, index: number, field: string, cellIndex: number, raw: string) {
    const next = clone();
    const item = (next[key] as Record<string, unknown>[])[index];
    const cells = item[field] as unknown[];
    cells[cellIndex] = cells[cellIndex] && typeof cells[cellIndex] === 'object' ? { answer: raw } : raw;
    emit(next);
  }
  function move(key: string, index: number, by: number) {
    const next = clone();
    const list = next[key] as unknown[];
    const target = index + by;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    emit(next);
  }
  function remove(key: string, index: number) {
    const next = clone();
    (next[key] as unknown[]).splice(index, 1);
    emit(next);
  }
  function add(key: string) {
    const next = clone();
    const list = next[key] as unknown[];
    list.push(structuredClone(list[0]));
    emit(next);
  }
</script>

<div class="editor-fields">
  <p class="constraints">יש למלא את כל שדות החובה. {constraintsByTemplate[template] ?? ''}</p>
  {#each Object.entries(body) as [key, value] (key)}
    {#if primitive(value)}
      <label class="field">{label(key)} <span>שדה חובה</span>
        <input id={fieldId(key)} dir="auto" type={typeof value === 'number' ? 'number' : 'text'} value={String(value)} aria-invalid={!!issueFor(key)} aria-describedby={describedBy(key)} oninput={(e) => setTop(key, e.currentTarget.value)} />
        {#if issueFor(key)}<span class="field-error" id={`${fieldId(key)}-error`}>{issueFor(key)?.message}</span>{/if}
      </label>
    {:else if Array.isArray(value)}
      <fieldset id={fieldId(key)} class="collection" tabindex="-1" aria-describedby={describedBy(key)}>
        <legend>{label(key)} · שדה חובה</legend>
        {#if issueFor(key)}<span class="field-error" id={`${fieldId(key)}-error`}>{issueFor(key)?.message}</span>{/if}
        {#each value as item, index (index)}
          <fieldset class="item">
            <legend>{label(key)} {index + 1}</legend>
            {#if primitive(item)}
              {@const path = `${key}.${index}`}
              <input id={fieldId(path)} dir="auto" aria-label={`${label(key)} ${index + 1}`} type={typeof item === 'number' ? 'number' : 'text'} value={String(item)} aria-invalid={!!issueFor(path)} aria-describedby={describedBy(path)} oninput={(e) => setArrayItem(key, index, e.currentTarget.value)} />
              {#if issueFor(path)}<span class="field-error" id={`${fieldId(path)}-error`}>{issueFor(path)?.message}</span>{/if}
            {:else if item && typeof item === 'object' && !Array.isArray(item)}
              {#each Object.entries(item) as [field, fieldValue] (field)}
                {#if primitive(fieldValue)}
                  {@const path = `${key}.${index}.${field}`}
                  <label class="field">{label(field)}
                    <input id={fieldId(path)} dir="auto" type={typeof fieldValue === 'number' ? 'number' : 'text'} value={String(fieldValue)} aria-invalid={!!issueFor(path)} aria-describedby={describedBy(path)} oninput={(e) => setObjectField(key, index, field, e.currentTarget.value)} />
                    {#if issueFor(path)}<span class="field-error" id={`${fieldId(path)}-error`}>{issueFor(path)?.message}</span>{/if}
                  </label>
                {:else if field === 'cells' && Array.isArray(fieldValue)}
                  {@const path = `${key}.${index}.${field}`}
                  <fieldset id={fieldId(path)} class="matrix" tabindex="-1" aria-describedby={describedBy(path)}>
                    <legend>{label(field)}</legend>
                    {#if issueFor(path)}<span class="field-error" id={`${fieldId(path)}-error`}>{issueFor(path)?.message}</span>{/if}
                    {#each fieldValue as cell, cellIndex (cellIndex)}
                      {@const cellPath = `${path}.${cellIndex}`}
                      <label class="field">תא {cellIndex + 1}{cell && typeof cell === 'object' ? ' · תשובת תלמיד/ה' : ' · טקסט קבוע'}
                        <input id={fieldId(cellPath)} dir="auto" value={cell && typeof cell === 'object' ? String((cell as Record<string, unknown>).answer ?? '') : String(cell)} aria-invalid={!!issueFor(cellPath)} aria-describedby={describedBy(cellPath)} oninput={(e) => setCell(key, index, field, cellIndex, e.currentTarget.value)} />
                        {#if issueFor(cellPath)}<span class="field-error" id={`${fieldId(cellPath)}-error`}>{issueFor(cellPath)?.message}</span>{/if}
                      </label>
                    {/each}
                  </fieldset>
                {:else if Array.isArray(fieldValue) && (fieldValue.length === 0 || primitive(fieldValue[0]))}
                  {@const path = `${key}.${index}.${field}`}
                  <label class="field">{label(field)} · שורה לכל פריט
                    <textarea id={fieldId(path)} dir="auto" rows="4" value={fieldValue.join('\n')} aria-invalid={!!issueFor(path)} aria-describedby={describedBy(path)} oninput={(e) => setNestedList(key, index, field, e.currentTarget.value)}></textarea>
                    {#if issueFor(path)}<span class="field-error" id={`${fieldId(path)}-error`}>{issueFor(path)?.message}</span>{/if}
                  </label>
                {:else if Array.isArray(fieldValue)}
                  {@const path = `${key}.${index}.${field}`}
                  <fieldset id={fieldId(path)} class="matrix" tabindex="-1" aria-describedby={describedBy(path)}>
                    <legend>{label(field)}</legend>
                    {#if issueFor(path)}<span class="field-error" id={`${fieldId(path)}-error`}>{issueFor(path)?.message}</span>{/if}
                    {#each fieldValue as row, matrixIndex (matrixIndex)}
                      {@const rowPath = `${path}.${matrixIndex}`}
                      <label class="field">אפשרות {matrixIndex + 1} · מספרים מופרדים בפסיקים
                        <input id={fieldId(rowPath)} dir="ltr" value={Array.isArray(row) ? row.join(', ') : ''} aria-invalid={!!issueFor(rowPath)} aria-describedby={describedBy(rowPath)} oninput={(e) => setNestedMatrix(key, index, field, matrixIndex, e.currentTarget.value)} />
                        {#if issueFor(rowPath)}<span class="field-error" id={`${fieldId(rowPath)}-error`}>{issueFor(rowPath)?.message}</span>{/if}
                      </label>
                    {/each}
                  </fieldset>
                {/if}
              {/each}
            {/if}
            <div class="item-actions">
              <button type="button" onclick={() => move(key, index, -1)} disabled={index === 0}>הזזה למעלה</button>
              <button type="button" onclick={() => move(key, index, 1)} disabled={index === value.length - 1}>הזזה למטה</button>
              <button type="button" class="danger" onclick={() => remove(key, index)} disabled={value.length <= 1}>הסרה</button>
            </div>
          </fieldset>
        {/each}
        <button type="button" class="add" onclick={() => add(key)}>הוספה</button>
      </fieldset>
    {/if}
  {/each}
</div>

<style>
  .editor-fields { display: grid; gap: 12px; }
  .field { display: grid; gap: 6px; font-size: .9rem; font-weight: 700; }
  .field > span { color: var(--text-muted); font-size: .72rem; font-weight: 500; }
  .constraints { margin: 0; color: var(--text-muted); font-size: .85rem; line-height: 1.6; }
  .field > .field-error { color: var(--danger); font-weight: 700; }
  input, textarea { box-sizing: border-box; width: 100%; min-width: 0; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-card); color: var(--text-primary); font: inherit; font-size: 16px; }
  .collection, .item, .matrix { min-width: 0; border: 1px solid var(--border); border-radius: var(--r-md); padding: 12px; display: grid; gap: 10px; }
  .item { background: var(--bg-subtle); }
  legend { padding-inline: 6px; font-weight: 800; }
  .item-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  button { min-height: 44px; padding: 0 12px; border: 1px solid var(--border-strong); border-radius: var(--r-sm); background: var(--bg-card); color: var(--text-primary); font: inherit; cursor: pointer; }
  button:disabled { opacity: .45; cursor: default; }
  .danger { color: var(--danger); }
  .add { justify-self: start; color: var(--accent); font-weight: 800; }
</style>
