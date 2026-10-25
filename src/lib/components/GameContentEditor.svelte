<script lang="ts">
  let { body, onchange }: {
    body: Record<string, unknown>;
    onchange: (body: Record<string, unknown>) => void;
  } = $props();

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
  const clone = () => structuredClone(body);
  const emit = (next: Record<string, unknown>) => onchange(next);
  const primitive = (value: unknown) => typeof value === 'string' || typeof value === 'number';

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
  {#each Object.entries(body) as [key, value] (key)}
    {#if primitive(value)}
      <label class="field">{label(key)} <span>שדה חובה</span>
        <input dir="auto" type={typeof value === 'number' ? 'number' : 'text'} value={String(value)} oninput={(e) => setTop(key, e.currentTarget.value)} />
      </label>
    {:else if Array.isArray(value)}
      <fieldset class="collection">
        <legend>{label(key)} · שדה חובה</legend>
        {#each value as item, index (index)}
          <fieldset class="item">
            <legend>{label(key)} {index + 1}</legend>
            {#if primitive(item)}
              <input dir="auto" aria-label={`${label(key)} ${index + 1}`} type={typeof item === 'number' ? 'number' : 'text'} value={String(item)} oninput={(e) => setArrayItem(key, index, e.currentTarget.value)} />
            {:else if item && typeof item === 'object' && !Array.isArray(item)}
              {#each Object.entries(item) as [field, fieldValue] (field)}
                {#if primitive(fieldValue)}
                  <label class="field">{label(field)}
                    <input dir="auto" type={typeof fieldValue === 'number' ? 'number' : 'text'} value={String(fieldValue)} oninput={(e) => setObjectField(key, index, field, e.currentTarget.value)} />
                  </label>
                {:else if field === 'cells' && Array.isArray(fieldValue)}
                  <fieldset class="matrix">
                    <legend>{label(field)}</legend>
                    {#each fieldValue as cell, cellIndex (cellIndex)}
                      <label class="field">תא {cellIndex + 1}{cell && typeof cell === 'object' ? ' · תשובת תלמיד/ה' : ' · טקסט קבוע'}
                        <input dir="auto" value={cell && typeof cell === 'object' ? String((cell as Record<string, unknown>).answer ?? '') : String(cell)} oninput={(e) => setCell(key, index, field, cellIndex, e.currentTarget.value)} />
                      </label>
                    {/each}
                  </fieldset>
                {:else if Array.isArray(fieldValue) && (fieldValue.length === 0 || primitive(fieldValue[0]))}
                  <label class="field">{label(field)} · שורה לכל פריט
                    <textarea dir="auto" rows="4" value={fieldValue.join('\n')} oninput={(e) => setNestedList(key, index, field, e.currentTarget.value)}></textarea>
                  </label>
                {:else if Array.isArray(fieldValue)}
                  <fieldset class="matrix">
                    <legend>{label(field)}</legend>
                    {#each fieldValue as row, matrixIndex (matrixIndex)}
                      <label class="field">אפשרות {matrixIndex + 1} · מספרים מופרדים בפסיקים
                        <input dir="ltr" value={Array.isArray(row) ? row.join(', ') : ''} oninput={(e) => setNestedMatrix(key, index, field, matrixIndex, e.currentTarget.value)} />
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
