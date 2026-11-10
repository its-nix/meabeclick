import type {NormalModel,NormalState} from './model.ts';

/** Self-contained: the exact same mathematical recipe runs in rendered HTML and in browser interaction. */
export function normalVisual(model:NormalModel,stage=0,scope='normal',override:Partial<NormalState>={},comparison:NormalModel[]=[]){
 const base=model.states[0],s={...model.states[Math.min(stage,model.states.length-1)],...override};
 const fmt=(n:number)=>Number(n.toFixed(2)).toString();
 const bounds=[-4,-2.5,-2,-1.5,-1,-.5,0,.5,1,1.5,2,2.5,4],cumulative=[0,.5,2,7,16,31,50,69,84,93,98,99.5,100];
 const index=(n:number|null)=>n===null?-1:bounds.findIndex(v=>Math.abs(v-n)<1e-7);
 const li=index(s.lowerZ),ui=index(s.upperZ),percent=li>=0&&ui>=li?cumulative[ui]-cumulative[li]:null;
 const mean=fmt(s.mean),sd=fmt(s.sd),value=(z:number)=>s.mean+z*s.sd;
 const pool=[model,...comparison].flatMap(m=>m.states);
 const maxSd=model.interactive==='spread'?base.sd*1.75:Math.max(...pool.map(v=>v.sd)),minSd=model.interactive==='spread'?base.sd*.65:Math.min(...pool.map(v=>v.sd));
 const xmin=Math.min(...pool.map(v=>v.mean))-3.4*maxSd,xmax=Math.max(...pool.map(v=>v.mean))+3.4*maxSd;
 const x=(v:number)=>62+(v-xmin)/(xmax-xmin)*776;
 const y=(v:number)=>270-165*(minSd/s.sd)*Math.exp(-.5*((v-s.mean)/s.sd)**2);
 const points=Array.from({length:181},(_,i)=>{const v=xmin+(xmax-xmin)*i/180;return [x(v),Math.max(8,y(v))];});
 const curve=points.map(p=>p.map(n=>n.toFixed(2)).join(',')).join(' ');
 const area=`62,270 ${curve} 838,270`;
 const clip='normal-'+scope.replace(/[^a-zA-Z0-9-]/g,'');
 const clamp=(v:number)=>Math.max(62,Math.min(838,v));
 const lower=s.lowerZ===null?62:clamp(x(value(s.lowerZ))),upper=s.upperZ===null?62:clamp(x(value(s.upperZ)));
 const shaded=s.lowerZ!==null&&s.upperZ!==null;
 const reference=pool.reduce((a,b)=>a.sd>b.sd?a:b),rawStep=maxSd/2,magnitude=10**Math.floor(Math.log10(rawStep)),scaled=rawStep/magnitude,niceStep=(scaled<=1?1:scaled<=2?2:scaled<=5?5:10)*magnitude;
 const axisValue=(z:number)=>model.interactive==='spread'?base.mean+z*2*niceStep:comparison.length?reference.mean+z*maxSd:value(z);
 const tick=(z:number)=>{
  const v=axisValue(z),at=x(v);if(at<60||at>840)return '';
  const hidden=s.hideZ!==null&&Math.abs(v-value(s.hideZ))<1e-7;
  const label=hidden?'?':fmt(v),fontSize=Math.max(20,32-6*Math.max(0,label.length-3));
  return `<g data-z-tick="${z}" data-missing="${hidden}"><line x1="${at}" y1="270" x2="${at}" y2="279" stroke="currentColor"/><text x="${at}" y="306" text-anchor="middle" font-size="${fontSize}">${label}</text></g>`;
 };
 const bandLabels=model.mode==='bands'||model.mode==='cumulative'?bounds.slice(0,-1).map((z,i)=>{
  const next=bounds[i+1],middle=i===0?-3:i===bounds.length-2?3:(z+next)/2,at=clamp(x(value(middle)));
  return `<text data-band-label x="${at}" y="350" font-size="26" text-anchor="middle" fill="#475569">${fmt(cumulative[i+1]-cumulative[i])}%</text>`;
 }).join(''):'';
 const ticks=Array.from({length:11},(_,i)=>tick(-2.5+i*.5)).join('');
 const grid=Array.from({length:11},(_,i)=>{const v=axisValue(-2.5+i*.5),at=x(v);return at>=62&&at<=838?`<line x1="${at}" y1="${y(v)}" x2="${at}" y2="270" stroke="#cbd5e1" stroke-width="1"/>`:'';}).join('');
 const point=s.pointZ===null?null:{x:clamp(x(value(s.pointZ))),y:y(value(s.pointZ)),hidden:s.hideZ!==null&&Math.abs(s.hideZ-s.pointZ)<1e-7};
 const distance=point&&s.pointZ!==null&&model.mode==='position'?`<g data-standard-distance><line x1="${x(s.mean)}" y1="55" x2="${point.x}" y2="55" stroke="#fa8231" stroke-width="6" stroke-linecap="round"/><line x1="${x(s.mean)}" y1="43" x2="${x(s.mean)}" y2="67" stroke="#b83d0b" stroke-width="2"/><line x1="${point.x}" y1="43" x2="${point.x}" y2="67" stroke="#b83d0b" stroke-width="2"/><text x="${(x(s.mean)+point.x)/2}" y="33" text-anchor="middle" font-size="28" fill="#b83d0b">${fmt(s.pointZ)} s</text></g>`:'';
 const axisSteps=model.mode==='axis'?Array.from({length:11},(_,i)=>{const z=-2.5+i*.5,at=x(value(z));return `<rect x="${at-23}" y="286" width="46" height="35" rx="6" fill="${s.hideZ===z?'#fff7ed':'#eff6ff'}" stroke="${s.hideZ===z?'#fa8231':'#cbd5e1'}"/>`;}).join(''):'';
 const marker=point?`<g data-point-z="${s.pointZ}"><line x1="${point.x}" y1="${Math.max(8,point.y)}" x2="${point.x}" y2="270" stroke="#b83d0b" stroke-width="3" stroke-dasharray="7 5"/><circle cx="${point.x}" cy="${Math.max(8,point.y)}" r="7" fill="#fa8231" stroke="white" stroke-width="3"/><text x="${point.x}" y="${Math.max(30,point.y-18)}" text-anchor="middle" font-size="25" fill="#b83d0b">${point.hidden?'?':fmt(value(s.pointZ!))}</text></g>`:'';
 const population=model.mode==='population'&&stage<2?Array.from({length:11},(_,i)=>{
  const counts=[1,2,4,7,10,12,10,7,4,2,1],at=x(base.mean+(i-5)*base.sd*.5);
  return Array.from({length:counts[i]},(_,r)=>`<g fill="${i<5?'#2563eb':i===5?'#fa8231':'#10b981'}" opacity="${stage===0?.9:.25}"><circle cx="${at}" cy="${258-r*16}" r="4.5"/><path d="M${at-4},${264-r*16}h8" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></g>`).join('');
 }).join(''):'';
 const curveVisible=model.mode!=='population'||stage>0;
 let formula=`\\mu=${mean},\\quad s=${sd}`;
 if(model.showProbability&&shaded&&percent!==null){
  const condition=s.lowerZ===-4&&s.upperZ===4?'-\\infty<X<\\infty':s.lowerZ===-4?`X<${fmt(value(s.upperZ!))}`:s.upperZ===4?`X>${fmt(value(s.lowerZ!))}`:`${fmt(value(s.lowerZ!))}<X<${fmt(value(s.upperZ!))}`;
  formula=`P(${condition})\\approx ${fmt(percent)}\\%`;
 }else if(point&&s.pointZ!==null){formula=point.hidden?`\\mu=${mean},\\quad s=${sd},\\quad z=${fmt(s.pointZ)}`:`x=${mean}+${fmt(s.pointZ)}\\cdot ${sd}=${fmt(value(s.pointZ))}`;}
 const caption=model.mode==='population'?'נקודות להמחשה: באזור המרכז מופיעים יותר ערכים.':model.mode==='axis'?`כל צעד על הציר הוא חצי סטיית תקן: ${fmt(s.sd/2)}. הממוצע ${mean} נשאר במרכז.`:model.mode==='spread'?`אותו מרכז: ${mean}. סטיית התקן כעת ${sd}; רוחב העקומה והגובה משתנים יחד.`:model.showProbability&&shaded&&percent===null?'הגבול אינו אחד מסימוני האחוזים בתרשים. אין כאן אחוז בית־ספרי נתון לגבול הזה.':`ממוצע ${mean} · סטיית תקן ${sd}${model.showProbability&&percent!==null?' · אחוזים לפי קירוב התרשים הבית־ספרי':''}`;
 const svg=`<svg viewBox="0 0 900 400" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="המחשת התפלגות: ממוצע ${mean}, סטיית תקן ${sd}" style="color:#1e293b;overflow:visible;font-family:Heebo,Arial,sans-serif" data-normal-svg><defs><clipPath id="${clip}"><rect x="${lower}" y="0" width="${Math.max(0,upper-lower)}" height="270"/></clipPath></defs>${grid}${curveVisible?`<polygon points="${area}" fill="#eff6ff"/>${shaded?`<polygon points="${area}" fill="#2563eb" opacity=".3" clip-path="url(#${clip})"/>`:''}<polyline points="${curve}" fill="none" stroke="#2563eb" stroke-width="4" stroke-linejoin="round"/>`:''}${population}${axisSteps}${distance}<line x1="52" y1="270" x2="848" y2="270" stroke="#475569" stroke-width="2"/><path d="M842,266L848,270L842,274" fill="none" stroke="#475569"/><line x1="${x(s.mean)}" y1="${Math.max(8,y(s.mean))}" x2="${x(s.mean)}" y2="270" stroke="#1e293b" stroke-width="2" stroke-dasharray="5 5"/>${ticks}${bandLabels}${marker}<text data-model-footer x="450" y="390" text-anchor="middle" font-size="20" fill="#475569">${model.mode==='population'?'מדגם להמחשה · אינו מקור לחישוב אחוזים':'כל השטח מייצג את הקבוצה כולה · 100%'}</text></svg>`;
 return {svg,formula,caption,percent};
}
