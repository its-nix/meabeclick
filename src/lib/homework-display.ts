/** Display-only projection of the existing task string; never HTML or persisted data. */
export interface HomeworkProblem { context: string; data: string[]; instruction: string }
function dataLines(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  let depth = 0;
  let inMath = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '$' && text[i - 1] !== '\\') {
      inMath = !inMath;
      if (text[i + 1] === '$') i++;
    }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth = Math.max(0, depth - 1);
    // A decimal comma (3,5), coordinate, function argument or LaTeX group
    // is not a datum boundary. Only top-level separators are presentation.
    if (!inMath && depth === 0 && (c === '\n' || c === ';' || (c === ',' && /\s/.test(text[i + 1] ?? '')))) {
      if (text.slice(start, i).trim()) lines.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (text.slice(start).trim()) lines.push(text.slice(start).trim());
  return lines;
}

function problem(text: string): HomeworkProblem {
  // Do not guess mathematical meaning from free prose or instruction verbs.
  // Without BOTH explicit labels, keep the original task intact.
  const sections = /^(.*?)\s*(?:הנתונים|נתונים|נתון)\s*:\s*([\s\S]*?)\s*(?:השאלה|שאלה|הוראה|הוראות)\s*:\s*([\s\S]+)$/s.exec(text);
  if (!sections) return { context: '', data: [], instruction: text };
  return { context: sections[1].trim(), data: dataLines(sections[2]), instruction: sections[3].trim() };
}

export function homeworkProblems(task: string): HomeworkProblem[] {
  const starts = [...task.matchAll(/^(\d+)[.)][ \t]+/gm)];
  // Only a complete, sequential list beginning at the start of the task.
  // An embedded sub-list must not steal context from the problem above it.
  if (starts.length > 1 && !task.slice(0, starts[0].index).trim()
      && starts.every((m, i) => Number(m[1]) === i + 1)) {
    return starts.map((m, i) => problem(task.slice(m.index! + m[0].length, starts[i + 1]?.index).trim()));
  }
  return [problem(task)];
}
