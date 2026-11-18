/** Trusted, self-contained client. Generated content supplies data, never code. */
export function mountVisualDeck(config:any,visual:any,rich:(element:Element,text:string)=>void){
 const $=(s:string,r:ParentNode=document)=>r.querySelector(s) as HTMLElement;
 const all=(s:string,r:ParentNode=document)=>Array.from(r.querySelectorAll(s)) as HTMLElement[];
 const bundle=config.bundle,slides=all('[data-slide]');
 const motion=!matchMedia('(prefers-reduced-motion: reduce)').matches;
 const models=new WeakMap<HTMLElement,any>();let current=0,build=0,round=0;
 function syncControls(node:HTMLElement,state:any){
  for(const input of all('[data-live-param]',node) as HTMLInputElement[]){const value=state[input.dataset.liveParam!];if(typeof value!=='number')continue;input.value=String(value);const out=input.parentElement?.querySelector('output');const tail=input.dataset.liveParam==='lowerZ'&&value===-4?'−∞':input.dataset.liveParam==='upperZ'&&value===4?'∞':null;const display=tail??Number(input.value).toFixed(2).replace(/\.?0+$/,'');if(out)out.textContent=display;input.setAttribute('aria-valuetext',tail?(value<0?'כל הזנב השמאלי':'כל הזנב הימני'):display);}
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
   if(model.interactive==='region'){if(model.mode!=='cumulative')slider('lowerZ','גבול תחתון',-4,3.5,.5,s.lowerZ??-.5);slider('upperZ','גבול עליון',-3.5,4,.5,s.upperZ??.5);}
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
 let markDots=()=>{};
 const stats:Record<string,{tries:number;helped:boolean;ok:boolean;first:boolean}>={};let streak=0,dir='';
 const restart=(el:Element,cls:string)=>{el.classList.remove(cls);void (el as HTMLElement).offsetWidth;el.classList.add(cls);};
 const tick='<svg class="tick" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path pathLength="1" d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
 const burst=(count:number,x:number,y:number,life:number,power:number)=>{
  if(!motion)return;const dpr=Math.min(devicePixelRatio||1,2),w=innerWidth,h=innerHeight,cv=document.createElement('canvas');
  cv.width=w*dpr;cv.height=h*dpr;cv.setAttribute('aria-hidden','true');cv.className='fx-canvas';document.body.appendChild(cv);
  const g=cv.getContext('2d');if(!g){cv.remove();return;}g.scale(dpr,dpr);
  const css=getComputedStyle(document.documentElement),cols=['--brand','--mint','--cta'].map(k=>css.getPropertyValue(k).trim()||'#2f6fed');
  const ps=Array.from({length:count},(_,i)=>{const a=-Math.PI/2+(Math.random()-.5)*Math.PI*1.3,v=(.4+Math.random())*power;return{x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,r:3+Math.random()*3,rot:Math.random()*6,vr:(Math.random()-.5)*.02,c:cols[i%cols.length]};});
  const t0=performance.now();let last=t0;
  const frame=(t:number)=>{const age=t-t0,dt=Math.min(t-last,32);last=t;g.clearRect(0,0,w,h);
   if(age>=life){cv.remove();return;}g.globalAlpha=Math.min(1,(life-age)/(life*.4));
   for(const p of ps){p.vy+=.0018*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.rot+=p.vr*dt;g.save();g.translate(p.x,p.y);g.rotate(p.rot);g.fillStyle=p.c;g.fillRect(-p.r,-p.r/2,p.r*2,p.r);g.restore();}
   requestAnimationFrame(frame);};
  requestAnimationFrame(frame);};
 const celebrate=(article:HTMLElement,first:boolean)=>{
  restart(article,'flash-ok');
  const picked=$('[data-choice][aria-pressed=true]',article);
  if(picked){picked.classList.remove('is-retry');picked.classList.add('is-correct');if(!picked.querySelector('.tick'))picked.insertAdjacentHTML('beforeend',tick);restart(picked,'pop');}
  if(!article.querySelector('.win-badge'))article.insertAdjacentHTML('afterbegin','<span class="win-badge" aria-hidden="true">'+tick+'</span>');
  if(first){streak++;if(streak>=3){const r=article.getBoundingClientRect();burst(16,r.left+r.width/2,r.top+40,560,.45);}}else streak=0;
 };
 const nudge=(article:HTMLElement)=>{streak=0;restart(article,'flash-no');const box=$('.task-input',article);if(box)restart(box,'shake');const picked=$('[data-choice][aria-pressed=true]',article);if(picked)picked.classList.add('is-retry');};
 const countUp=(el:HTMLElement|null,to:number,delay:number)=>{if(!el)return;if(!motion||!to){el.textContent=String(to);return;}el.textContent='0';const t0=performance.now()+delay;const step=(t:number)=>{const k=Math.min(1,Math.max(0,(t-t0)/700));el.textContent=String(Math.round(to*(1-Math.pow(1-k,3))));if(k<1)requestAnimationFrame(step);};requestAnimationFrame(step);};
 const summarize=(done:HTMLElement,total:number)=>{
  const v=Object.values(stats),first=v.filter(x=>x.ok&&x.first).length,assist=v.filter(x=>x.ok&&!x.first).length;
  const ratio=total?(first+assist*.5)/total:0,n=ratio>=.85?3:ratio>=.5?2:1;
  all('.stars svg',done).forEach((star,i)=>{star.classList.toggle('on',i<n);(star as unknown as SVGElement).style.setProperty('--i',String(i));});
  countUp($('[data-count-first]',done),first,300);countUp($('[data-count-assist]',done),assist,600);
  done.setAttribute('aria-label',`סיימתם! ${n} כוכבים. ${first} בניסיון ראשון, ${assist} בעזרה.`);
  const r=done.getBoundingClientRect();burst(30+n*25,r.left+r.width/2,r.top+r.height*.35,1500,.7);
 };
 const taskList=[...bundle.tasks,...bundle.homework,...bundle.games.flatMap((g:any)=>g.rounds)];
 for(const article of all('[data-task]')){
  const task=taskList.find((t:any)=>t.id===article.dataset.task);let choice:number|null=null,pending=false;stats[task.id]={tries:0,helped:false,ok:false,first:false};
  const feedback=$('[data-task-feedback]',article);
  for(const button of all('[data-choice]',article))button.addEventListener('click',()=>{choice=Number(button.dataset.choice);for(const b of all('[data-choice]',article)){b.setAttribute('aria-pressed',String(b===button));b.classList.remove('is-retry');}});
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
   try{const response=await fetch(config.actionUrl??'/api/learning-pilot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:config.version,taskId:task.id,action,input,eventId:crypto.randomUUID()})});const result=await response.json();rich(feedback,result.error??result.message??'');feedback.dataset.result=result.correct===true?'correct':result.correct===false?'retry':'help';const st=stats[task.id];if(action!=='attempt')st.helped=true;else if(typeof result.correct==='boolean')st.tries++;
    if(result.correct===true){const firstTry=st.tries===1&&!st.helped&&!st.ok;if(!st.ok)st.first=firstTry;st.ok=true;article.dataset.complete='true';markDots();if(document.querySelector('[data-game-done]'))celebrate(article,firstTry);}
    else if(result.correct===false)nudge(article);else if(action!=='attempt')streak=0;}
   catch{feedback.textContent='החיבור לא הצליח. התשובה נשארה כאן; נסו שוב.';}
   finally{pending=false;for(const b of all('[data-task-action]',article))(b as HTMLButtonElement).disabled=false;}
  });
 }
 const rounds=all('[data-round]'),done=$('[data-game-done]') as HTMLElement|null;
 const dots=all('[data-dot]');
 markDots=()=>{dots.forEach((d,i)=>{d.classList.toggle('current',i===round&&round<rounds.length);const was=d.classList.contains('complete'),now=rounds[i]?.querySelector('[data-task]')?.getAttribute('data-complete')==='true';d.classList.toggle('complete',now);if(now&&!was&&motion)restart(d,'pop');});};
 const showRound=(move=false)=>{
  const finished=round>=rounds.length;rounds.forEach((r,i)=>{r.hidden=finished||i!==round;r.classList.remove('in-next','in-prev');});if(done)done.hidden=!finished;
  if(move&&motion&&dir){const el=finished?done:rounds[round];if(el)restart(el,finished?'in-next':'in-'+dir);}
  if(finished&&move&&done)summarize(done,rounds.length);
  const at=Math.min(round+1,rounds.length),label=$('[data-game-position]'),count=$('[data-game-count]');
  if(label)label.setAttribute('aria-label',`שאלה ${at} מתוך ${rounds.length}`);if(count)count.textContent=`${at}/${rounds.length}`;markDots();
  if(move)(finished?done:(rounds[round]?.querySelector('h2') as HTMLElement|null))?.focus({preventScroll:true});
 };
 for(const b of all('[data-next-round]'))b.addEventListener('click',()=>{round=Math.min(round+1,rounds.length);dir='next';showRound(true);});
 for(const b of all('[data-prev-round]'))b.addEventListener('click',()=>{round=Math.max(round-1,0);dir='prev';showRound(true);});
 $('[data-game-restart]')?.addEventListener('click',()=>location.reload());
 if(rounds.length)showRound();
}
