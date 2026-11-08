import type { LearningScene, VisualKind } from './model.ts';

/** Pure, seekable state: the web lesson and video renderer use this exact clock. */
export function learningFrameAt(scene: LearningScene, seconds: number): { values: number[]; frame: number; progress: number } {
  const beat = 4;
  const duration = Math.max(1, scene.frames.length - 1) * beat + 2;
  const t = Math.max(0, Math.min(seconds, duration));
  const index = Math.min(scene.frames.length - 1, Math.floor(t / beat));
  const next = Math.min(scene.frames.length - 1, index + 1);
  const p = Math.max(0, Math.min(1, (t - index * beat - 1.2) / 1.6));
  const smooth = p * p * (3 - 2 * p);
  const discrete = ['balance', 'fraction-bar', 'right-triangle', 'function-tangent'].includes(scene.visual);
  return {
    values: scene.frames[index].values.map((v, i) => discrete
      ? (smooth < .5 ? v : scene.frames[next].values[i])
      : v + (scene.frames[next].values[i] - v) * smooth),
    frame: discrete ? (smooth < .5 ? index : next) : p > 0 ? next : index,
    progress: t / duration,
  };
}

export function formulaForVisual(kind: VisualKind, values: number[]): string {
  const precise = kind === 'right-triangle' || kind === 'function-tangent';
  const n = (v: number) => {
    const value = precise ? String(v) : String(Math.abs(v) < 0.005 ? 0 : Number(v.toFixed(2)));
    const [mantissa, exponent] = value.split('e');
    return exponent === undefined ? value : `${mantissa}\\times10^{${Number(exponent)}}`;
  };
  const sign = (v: number) => v < 0 ? `-${n(-v)}` : `+${n(v)}`;
  if (kind === 'quadratic') {
    const [a, h, k] = values;
    return `y=${a === 1 ? '' : a === -1 ? '-' : n(a)}${h === 0 ? 'x^2' : `(x${sign(-h)})^2`}${k === 0 ? '' : sign(k)}`;
  }
  if (kind === 'linear') return `y=${values[0] === 1 ? '' : values[0] === -1 ? '-' : n(values[0])}x${values[1] === 0 ? '' : sign(values[1])}`;
  if (kind === 'fraction-bar') return `\\frac{${values[0]}}{${values[1]}}`;
  if (kind === 'right-triangle') {
    const base = (v: number) => String(v).includes('e') ? `\\left(${n(v)}\\right)` : n(v);
    return `c^2=${base(values[0])}^2+${base(values[1])}^2`;
  }
  if (kind === 'function-tangent') {
    const [a,b,c,t] = values;
    return `f(x)=${n(a)}x^2${sign(b)}x${sign(c)},\\quad x_0=${n(t)}`;
  }
  if (kind === 'balance') return `${values[0] === 1 ? '' : n(values[0])}x${values[1] === 0 ? '' : sign(values[1])}=${n(values[2])}`;
  if (kind === 'number-line') {
    for (let denominator = 2; denominator <= 12; denominator++) {
      const numerator = Math.round(values[0]*denominator);
      if (!Number.isInteger(values[0]) && Math.abs(values[0]-numerator/denominator) < 1e-8) return `\\frac{${numerator}}{${denominator}}`;
    }
  }
  return n(values[0]);
}

/** No captured dependencies: this function is also embedded in standalone HTML/video. */
export function drawLearningVisual(
  targetSvg: SVGSVGElement, kind: VisualKind, values: number[], xDomain: number[], yDomain: number[],
  options: { target?: number[]; hide?: boolean; reference?: number[]; question?: boolean } = {},
): void {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  for (const attribute of targetSvg.attributes) svg.setAttribute(attribute.name, attribute.value);
  // Preserve DOM identity while seeking: labels stay stable for accessibility and video inspection.
  const reconcile = (target: Element, source: Element): void => {
    for (const name of target.getAttributeNames()) if (!source.hasAttribute(name)) target.removeAttribute(name);
    for (const name of source.getAttributeNames()) if (target.getAttribute(name) !== source.getAttribute(name)) target.setAttribute(name, source.getAttribute(name)!);
    if (!source.children.length) {
      if (target.textContent !== source.textContent) target.textContent = source.textContent;
      return;
    }
    [...source.children].forEach((child, index) => {
      const previous = target.children[index];
      if (!previous) target.append(child.cloneNode(true));
      else if (previous.tagName !== child.tagName) previous.replaceWith(child.cloneNode(true));
      else reconcile(previous, child);
    });
    while (target.children.length > source.children.length) target.lastElementChild!.remove();
  };
  const commit = () => reconcile(targetSvg, svg);
  const make = (tag: string, attrs: Record<string, string | number> = {}, text?: string): SVGElement => {
    const e = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, String(v)));
    if (text !== undefined) e.textContent = text;
    return e;
  };
  svg.setAttribute('viewBox', '0 0 800 460');
  const W = 800, H = 460, left = 58, top = 28, right = 30, bottom = 42;
  const x = (v: number) => left + (v - xDomain[0]) / (xDomain[1] - xDomain[0]) * (W - left - right);
  const y = (v: number) => H - bottom - (v - yDomain[0]) / (yDomain[1] - yDomain[0]) * (H - top - bottom);
  // New numeric givens keep their supplied precision, including very small nonzero values.
  const precise = kind === 'right-triangle' || kind === 'function-tangent';
  const label = (v: number) => (precise ? String(v) : String(Number(v.toFixed(2)))).replace('-', '−');
  if (options.hide && !options.target) {
    svg.append(make('circle', { cx: 400, cy: 205, r: 72, class: 'plot-hold' }));
    svg.append(make('text', { x: 400, y: 224, 'text-anchor': 'middle', class: 'plot-question' }, '?'));
    svg.append(make('text', { x: 400, y: 320, 'text-anchor': 'middle', class: 'plot-note' }, 'הפעם נותנים לנוסחה לדבר'));
    commit(); return;
  }
  if (kind === 'steps') { commit(); return; }
  if (kind === 'fraction-bar') {
    const [part,whole] = values;
    for (let i=0; i<whole; i++) svg.append(make('rect', {
      x: 70+i*660/whole, y: 155, width: 660/whole, height: 126,
      class: i<part ? 'fraction-cell fraction-filled' : 'fraction-cell',
      'data-partition': i,
    }));
    svg.append(make('text', {x:400,y:335,'text-anchor':'middle',class:'plot-note'}, options.question ? 'כל החלקים שווים בגודלם' : `${part} / ${whole}`));
    commit(); return;
  }
  if (kind === 'right-triangle') {
    const [a,b] = values;
    const scale = Math.min(530/a, 280/b), ox=135, oy=365, ax=ox+a*scale, by=oy-b*scale;
    svg.append(make('path',{d:`M${ox} ${by} L${ox} ${oy} L${ax} ${oy} Z`,class:'triangle-shape'}));
    const mark = Math.min(24,a*scale/4,b*scale/4);
    svg.append(make('path',{d:`M${ox} ${oy-mark} h${mark} v${mark}`,class:'triangle-angle'}));
    svg.append(make('text',{x:(ox+ax)/2,y:oy+38,'text-anchor':'middle',class:'plot-coordinate'},label(a)));
    svg.append(make('text',{x:ox-25,y:(oy+by)/2,'text-anchor':'end',class:'plot-coordinate'},label(b)));
    svg.append(make('text',{x:(ox+ax)/2+28,y:(oy+by)/2-18,'text-anchor':'middle',class:'plot-coordinate','data-derived':'hypotenuse'},options.question ? '?' : `c ${Number.isInteger(Math.hypot(a,b)) ? '=' : '≈'} ${label(Math.hypot(a,b))}`));
    commit(); return;
  }
  if (kind === 'balance') {
    const [coefficient, constant, total] = values;
    svg.append(make('line', { x1: 150, y1: 202, x2: 650, y2: 202, class: 'balance-beam' }));
    svg.append(make('path', { d: 'M400 208 L355 355 L445 355 Z', class: 'balance-base' }));
    for (const center of [230, 570]) {
      svg.append(make('path', { d: `M${center-105} 220 Q${center} 295 ${center+105} 220`, class: 'balance-pan' }));
      svg.append(make('line', { x1: center, y1: 202, x2: center, y2: 80, class: 'balance-string' }));
    }
    const count = Math.max(1, Math.round(coefficient));
    for (let i = 0; i < count; i++) {
      const bx = 145 + i % 3 * 48, by = 165 - Math.floor(i / 3) * 50;
      svg.append(make('rect', { x: bx, y: by, width: 42, height: 42, rx: 10, class: 'algebra-tile' }));
      svg.append(make('text', { x: bx + 21, y: by + 29, 'text-anchor': 'middle', class: 'algebra-letter' }, 'x'));
    }
    if (constant > 0.01) {
      svg.append(make('circle', { cx: 308, cy: 182, r: 26, class: 'unit-tile' }));
      svg.append(make('text', { x: 308, y: 191, 'text-anchor': 'middle', class: 'unit-letter' }, `+${label(constant)}`));
    }
    svg.append(make('rect', { x: 522, y: 140, width: 96, height: 68, rx: 16, class: 'total-tile' }));
    svg.append(make('text', { x: 570, y: 184, 'text-anchor': 'middle', class: 'total-letter' }, label(total)));
    svg.append(make('text', { x: 400, y: 410, 'text-anchor': 'middle', class: 'plot-note' }, 'אותה פעולה בשני הצדדים שומרת על השוויון'));
    commit(); return;
  }
  if (kind === 'number-line') {
    const cy = 220;
    svg.append(make('line', { x1: left, y1: cy, x2: W - right, y2: cy, class: 'plot-axis' }));
    const step = Math.max(1, Math.ceil((xDomain[1] - xDomain[0]) / 12));
    for (let v = Math.ceil(xDomain[0] / step) * step; v <= xDomain[1]; v += step) {
      svg.append(make('line', { x1: x(v), y1: cy-9, x2: x(v), y2: cy+9, class: 'plot-axis' }));
      svg.append(make('text', { x: x(v), y: cy+42, 'text-anchor': 'middle', class: 'plot-label' }, label(v)));
    }
    svg.append(make('line', { x1: x(Math.max(xDomain[0], Math.min(0, xDomain[1]))), y1: cy, x2: x(values[0]), y2: cy, class: 'number-travel' }));
    svg.append(make('circle', { cx: x(values[0]), cy, r: 12, class: 'plot-point' }));
    svg.append(make('text', { x: x(values[0]), y: cy-42, 'text-anchor': 'middle', class: 'plot-coordinate' }, label(values[0])));
    commit(); return;
  }
  const clip = `plot-clip-${svg.id || 'main'}`;
  const defs = make('defs'), clipPath = make('clipPath', { id: clip });
  clipPath.append(make('rect', { x: left, y: top, width: W-left-right, height: H-top-bottom }));
  defs.append(clipPath); svg.append(defs);
  const stepX = Math.max(1, Math.ceil((xDomain[1] - xDomain[0]) / 12));
  const stepY = Math.max(1, Math.ceil((yDomain[1] - yDomain[0]) / 10));
  const zeroY = y(Math.max(yDomain[0], Math.min(0, yDomain[1])));
  const zeroX = x(Math.max(xDomain[0], Math.min(0, xDomain[1])));
  for (let v = Math.ceil(xDomain[0] / stepX) * stepX; v <= xDomain[1]; v += stepX) {
    svg.append(make('line', { x1: x(v), y1: top, x2: x(v), y2: H-bottom, class: 'plot-grid' }));
    if (v !== 0) svg.append(make('text', { x: x(v), y: Math.min(H-8, zeroY+30), 'text-anchor': 'middle', class: 'plot-label' }, label(v)));
  }
  for (let v = Math.ceil(yDomain[0] / stepY) * stepY; v <= yDomain[1]; v += stepY) {
    svg.append(make('line', { x1: left, y1: y(v), x2: W-right, y2: y(v), class: 'plot-grid' }));
    if (v !== 0) svg.append(make('text', { x: Math.max(30, zeroX-15), y: y(v)+7, 'text-anchor': 'end', class: 'plot-label' }, label(v)));
  }
  svg.append(make('line', { x1: left, y1: zeroY, x2: W-right+8, y2: zeroY, class: 'plot-axis' }));
  svg.append(make('line', { x1: zeroX, y1: top-8, x2: zeroX, y2: H-bottom, class: 'plot-axis' }));
  svg.append(make('text', { x: W-right+8, y: zeroY-16, class: 'plot-label' }, 'x'));
  svg.append(make('text', { x: zeroX+16, y: top+8, class: 'plot-label' }, 'y'));
  const group = make('g', { 'clip-path': `url(#${clip})` });
  const curve = (params: number[], cls: string) => {
    const points: string[] = [];
    for (let i = 0; i <= 240; i++) {
      const vx = xDomain[0] + (xDomain[1] - xDomain[0]) * i / 240;
      const vy = kind === 'quadratic' ? params[0] * (vx-params[1])**2 + params[2] : kind === 'function-tangent' ? params[0]*vx*vx+params[1]*vx+params[2] : params[0]*vx+params[1];
      points.push(`${i ? 'L' : 'M'}${x(vx).toFixed(2)},${Math.max(-2000, Math.min(2000, y(vy))).toFixed(2)}`);
    }
    group.append(make('path', { d: points.join(' '), class: cls }));
  };
  if (options.reference && !options.hide) curve(options.reference, 'plot-reference');
  if (options.target) curve(options.target, 'plot-target');
  // The target is the question, not a worked answer. Independent construction
  // hides the student's candidate and its vertex until checking succeeds.
  if (options.hide) { svg.append(group); commit(); return; }
  curve(values, 'plot-curve');
  if (kind === 'function-tangent') {
    const [a,b,c,t] = values, height=a*t*t+b*t+c;
    // Decimal givens cancel exactly: a floating-point epsilon would also erase real small slopes.
    // Finite scene values bound this arithmetic to a few hundred decimal places.
    const decimal = (v: number): [bigint, number] => {
      const [mantissa, power = '0'] = String(v).split('e');
      const [whole, fraction = ''] = mantissa.split('.');
      return [BigInt(whole + fraction), Number(power) - fraction.length];
    };
    const [av, ae] = decimal(a), [tv, te] = decimal(t), [bv, be] = decimal(b);
    const exponent = Math.min(ae + te, be);
    const coefficient = 2n * av * tv * 10n ** BigInt(ae + te - exponent) + bv * 10n ** BigInt(be - exponent);
    const slope = Number(`${coefficient}e${exponent}`);
    group.append(make('line',{x1:x(xDomain[0]),y1:y(height+slope*(xDomain[0]-t)),x2:x(xDomain[1]),y2:y(height+slope*(xDomain[1]-t)),class:'plot-tangent'}));
    group.append(make('circle',{cx:x(t),cy:y(height),r:8,class:'plot-point'}));
    svg.append(group);
    svg.append(make('text',{x:400,y:445,'text-anchor':'middle',class:'plot-note','data-derived':'slope'},options.question ? `x = ${label(t)}` : `x = ${label(t)}, m = ${label(slope)}`));
    commit(); return;
  }
  const px = kind === 'quadratic' ? values[1] : 0, py = kind === 'quadratic' ? values[2] : values[1];
  group.append(make('path', { d: `M${x(px)} ${zeroY} V${y(py)} H${zeroX}`, class: 'plot-projection' }));
  group.append(make('circle', { cx: x(px), cy: y(py), r: 18, class: 'plot-point-halo' }));
  group.append(make('circle', { cx: x(px), cy: y(py), r: 7, class: 'plot-point' }));
  svg.append(group);
  commit();
}
