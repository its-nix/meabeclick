/** Reviewed illustration primitives, not model-authored SVG. Add a diagram with geometric and browser evidence. */
export const LABELLING_DIAGRAM_IDS=['right-triangle','cylinder'] as const;
const segment=(id:string,x1:number,y1:number,x2:number,y2:number,letter:string,tx:number,ty:number)=>`<g id="${id}" stroke="var(--text-primary)" stroke-width="4"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="transparent" stroke-width="26"/><text x="${tx}" y="${ty}" stroke="none" fill="var(--accent)" text-anchor="middle" font-size="24">${letter}</text></g>`;
function diagram(id:string){
 if(id==='right-triangle')return {svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 250"><title>משולש ישר זווית עם צלעות מסומנות a,b,c</title><path d="M80 172 H98 V190" fill="none" stroke="var(--border-strong)" stroke-width="2"/>${segment('leg-a',80,190,320,190,'a',200,222)}${segment('leg-b',80,190,80,50,'b',53,125)}${segment('hypotenuse',80,50,320,190,'c',225,105)}</svg>`,targets:[{id:'leg-a',label:'ניצב a'},{id:'leg-b',label:'ניצב b'},{id:'hypotenuse',label:'יתר c'}]};
 if(id==='cylinder')return {svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 260"><title>בסיס עגול וגליל סכמטי לזיהוי רדיוס קוטר וגובה</title><text x="120" y="28" text-anchor="middle" fill="var(--text-primary)" font-size="21">הבסיס במבט מלמעלה</text><circle cx="120" cy="125" r="75" fill="none" stroke="var(--accent)" stroke-width="3"/>${segment('base-diameter',120,50,120,200,'d',102,85)}${segment('base-radius',120,125,195,125,'r',160,110)}<circle cx="120" cy="125" r="4" fill="var(--accent)"/><text x="385" y="28" text-anchor="middle" fill="var(--text-primary)" font-size="21">גליל · תרשים סכמטי</text><path d="M315 60 V190 M455 60 V190" fill="none" stroke="var(--accent)" stroke-width="3"/><ellipse cx="385" cy="60" rx="70" ry="20" fill="none" stroke="var(--accent)" stroke-width="3"/><ellipse cx="385" cy="190" rx="70" ry="20" fill="none" stroke="var(--accent)" stroke-width="3"/>${segment('height',485,60,485,190,'h',512,132)}</svg>`,targets:[{id:'base-radius',label:'רדיוס r'},{id:'base-diameter',label:'קוטר d'},{id:'height',label:'גובה h'}]};
 return null;
}
export function canonicalLabelling(raw:unknown){
 if(!raw||typeof raw!=='object')return null;
 const r=raw as {diagram?:unknown;title?:unknown;subject?:unknown};
 if(typeof r.diagram!=='string'||typeof r.title!=='string'||typeof r.subject!=='string')return null;
 const d=diagram(r.diagram);return d?{diagram:r.diagram,title:r.title,subject:r.subject,...d}:null;
}
export function isCanonicalLabelling(raw:unknown):boolean{
 const expected=canonicalLabelling(raw);if(!expected)return false;
 const r=raw as {svg?:unknown;targets?:unknown};return r.svg===expected.svg&&JSON.stringify(r.targets)===JSON.stringify(expected.targets);
}
