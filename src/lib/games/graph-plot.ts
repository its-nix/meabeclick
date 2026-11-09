/** One coordinate system per round: separately scaled options can make distinct functions identical. */
export function sampleBounds(samples:number[][],xValues?:number[]){
 const xs=xValues??samples[0].map((_,i)=>i),values=samples.flat();
 const low=Math.min(0,...values),high=Math.max(0,...values),span=high-low||1;
 return {xs,explicitX:!!xValues,yMin:low,yMax:high+(span*.08)};
}
export function sampleGraph(ys:number[],tone:'primary'|'option',bounds:ReturnType<typeof sampleBounds>):string{
 const W=320,H=190,L=40,R=12,T=12,B=36,xMin=bounds.xs[0],xMax=bounds.xs.at(-1)!;
 const px=(v:number)=>L+(v-xMin)/(xMax-xMin||1)*(W-L-R),py=(v:number)=>H-B-(v-bounds.yMin)/(bounds.yMax-bounds.yMin)*(H-T-B);
 const n=(v:number)=>String(Number(v!==0&&(Math.abs(v)<.01||Math.abs(v)>=10000)?v.toPrecision(3):v.toFixed(2))),stroke=tone==='primary'?'var(--accent)':'var(--text-primary)';
 const pts=ys.map((v,i)=>`${px(bounds.xs[i]).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
 const horizontal=`<line x1="${L}" y1="${py(0)}" x2="${W-R}" y2="${py(0)}" stroke="var(--border-strong)"/>`;
 const vertical=xMin<=0&&xMax>=0?`<line data-zero-x="${px(0)}" x1="${px(0)}" y1="${T}" x2="${px(0)}" y2="${H-B}" stroke="var(--border-strong)"/>`:'';
 const xs=bounds.xs.map(v=>`<text data-sample-x="${v}" x="${px(v)}" y="${H-B+18}" text-anchor="middle">${n(v)}</text>`).join('');
 const ticks=[bounds.yMin,(bounds.yMin+bounds.yMax)/2,bounds.yMax].map(v=>`<text x="${L-7}" y="${py(v)+4}" text-anchor="end">${n(v)}</text>`).join('');
 return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="נקודות דגימה במערכת צירים משותפת" direction="ltr" font-family="inherit" font-size="12" fill="var(--text-primary)">${horizontal}${vertical}${xs}${ticks}<text x="${W-R}" y="${H-2}" text-anchor="end">${bounds.explicitX?'x':'סדר דגימות'}</text><polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>${ys.map((v,i)=>`<circle cx="${px(bounds.xs[i])}" cy="${py(v)}" r="2.8" fill="${stroke}"/>`).join('')}</svg>`;
}
