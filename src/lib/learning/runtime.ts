/** Only TeX renderer output becomes markup; every piece of prose is a text node. */
export function writeLearningText(element: Element, text: string): void {
  const katex = (window as unknown as { katex?: { renderToString: (tex: string, options: object) => string } }).katex;
  const pattern = /\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g;
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    fragment.append(document.createTextNode(text.slice(cursor, match.index)));
    const span = document.createElement('span');
    span.dir = 'ltr'; span.className = 'learning-math';
    span.style.cssText = 'display:inline-block;direction:ltr;unicode-bidi:isolate;vertical-align:middle';
    try {
      if (!katex) throw new Error('math not ready');
      span.innerHTML = katex.renderToString(match[1] ?? match[2] ?? match[3], { throwOnError: true, trust: false });
    } catch { span.textContent = match[0]; span.setAttribute('data-math-error', ''); }
    fragment.append(span); cursor = match.index! + match[0].length;
  }
  fragment.append(document.createTextNode(text.slice(cursor)));
  element.replaceChildren(fragment);
}
