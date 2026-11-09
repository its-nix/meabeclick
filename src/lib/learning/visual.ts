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
  const discrete=['balance','fraction','geometry','data-bars','normal','normal-school'].includes(scene.visual);
  return {
    values: scene.frames[index].values.map((v, i) => discrete
      ? (smooth < .5 ? v : scene.frames[next].values[i])
      : v + (scene.frames[next].values[i] - v) * smooth),
    frame: discrete?(smooth<.5?index:next):p>0?next:index,
    progress: t / duration,
  };
}

export function formulaForVisual(kind: VisualKind, values: number[]): string {
  const n = (v: number) => String(Math.abs(v) < 0.005 ? 0 : Number(v.toFixed(2)));
  const sign = (v: number) => v < 0 ? `-${n(-v)}` : `+${n(v)}`;
  if (kind === 'quadratic') {
    const [a, h, k] = values;
    return `y=${a === 1 ? '' : a === -1 ? '-' : n(a)}${h === 0 ? 'x^2' : `(x${sign(-h)})^2`}${k === 0 ? '' : sign(k)}`;
  }
  if (kind === 'linear') return `y=${values[0] === 1 ? '' : values[0] === -1 ? '-' : n(values[0])}x${values[1] === 0 ? '' : sign(values[1])}`;
  if (kind === 'balance') return `${values[0] === 1 ? '' : n(values[0])}x${values[1] === 0 ? '' : sign(values[1])}=${n(values[2])}`;
  if(kind==='fraction'){const [a,b,k]=values;return `\\frac{${a}}{${b}}=\\frac{${a*k}}{${b*k}}`;}
  if(kind==='geometry'){
    const [shape,a,b,h]=values;
    const exact=(v:number)=>String(Number(v.toFixed(8))),third=(v:number)=>Number.isInteger(v/3)?exact(v/3):`\\frac{${exact(v)}}{3}`;
    if(shape===8)return `c^2=a^2+b^2=${exact(a*a+b*b)},\\quad c=\\sqrt{${exact(a*a+b*b)}}${Number.isInteger(Math.sqrt(a*a+b*b))?'='+exact(Math.sqrt(a*a+b*b)):''}`;
    if(shape===1)return `A=\\frac{b h}{2}=\\frac{${n(a)}\\cdot ${n(b)}}{2}=${exact(a*b/2)}`;
    if(shape===2)return `A=a b=${n(a)}\\cdot ${n(b)}=${exact(a*b)}`;
    if(shape===3)return `A=\\pi r^2=${exact(a*a)}\\pi`;
    if(shape===4)return `V=a b h=${exact(a*b*h)}`;
    if(shape===5)return `V=\\pi r^2 h=${exact(a*a*h)}\\pi`;
    if(shape===6)return `V=\\frac{\\pi r^2 h}{3}=${third(a*a*h)}\\pi`;
    return `V=\\frac{a b h}{3}=${third(a*b*h)}`;
  }
  if(kind==='data-bars'){const count=values.reduce((a,b)=>a+b,0);return `N=${count},\\quad\\bar{x}=\\frac{${values.reduce((a,b,i)=>a+b*(i+1),0)}}{${count}}`;}
  if(kind==='normal'||kind==='normal-school'){
    const [mu,sd,lo,hi]=values;
    const cdf=(z:number)=>{const t=1/(1+.2316419*Math.abs(z));const tail=Math.exp(-z*z/2)/Math.sqrt(2*Math.PI)*t*(.319381530+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));return z<0?tail:1-tail;};
    const school=(z:number)=>{const bands=[19,15,9,5,1.5,.5];return 50+Math.sign(z)*bands.slice(0,Math.min(6,Math.round(Math.abs(z)*2))).reduce((a,b)=>a+b,0);};
    const area=kind==='normal-school'?school((hi-mu)/sd)-school((lo-mu)/sd):100*(cdf((hi-mu)/sd)-cdf((lo-mu)/sd));
    return `\\begin{gathered}P(${n(lo)}\\le X\\le ${n(hi)})\\approx ${n(area)}\\%\\\\\\mu=${n(mu)},\\quad ${kind==='normal-school'?'s':'\\sigma'}=${n(sd)}\\end{gathered}`;
  }
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
  options: { target?: number[]; hide?: boolean; reference?: number[];questionOnly?:boolean } = {},
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
  const label = (v: number) => String(Number(v.toFixed(2))).replace('-', '−');
  if (options.hide && !options.target) {
    svg.append(make('circle', { cx: 400, cy: 205, r: 72, class: 'plot-hold' }));
    svg.append(make('text', { x: 400, y: 224, 'text-anchor': 'middle', class: 'plot-question' }, '?'));
    svg.append(make('text', { x: 400, y: 320, 'text-anchor': 'middle', class: 'plot-note' }, 'הפעם נותנים לנוסחה לדבר'));
    commit(); return;
  }
  if (kind === 'steps') { commit(); return; }
  if(kind==='fraction'){
    const [a,b,k]=values;
    for(const [row,parts,filled]of [[0,b,a],[1,b*k,a*k]]){
      for(let i=0;i<parts;i++)svg.append(make('rect',{x:100+i*600/parts,y:100+row*150,width:600/parts,height:90,fill:i<filled?'var(--brand)':'var(--card)',stroke:'var(--text)','stroke-width':2}));
      svg.append(make('text',{x:400,y:row?392:80,'text-anchor':'middle',class:'plot-coordinate'},row&&options.questionOnly?'? / ?':`${filled} / ${parts}`));
    }
    commit();return;
  }
  if(kind==='geometry'){
    const [shape,a,b,h]=values,scale=240/Math.max(a,b,h,1),w=a*scale,hh=(shape<3||shape===8?b:h)*scale;
    const outline={fill:'var(--surface)',stroke:'var(--brand)','stroke-width':4};
    const text=(tx:number,ty:number,t:string)=>svg.append(make('text',{x:tx,y:ty,'text-anchor':'middle',class:'plot-coordinate'},t));
    if(shape===1||shape===8){svg.append(make('path',{d:`M170 340 L${170+w} 340 L170 ${340-hh} Z`,...outline}));svg.append(make('path',{d:'M170 320 h20 v20',fill:'none',stroke:'var(--text)','stroke-width':2}));text(170+w/2,380,`${shape===8?'a':'b'} = ${label(a)}`);text(125,340-hh/2,`${shape===8?'b':'h'} = ${label(b)}`);if(shape===8)text(195+w/2,320-hh/2,'c');}
    else if(shape===2){svg.append(make('rect',{x:200,y:80,width:w,height:Math.max(30,b*scale),...outline}));text(200+w/2,60,`a = ${label(a)}`);text(145,180,`b = ${label(b)}`);}
    else if(shape===3){svg.append(make('circle',{cx:400,cy:220,r:140,...outline}));svg.append(make('line',{x1:400,y1:220,x2:540,y2:220,stroke:'var(--text)','stroke-width':3}));text(470,205,`r = ${label(a)}`);}
    else{
      // Schematic solids: h is the dashed perpendicular, never a sloping edge.
      if(shape===5||shape===6){svg.append(make('path',{d:shape===6?'M250 330 L400 75 L550 330':'M250 330 L250 100 Q400 40 550 100 L550 330',...outline}));svg.append(make('ellipse',{cx:400,cy:330,rx:150,ry:40,...outline}));svg.append(make('line',{x1:400,y1:330,x2:550,y2:330,stroke:'var(--text)','stroke-width':2}));text(475,315,`r = ${label(a)}`);}
      else{svg.append(make('path',{d:shape===7?'M220 330 L520 330 L580 270 L280 270 Z M220 330 L400 70 L520 330 M400 70 L580 270 M400 70 L280 270':'M220 330 L520 330 L580 270 L580 90 L280 90 L220 150 Z M220 150 L520 150 L580 90 M520 150 V330',...outline}));text(360,385,`a = ${label(a)}, b = ${label(b)}`);}
      svg.append(make('line',{x1:400,y1:[4,7].includes(shape)?300:330,x2:400,y2:shape===4?120:75,stroke:'var(--text)','stroke-width':3,'stroke-dasharray':'8 6'}));text(355,205,`h = ${label(h)}`);
      text(400,440,'תרשים סכמטי · הגובה מאונך לבסיס');
    }
    commit();return;
  }
  if(kind==='data-bars'){
    const scale=290/Math.max(...values,1);
    svg.append(make('path',{d:'M90 50 V370 H730',class:'plot-axis'}));
    values.forEach((v,i)=>{const bx=135+i*150;svg.append(make('rect',{x:bx,y:370-v*scale,width:90,height:v*scale,rx:8,fill:'var(--brand)'}));svg.append(make('text',{x:bx+45,y:350-v*scale,'text-anchor':'middle',class:'plot-coordinate'},label(v)));svg.append(make('text',{x:bx+45,y:410,'text-anchor':'middle',class:'plot-label'},String(i+1)));});
    svg.append(make('text',{x:90,y:30,class:'plot-note'},'שכיחות'));svg.append(make('text',{x:730,y:410,class:'plot-note'},'ערך'));commit();return;
  }
  if(kind==='normal'||kind==='normal-school'){
    const [mu,sd,lo,hi]=values,zx=(z:number)=>400+z*98,zy=(z:number)=>340-250*Math.exp(-z*z/2);
    const points=(a:number,b:number)=>Array.from({length:121},(_,i)=>{const z=a+(b-a)*i/120;return `${i?'L':'M'}${zx(z)},${zy(z)}`;}).join(' ');
    svg.append(make('path',{d:points(-3.5,3.5),fill:'none',stroke:'var(--brand)','stroke-width':4}));
    const a=(lo-mu)/sd,b=(hi-mu)/sd;
    svg.append(make('path',{d:`M${zx(a)} 340 ${points(a,b).replace(/^M/,'L')} L${zx(b)} 340 Z`,fill:'var(--brand)',opacity:.22}));
    svg.append(make('line',{x1:55,y1:340,x2:745,y2:340,class:'plot-axis'}));
    for(let z=-3;z<=3;z+=.5){svg.append(make('line',{x1:zx(z),y1:340,x2:zx(z),y2:zy(z),stroke:'var(--text)',opacity:.25}));if(Number.isInteger(z))svg.append(make('text',{x:zx(z),y:377,'text-anchor':'middle',class:'plot-label'},label(mu+z*sd)));}
    if(kind==='normal-school')for(let i=0;i<6;i++)for(const sign of [-1,1])svg.append(make('text',{x:zx(sign*(i*.5+.25)),y:415,'text-anchor':'middle','font-size':16,fill:'var(--text)'},`${[19,15,9,5,1.5,.5][i]}%`));
    svg.append(make('text',{x:400,y:449,'text-anchor':'middle',class:'plot-note'},kind==='normal-school'?'קירוב בית ספרי · רצועות של חצי s':'מודל נורמלי · השטח המחושב לפי ההתפלגות'));
    commit();return;
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
      const vy = kind === 'quadratic' ? params[0] * (vx-params[1])**2 + params[2] : params[0]*vx+params[1];
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
  const px = kind === 'quadratic' ? values[1] : 0, py = kind === 'quadratic' ? values[2] : values[1];
  group.append(make('path', { d: `M${x(px)} ${zeroY} V${y(py)} H${zeroX}`, class: 'plot-projection' }));
  group.append(make('circle', { cx: x(px), cy: y(py), r: 18, class: 'plot-point-halo' }));
  group.append(make('circle', { cx: x(px), cy: y(py), r: 7, class: 'plot-point' }));
  svg.append(group);
  commit();
}
