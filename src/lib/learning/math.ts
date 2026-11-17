import katex from 'katex';
import { formulaRuns } from '../bidi.ts';

export const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A single renderer for prose, delimited TeX, student materials and print. */
export function mathText(text: string): string {
  const regex = /\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g;
  let result = '', cursor = 0;
  const prose = (s: string) => formulaRuns(s).map(r => r.ltr ? `<bdi dir="ltr">${escapeHtml(r.text)}</bdi>` : escapeHtml(r.text)).join('');
  for (const m of text.matchAll(regex)) {
    result += prose(text.slice(cursor, m.index));
    const tex = m[1] ?? m[2] ?? m[3];
    try {
      result += `<span class="learning-math" dir="ltr">${katex.renderToString(tex, { throwOnError: true, trust: false, strict: 'error', maxExpand: 200, maxSize: 10, displayMode: m[1] === undefined })}</span>`;
    } catch {
      result += `<bdi dir="ltr" data-math-error>${escapeHtml(m[0])}</bdi>`;
    }
    cursor = m.index! + m[0].length;
  }
  return result + prose(text.slice(cursor));
}

export function mathFormula(tex: string): string {
  return katex.renderToString(tex, { throwOnError: true, trust: false, strict: 'error', maxExpand: 200, maxSize: 10 });
}
