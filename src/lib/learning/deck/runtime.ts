/** Trusted, self-contained client. Generated content supplies data, never code. */
export function mountVisualDeck(config:any,visual:any,rich:(element:Element,text:string)=>void){
 const $=(s:string,r:ParentNode=document)=>r.querySelector(s) as HTMLElement;
 const all=(s:string,r:ParentNode=document)=>Array.from(r.querySelectorAll(s)) as HTMLElement[];
 const bundle=config.bundle,slides=all('[data-slide]');
 const motion=!matchMedia('(prefers-reduced-motion: reduce)').matches;
 const models=new WeakMap<HTMLElement,any>();let current=0,build=0,round=0;
 function syncControls(node:HTMLElement,state:any){
  for(const input of all('[data-live-param]',node) as HTMLInputElement[]){const value=state[input.dataset.liveParam!];if(typeof value!=='number')continue;input.value=String(value);const out=input.parentElement?.querySelector('output');if(out)out.textContent=Number(input.value).toFixed(2).replace(/\.?0+$/,'');}
 }
 function paint(node:HTMLElement,stage=0,animate=false){
  const m=models.get(node);if(!m)return;m.stage=stage;m.seq++;
  const result=visual(m.model,stage,m.scope,m.override,m.comparison);
  const draw=(value:any)=>{$('.model-visual',node).innerHTML=value.svg;};
  const state={...m.model.states[Math.min(stage,m.model.states.length-1)],...m.override};
  syncControls(node,state);
  const old=m.last;m.last=state;
  if(animate&&motion&&old){const seq=m.seq,start=performance.now();const frame=(at:number)=>{if(m.seq!==seq)return;const t=Math.min(1,(at-start)/220),ease=1-(1-t)**3,intermediate:any={...state};for(const k of ['mean','sd','lowerZ','upperZ','pointZ'])if(typeof old[k]==='number'&&typeof state[k]==='number')intermediate[k]=old[k]+(state[k]-old[k])*ease;draw(visual(m.model,stage,m.scope,intermediate,m.comparison));if(t<1)requestAnimationFrame(frame);else draw(result);};requestAnimationFrame(frame);}else draw(result);
  rich($('.model-formula',node),'\\('+result.formula+'\\)');$('.model-caption',node).textContent=result.caption;
 }
 for(const node of all('[data-model]')){
  const model=JSON.parse(node.dataset.model!),scope=node.dataset.modelScope!;
  models.set(node,{model,scope,comparison:JSON.parse(node.dataset.modelComparison??'[]'),override:{},stage:0,last:null,seq:0});
  if(model.interactive!=='none'){
   const controls=document.createElement('div');controls.className='model-controls';node.append(controls);
   const slider=(name:string,label:string,min:number,max:number,step:number,value:number)=>{const wrap=document.createElement('label');const text=document.createElement('span');text.textContent=label;const input=document.createElement('input');input.type='range';input.min=String(min);input.max=String(max);input.step=String(step);input.value=String(value);input.setAttribute('aria-label',label);input.dataset.liveParam=name;const out=document.createElement('output');out.dir='ltr';out.textContent=String(value);input.addEventListener('input',()=>{const m=models.get(node);m.override[name]=Number(input.value);out.textContent=Number(input.value).toFixed(2).replace(/\.?0+$/,'');if(name==='upperZ'&&model.mode==='cumulative')m.override.lowerZ=-4;const l=m.override.lowerZ??model.states[0].lowerZ,u=m.override.upperZ??model.states[0].upperZ;if(l!==null&&u!==null&&l>=u){if(name==='lowerZ')m.override.upperZ=l+.5;else m.override.lowerZ=u-.5;}paint(node);});wrap.append(text,input,out);controls.append(wrap);};
   const s=model.states[0];
   if(model.interactive==='spread')slider('sd','משנים את סטיית התקן',s.sd*.65,s.sd*1.75,s.sd*.05,s.sd);
   if(model.interactive==='position')slider('pointZ','משנים את המיקום ביחידות סטיית תקן',-2.5,2.5,.25,s.pointZ??0);
   if(model.interactive==='region'){if(model.mode!=='cumulative')slider('lowerZ','גבול תחתון',-2.5,2,.5,s.lowerZ??-.5);slider('upperZ','גבול עליון',-2,2.5,.5,s.upperZ??.5);}
  }
  paint(node);
 }
 const maxBuild=(slide:HTMLElement)=>Math.max(0,...all('[data-reveal]',slide).map(b=>Number(b.dataset.reveal)+(models.get($('[data-model]',b))?.model.states.length??1)-1));
 function show(index:number,nextBuild=0){
  if(!slides.length)return;current=Math.max(0,Math.min(index,slides.length-1));build=Math.max(0,Math.min(nextBuild,maxBuild(slides[current])));
  slides.forEach((s,i)=>{s.hidden=i!==current;});const active=slides[current];
  for(const b of all('[data-reveal]',active)){b.hidden=Number(b.dataset.reveal)>build;for(const node of all('[data-model]',b))paint(node,Math.max(0,build-Number(b.dataset.reveal)),true);}
  const prev=$('[data-previous]') as HTMLButtonElement,next=$('[data-next]') as HTMLButtonElement;
  prev.disabled=current===0&&build===0;next.disabled=current===slides.length-1&&build===maxBuild(active);next.textContent=build<maxBuild(active)?'הצעד הבא ←':'לשקף הבא ←';
  $('[data-position]').textContent=`${current+1} / ${slides.length}${maxBuild(active)?' · שלב '+(build+1)+' מתוך '+(maxBuild(active)+1):''}`;
  $('[data-progress]').style.width=((current+1)/slides.length*100)+'%';
  const url=new URL(location.href);url.searchParams.set('slide',active.dataset.slide!);history.replaceState(null,'',url);
 }
 const next=()=>{if(!slides.length)return;if(build<maxBuild(slides[current]))show(current,build+1);else show(current+1);};
 const previous=()=>{if(build>0)show(current,build-1);else if(current>0)show(current-1,maxBuild(slides[current-1]));};
 if(slides.length){
  $('[data-next]').addEventListener('click',next);$('[data-previous]').addEventListener('click',previous);
  $('[data-replay]').addEventListener('click',()=>{for(const n of all('[data-model]',slides[current]))models.get(n).override={};show(current);});
  $('[data-fullscreen]').addEventListener('click',()=>{if(document.fullscreenElement)void document.exitFullscreen();else void document.documentElement.requestFullscreen().catch(()=>{});});
  for(const b of all('[data-go-slide]'))b.addEventListener('click',()=>{show(slides.findIndex(s=>s.dataset.slide===b.dataset.goSlide));const details=b.closest('details');if(details)details.open=false;window.scrollTo({top:0,behavior:'instant'});});
  addEventListener('keydown',e=>{if(e.target instanceof HTMLElement&&e.target.closest('input,select,textarea,button,dialog,[contenteditable]'))return;if(['ArrowLeft','PageDown',' '].includes(e.key)){e.preventDefault();next();}if(['ArrowRight','PageUp'].includes(e.key)){e.preventDefault();previous();}});
  const selected=new URL(location.href).searchParams.get('slide');show(Math.max(0,slides.findIndex(s=>s.dataset.slide===selected)));
 }
 for(const button of all('[data-source-open]'))button.addEventListener('click',()=>{const d=document.getElementById('source-'+button.dataset.sourceOpen) as HTMLDialogElement;d?.showModal();});
 for(const button of all('[data-close-source]'))button.addEventListener('click',()=>{(button.closest('dialog') as HTMLDialogElement).close();});
 for(const button of all('[data-print]'))button.addEventListener('click',()=>window.print());
 let printState:Map<HTMLElement,{stage:number;override:any}>|null=null;
 addEventListener('beforeprint',()=>{if(printState)return;printState=new Map();for(const node of all('[data-model]')){const m=models.get(node);printState.set(node,{stage:m.stage,override:{...m.override}});m.override={};paint(node,m.model.states.length-1);}});
 addEventListener('afterprint',()=>{if(!printState)return;for(const [node,saved]of printState){const m=models.get(node);m.override=saved.override;paint(node,saved.stage);}printState=null;});
 const taskList=[...bundle.tasks,...bundle.homework,...bundle.games.flatMap((g:any)=>g.rounds)];
 for(const article of all('[data-task]')){
  const task=taskList.find((t:any)=>t.id===article.dataset.task);let choice:number|null=null,pending=false;
  const feedback=$('[data-task-feedback]',article);
  for(const button of all('[data-choice]',article))button.addEventListener('click',()=>{choice=Number(button.dataset.choice);for(const b of all('[data-choice]',article))b.setAttribute('aria-pressed',String(b===button));});
  const selects=all('[data-region]',article) as HTMLSelectElement[];
  const updateRegion=()=>{if(selects.length!==2)return;const node=$('[data-model]',article);const m=models.get(node);m.override={lowerZ:selects[0].value===''?null:Number(selects[0].value),upperZ:selects[1].value===''?null:Number(selects[1].value)};if(m.override.lowerZ===null||m.override.upperZ===null||m.override.lowerZ>=m.override.upperZ)m.override={lowerZ:null,upperZ:null};paint(node);};
  selects.forEach(s=>s.addEventListener('change',updateRegion));
  if(selects.length){
   const container=$('.model-visual',article);let dragIndex:number|null=null;
   const point=(event:PointerEvent)=>{const svg=container.querySelector('svg')!;const matrix=svg.getScreenCTM();if(!matrix)return;const p=svg.createSVGPoint();p.x=event.clientX;p.y=event.clientY;const at=p.matrixTransform(matrix.inverse());const z=(at.x-62)/776*6.8-3.4;const value=z< -2.5?-4:z>2.5?4:Math.round(z*2)/2;
    if(dragIndex===null){if(selects[0].value==='')dragIndex=0;else if(selects[1].value==='')dragIndex=1;else dragIndex=Math.abs(Number(selects[0].value)-value)<Math.abs(Number(selects[1].value)-value)?0:1;}
    selects[dragIndex].value=String(value);if(selects.every(s=>s.value!=='')&&Number(selects[0].value)>Number(selects[1].value)){const a=selects[0].value;selects[0].value=selects[1].value;selects[1].value=a;dragIndex=1-dragIndex;}updateRegion();};
   container.addEventListener('pointerdown',e=>{dragIndex=null;container.setPointerCapture(e.pointerId);point(e);});container.addEventListener('pointermove',e=>{if(dragIndex!==null&&e.buttons)point(e);});container.addEventListener('pointerup',()=>{dragIndex=null;});container.addEventListener('pointercancel',()=>{dragIndex=null;});
  }
  const draft=$('textarea',article) as HTMLTextAreaElement|null;
  if(draft){const key='visual-draft:'+config.version+':'+task.id;try{draft.value=localStorage.getItem(key)??'';}catch{}draft.addEventListener('input',()=>{try{localStorage.setItem(key,draft.value);}catch{}});}
  for(const button of all('[data-task-action]',article))button.addEventListener('click',async()=>{
   if(pending)return;const action=button.dataset.taskAction!;
   const input=task.grading==='tutor-review'?draft?.value:task.check?.kind==='choice'?choice:task.check?.kind==='region'?selects.map(s=>s.value===''?null:Number(s.value)):($('[data-number]',article) as HTMLInputElement)?.value;
   if(action==='attempt'&&(input===null||input===''||Array.isArray(input)&&input.some(v=>v===null))){feedback.textContent='בחרו או הקלידו תשובה כדי לנסות.';return;}
   pending=true;for(const b of all('[data-task-action]',article))(b as HTMLButtonElement).disabled=true;
   try{const response=await fetch('/api/learning-pilot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:config.version,taskId:task.id,action,input,eventId:crypto.randomUUID()})});const result=await response.json();rich(feedback,result.error??result.message??'');feedback.dataset.result=result.correct===true?'correct':result.correct===false?'retry':'help';if(result.independent===true)feedback.append(document.createTextNode(' פתרתם בלי רמז או הסבר.'));if(result.correct===true)article.dataset.complete='true';}
   catch{feedback.textContent='החיבור לא הצליח. התשובה נשארה כאן; נסו שוב.';}
   finally{pending=false;for(const b of all('[data-task-action]',article))(b as HTMLButtonElement).disabled=false;}
  });
 }
 const rounds=all('[data-round]');
 const showRound=()=>{rounds.forEach((r,i)=>r.hidden=i!==round);const label=$('[data-game-position]');if(label)label.textContent=`סבב ${Math.min(round+1,rounds.length)} מתוך ${rounds.length}`;const button=$('[data-next-round]');if(button){button.textContent=round===rounds.length-1?'סיום המסלול ✓':'לסבב הבא ←';if(round>=rounds.length){button.hidden=true;label.textContent='סיימתם את המסלול. אפשר לחזור ולבדוק דרך אחרת.';}}};
 $('[data-next-round]')?.addEventListener('click',()=>{round++;showRound();});if(rounds.length)showRound();
}
