/** Actual isolated student-player states. No server, credentials or customer persistence. */
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir,mkdtemp,readFile,writeFile,realpath,stat,chmod} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import sharp from 'sharp';
import {chromium,type Browser,type BrowserContext,type Locator,type Page} from 'playwright-core';
import {renderVisualDeck} from '../visual-deck-render.ts';
import {isolatedPreviewGrader} from '../visual-pilot.ts';
import {type DeckTask,type VisualLesson} from '../../learning/deck/model.ts';
import {BRAND_LOGO_SRC} from '../../brand.ts';
import type {ReviewImage} from './validation.ts';

const ORIGIN='https://render.invalid',PLAYER='/app/preview',ACTION='/api/preview-action';
const VIEWPORTS=[{width:1280,height:1000},{width:390,height:900}];
const MAX_FRAMES=180,PER_PAGE=6;
function fail(kind:string):never{throw Object.assign(Error(kind),{kind});}
const digest=(b:string|Buffer)=>createHash('sha256').update(b).digest('hex');
export interface StudentEvidenceTarget {task:DeckTask;surface:'lesson'|'homework'|'game';slideId?:string;gameId?:string;roundIndex?:number;states:string[]}
interface Frame {label:string;file:string;width:number;height:number;taskId?:string;state:string;viewport:number;surface:string}
export interface StudentEvidenceDependencies {launch?:()=>Promise<Browser>;staticRoot?:string}
export function studentEvidencePlan(bundle:VisualLesson):StudentEvidenceTarget[]{
 if(!bundle||!Array.isArray(bundle.tasks)||!Array.isArray(bundle.homework)||!Array.isArray(bundle.games)||bundle.tasks.length>12||bundle.homework.length>6||bundle.games.length>2)fail('native_player_input');
 const targets:StudentEvidenceTarget[]=[];const states=(t:DeckTask)=>t.grading==='tutor-review'?['initial','tutor-attempt','hint','solution']:['initial','incorrect','hint','correct-assisted','solution'];
 for(const task of bundle.tasks){const slide=bundle.slides.find(s=>s.taskId===task.id);if(!slide)fail('native_player_missing_task');targets.push({task,surface:'lesson',slideId:slide.id,states:states(task)});}
 for(const task of bundle.homework)targets.push({task,surface:'homework',states:states(task)});
 for(const game of bundle.games){if(!Array.isArray(game.rounds)||game.rounds.length>8)fail('native_player_input');game.rounds.forEach((task,roundIndex)=>targets.push({task,surface:'game',gameId:game.id,roundIndex,states:states(task)}));}
 if(!targets.length||new Set(targets.map(t=>t.task.id)).size!==targets.length||targets.some(t=>!/^[-a-z0-9]{1,80}$/.test(t.task.id)))fail('native_player_input');
 const kinds=new Set(bundle.slides.flatMap(s=>s.blocks.flatMap(b=>b.model&&b.model.interactive!=='none'?[b.model.interactive]:[])));
 if(targets.reduce((n,t)=>n+t.states.length,0)*VIEWPORTS.length+kinds.size*2*VIEWPORTS.length+bundle.games.length*VIEWPORTS.length>MAX_FRAMES)fail('native_player_evidence_limit');
 return targets;
}
/** No key is supplied to the page; only this memory-side helper chooses test inputs. */
export function studentEvidenceAnswer(task:DeckTask,correct:boolean):string|number|number[]{
 if(task.grading==='tutor-review')return 'אני משווה בין הנתונים ומנסה להסביר את הדרך שלי.';
 const c=task.check;if(!c)fail('native_player_input');
 if(c.kind==='number'){if(typeof c.answer!=='number'||!Number.isFinite(c.answer))fail('native_player_input');return String(correct?c.answer:c.answer+Math.max(1,Math.abs(c.answer)*.1));}
 if(c.kind==='choice'){if(typeof c.answer!=='number'||c.options.length<2)fail('native_player_input');return correct?c.answer:(c.answer+1)%c.options.length;}
 if(c.kind==='region'){if(!Array.isArray(c.answer)||c.answer.length!==2)fail('native_player_input');if(correct)return [...c.answer];return c.answer[0]===-4&&c.answer[1]===4?[-.5,.5]:[-4,4];}
 return fail('native_player_input');
}
/** Only vendor learning assets and the established logo can be served, never file URLs or traversal. */
export async function studentEvidenceAsset(url:string,staticRoot:string):Promise<{body:Buffer;contentType:string}|null>{
 let parsed:URL;try{parsed=new URL(url);}catch{return null;}
 if(parsed.origin!==ORIGIN||parsed.username||parsed.password)return null;
 const name=parsed.pathname,logo=BRAND_LOGO_SRC.split('?')[0];
 if(!/^[A-Za-z0-9_./-]+$/.test(name)||name.split('/').some(s=>s==='.'||s==='..')||!(name===logo||/^\/learning-assets\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:css|js|woff2?|ttf)$/.test(name)))return null;
 try{const root=await realpath(staticRoot),file=await realpath(path.join(root,name));if(!file.startsWith(root+path.sep))return null;const info=await stat(file);if(!info.isFile()||info.size>4*1024*1024)return null;const body=await readFile(file);if(body.length!==info.size)return null;
  const type:Record<string,string>={'.css':'text/css','.js':'application/javascript','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};return{body,contentType:type[path.extname(file)]??'application/octet-stream'};
 }catch{return null;}
}
function executable(){if(process.env.CHROME_BIN)return process.env.CHROME_BIN;const local='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';if(process.platform==='darwin'&&existsSync(local))return local;if(existsSync('/usr/bin/chromium'))return'/usr/bin/chromium';return chromium.executablePath();}
async function launch(){return chromium.launch({executablePath:executable(),headless:true,env:{PATH:process.env.PATH??'/usr/bin:/bin',HOME:process.env.HOME??tmpdir(),TMPDIR:tmpdir(),LANG:'C.UTF-8'},args:['--disable-background-networking','--disable-component-update','--disable-default-apps','--disable-sync','--no-first-run','--no-default-browser-check','--metrics-recording-only','--disable-features=MediaRouter,OptimizationHints,AutofillServerCommunication']});}
async function healthy(page:Page,article?:Locator){
 if(await page.locator('.katex-error,[data-math-error]').count())fail('native_player_math');
 const horizontal=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth}));
 const vertical=article?await article.evaluate(e=>{const box=e.getBoundingClientRect(),slide=e.closest('.slide');if(!slide||getComputedStyle(slide).overflow==='visible')return null;const parent=slide.getBoundingClientRect();return{clipped:box.bottom>parent.bottom+2||box.top<parent.top-2,card:{top:box.top,bottom:box.bottom},slide:{top:parent.top,bottom:parent.bottom}};}):null;
 if(horizontal.scrollWidth>horizontal.viewport+2||vertical?.clipped){const screenshot=await page.screenshot({fullPage:true}).catch(()=>undefined);throw Object.assign(Error('native_player_layout'),{kind:'native_player_layout',details:{horizontal,vertical},screenshot});}
}
async function initialSafety(page:Page,article:Locator,task:DeckTask){
 const config=await page.locator('#deck-config').textContent();if(!config)fail('native_player_runtime');
 const data=JSON.parse(config).bundle;const all=[...data.tasks,...data.homework,...data.games.flatMap((g:any)=>g.rounds)];
 if(all.some((t:any)=>Object.hasOwn(t,'solution')||Object.hasOwn(t,'hints')||t.check&&Object.hasOwn(t.check,'answer'))||data.slides.some((s:any)=>Object.hasOwn(s,'presenterNotes')))fail('native_player_privacy');
 if(await page.locator('.teacher-answer,.notes-card').count()||await article.locator('[data-task-feedback]').innerText()||await article.locator('[data-live-param]').count())fail('native_player_privacy');
 if(await article.locator('[data-number]').count()&&await article.locator('[data-number]').inputValue()!==''||await article.locator('[data-choice][aria-pressed="true"]').count())fail('native_player_privacy');
 if(await article.locator('[data-region]').count()&&(await article.locator('[data-region]').evaluateAll(es=>es.some(e=>(e as HTMLSelectElement).value!==''))))fail('native_player_privacy');
 if(task.model&&(task.model.showProbability||task.model.interactive!=='none'))fail('native_player_privacy');
 await healthy(page,article);
}
async function input(page:Page,article:Locator,task:DeckTask,correct:boolean,pointer=false){
 const answer=studentEvidenceAnswer(task,correct);
 if(task.grading==='tutor-review'){await article.locator('textarea').fill(String(answer));return;}
 if(task.check!.kind==='number'){await article.locator('[data-number]').fill(String(answer));return;}
 if(task.check!.kind==='choice'){await article.locator('[data-choice]').nth(Number(answer)).click();return;}
 const values=answer as number[];if(pointer){
  await article.locator('[data-region="lower"]').selectOption('');await article.locator('[data-region="upper"]').selectOption('');const svg=article.locator('[data-region-model] svg');await svg.scrollIntoViewIfNeeded();
  for(const z of values){const at=await svg.evaluate((node,z)=>{const svg=node as SVGSVGElement,matrix=svg.getScreenCTM();if(!matrix)throw Error('Missing SVG matrix');const p=svg.createSVGPoint();p.x=62+((z===-4?-3.2:z===4?3.2:z)+3.4)/6.8*776;p.y=180;const v=p.matrixTransform(matrix);return{x:v.x,y:v.y};},z);await page.mouse.click(at.x,at.y);}
 }else{await article.locator('[data-region="lower"]').selectOption(String(values[0]));await article.locator('[data-region="upper"]').selectOption(String(values[1]));}
 const actual=await article.locator('[data-region]').evaluateAll(es=>es.map(e=>Number((e as HTMLSelectElement).value)));if(JSON.stringify(actual)!==JSON.stringify(values))fail('native_player_controls');
}
async function action(article:Locator,kind:string,result:string){
 const page=article.page(),taskId=await article.getAttribute('data-task');const response=page.waitForResponse(r=>r.url()===ORIGIN+ACTION&&r.request().method()==='POST'&&r.request().postDataJSON()?.taskId===taskId&&r.request().postDataJSON()?.action===kind);
 await article.locator(`[data-task-action="${kind}"]`).click();await response;await article.locator('[data-task-action]:disabled').first().waitFor({state:'hidden'});await article.locator(`[data-task-feedback][data-result="${result}"]`).waitFor({state:'visible'});
}
const xml=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
async function contacts(frames:Frame[],directory:string):Promise<ReviewImage[]>{
 const images:ReviewImage[]=[];
 for(let offset=0;offset<frames.length;offset+=PER_PAGE){const group=frames.slice(offset,offset+PER_PAGE),tiles:Array<{bytes:Buffer;width:number;height:number}>=[];
  for(const frame of group){const source=await readFile(frame.file),width=Math.min(640,frame.width);const value=await sharp(source).resize({width,withoutEnlargement:true}).png().toBuffer({resolveWithObject:true});tiles.push({bytes:value.data,width:value.info.width,height:value.info.height});}
  const heights=Array.from({length:Math.ceil(group.length/2)},(_,row)=>Math.max(...tiles.slice(row*2,row*2+2).map(t=>t.height))+55);const height=heights.reduce((a,b)=>a+b,0);if(height>12000||height*1280>20000000)fail('native_player_evidence_limit');
  const layers:Array<{input:Buffer;left:number;top:number}>=[];let y=0;const labels:string[]=[];
  for(const [i,frame]of group.entries()){const row=Math.floor(i/2),col=i%2,top=heights.slice(0,row).reduce((a,b)=>a+b,0);layers.push({input:tiles[i].bytes,left:col*640+Math.floor((640-tiles[i].width)/2),top:top+50});labels.push(`<text x="${col*640+12}" y="${top+20}" font-family="Arial" font-size="17" fill="#172a3a">${xml(frame.label)}</text><text x="${col*640+12}" y="${top+40}" font-family="Arial" font-size="15" fill="#475569">${xml(frame.surface+' / '+frame.state+' / '+frame.viewport+'px')}</text>`);y=top;}
  void y;layers.push({input:Buffer.from(`<svg width="1280" height="${height}">${labels.join('')}</svg>`),left:0,top:0});
  const bytes=await sharp({create:{width:1280,height,channels:3,background:'#e2e8f0'}}).composite(layers).png({palette:true,colors:192,compressionLevel:9}).toBuffer();if(bytes.length>8*1024*1024)fail('native_player_evidence_limit');
  const name=`student-player-${String(images.length+1).padStart(3,'0')}.png`,file=path.join(directory,name);await writeFile(file,bytes,{mode:0o600});images.push({name,path:file,sha256:digest(bytes)});
 }
 if(images.length>30)fail('native_player_evidence_limit');return images;
}
export async function renderStudentEvidence(bundle:VisualLesson,directory:string,deps:StudentEvidenceDependencies={}):Promise<ReviewImage[]>{
 if(!path.isAbsolute(directory))fail('native_player_input');const plan=studentEvidencePlan(bundle);await mkdir(directory,{recursive:true,mode:0o700});await chmod(directory,0o700);const output=await mkdtemp(path.join(directory,'student-player-'));await chmod(output,0o700);
 const grader=isolatedPreviewGrader();
 const version=digest(JSON.stringify(bundle)),frames:Frame[]=[],blocked:string[]=[],runtimeErrors:string[]=[];let browser:Browser|undefined;let failure:string|undefined;let failureDetails:unknown;let cursor:{taskId?:string;state:string;surface:string;viewport:number}|undefined;
 async function capture(page:Page,element:Locator,label:string,state:string,surface:string,viewport:number,taskId?:string){
  cursor={state,surface,viewport,...(taskId?{taskId}:{})};await healthy(page,taskId?element:undefined);const file=path.join(output,`raw-${String(frames.length+1).padStart(3,'0')}.png`);await element.screenshot({path:file,animations:'disabled',timeout:15000});await chmod(file,0o600);const info=await sharp(file).metadata();if(!info.width||!info.height||info.width*info.height>20000000)fail('native_player_evidence_limit');frames.push({label,file,width:info.width,height:info.height,state,surface,viewport,...(taskId?{taskId}:{})});if(frames.length>MAX_FRAMES)fail('native_player_evidence_limit');
 }
 try{
  browser=await(deps.launch??launch)();
  for(const viewport of VIEWPORTS){const context:BrowserContext=await browser.newContext({viewport,reducedMotion:'reduce',serviceWorkers:'block',locale:'he-IL'});let session=grader.create(version);const taskById=new Map(plan.map(p=>[p.task.id,p.task]));
   try{
    await context.routeWebSocket('**/*',socket=>socket.close({code:1008,reason:'Isolated review'}));
    await context.route('**/*',async route=>{
     const request=route.request();let url:URL;try{url=new URL(request.url());}catch{return route.abort();}
     if(url.origin===ORIGIN&&url.pathname===PLAYER&&request.method()==='GET'){
      const view=url.searchParams.get('view')??'lesson';if(!['lesson','homework','game'].includes(view))return route.fulfill({status:404,body:''});session=grader.create(version);
      return route.fulfill({contentType:'text/html',headers:{'Content-Security-Policy':"default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'"},body:renderVisualDeck(bundle,{view:view as 'lesson'|'homework'|'game',gameId:url.searchParams.get('game')??undefined,baseUrl:PLAYER,actionUrl:ACTION,version,activitiesOnly:true})});
     }
     if(url.origin===ORIGIN&&url.pathname===ACTION&&request.method()==='POST'){
      try{const body=request.postData();if(!body||body.length>6000)throw Error();const d=JSON.parse(body),task=taskById.get(d.taskId);if(!task||d.version!==version)throw Error();return route.fulfill({json:grader.action(session,version,task,d.action,d.input,d.eventId)});}catch{return route.fulfill({status:409,json:{error:'נסו קודם בעצמכם.'}});}
     }
     if(request.method()==='GET'){const asset=await studentEvidenceAsset(request.url(),deps.staticRoot??path.join(process.cwd(),'static'));if(asset)return route.fulfill(asset);}
     blocked.push(url.origin+url.pathname);return route.abort();
    });
    const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',()=>runtimeErrors.push('student-runtime-error'));let previous='',pointerUsed=false;
    for(const target of plan){
     const query=target.surface==='lesson'?`?view=lesson&slide=${target.slideId}`:target.surface==='game'?`?view=game&game=${target.gameId}`:'?view=homework';
     if(query!==previous){await page.goto(ORIGIN+PLAYER+query,{waitUntil:'networkidle'});await page.evaluate(()=>document.fonts.ready);previous=query;}else if(target.surface==='game')await page.locator('[data-next-round]').click();
     const article=page.locator(`[data-task="${target.task.id}"]:visible`);await article.waitFor();cursor={taskId:target.task.id,state:'initial',surface:target.surface,viewport:viewport.width};await initialSafety(page,article,target.task);const label=`${target.surface} ${target.task.id}`,surface=target.surface==='game'?page.locator('main.activities-page'):article;
     await capture(page,surface,label,'initial',target.surface,viewport.width,target.task.id);
     await action(article,'solution','help');if((await article.locator('[data-task-feedback]').innerText())!=='נסו קודם בעצמכם.')fail('native_player_privacy');
     await input(page,article,target.task,false);await action(article,'attempt','retry');await capture(page,surface,label,target.task.grading==='tutor-review'?'tutor-attempt':'incorrect',target.surface,viewport.width,target.task.id);
     await action(article,'hint','help');await capture(page,surface,label,'hint',target.surface,viewport.width,target.task.id);
     if(target.task.grading==='checked'){const pointer=target.task.check?.kind==='region'&&!pointerUsed;await input(page,article,target.task,true,pointer);if(pointer)pointerUsed=true;await action(article,'attempt','correct');await capture(page,surface,label,'correct-assisted',target.surface,viewport.width,target.task.id);}
     await action(article,'solution','help');await capture(page,surface,label,'solution',target.surface,viewport.width,target.task.id);
     if(target.surface==='game'){const game=bundle.games.find(g=>g.id===target.gameId)!;if(target.roundIndex===game.rounds.length-1){await page.locator('[data-next-round]').click();if(!(await page.locator('[data-game-position]').innerText()).includes('סיימתם'))fail('native_player_controls');await capture(page,page.locator('main'),`game ${game.id}`,'completed',target.surface,viewport.width);}}
    }
    const live=new Map<string,{slideId:string;modelIndex:number}>();for(const slide of bundle.slides){let modelIndex=0;for(const block of slide.blocks){if(block.model){if(block.model.interactive!=='none'&&!live.has(block.model.interactive))live.set(block.model.interactive,{slideId:slide.id,modelIndex});modelIndex++;}}}
    for(const[kind,item]of live){await page.goto(`${ORIGIN}${PLAYER}?view=lesson&slide=${item.slideId}`,{waitUntil:'networkidle'});await page.evaluate(()=>document.fonts.ready);const slide=bundle.slides.find(s=>s.id===item.slideId)!;const max=Math.max(0,...slide.blocks.map(b=>b.reveal+(b.model?.states.length??1)-1));for(let i=0;i<max;i++)await page.locator('[data-next]').click();const active=page.locator('[data-slide]:visible'),model=active.locator('[data-model]').nth(item.modelIndex),control=model.locator('[data-live-param]').first();await control.waitFor({state:'visible'});await capture(page,model,`interaction ${kind}`,'initial','exploration',viewport.width);const old=await model.locator('svg').evaluate(e=>e.outerHTML);await control.evaluate(e=>{const input=e as HTMLInputElement;input.value=input.value===input.max?input.min:input.max;input.dispatchEvent(new Event('input',{bubbles:true}));});if(await model.locator('svg').evaluate(e=>e.outerHTML)===old)fail('native_player_controls');await capture(page,model,`interaction ${kind}`,'changed','exploration',viewport.width);}
    if(runtimeErrors.length)fail('native_player_runtime');
   }finally{await context.close();}
  }
  const images=await contacts(frames,output);if(!images.length)fail('native_player_evidence');return images;
 }catch(error){failure=typeof(error as {kind?:unknown})?.kind==='string'?(error as {kind:string}).kind:'native_player_runtime';failureDetails=(error as {details?:unknown})?.details;if(Buffer.isBuffer((error as {screenshot?:unknown})?.screenshot))await writeFile(path.join(output,'failure.png'),(error as {screenshot:Buffer}).screenshot,{mode:0o600});throw Object.assign(Error(failure),{kind:failure,meta:cursor});
 }finally{
  await browser?.close();await writeFile(path.join(output,'report.json'),JSON.stringify({version:1,sourceVersion:version,storage:'memory-only previewAction; all network intercepted',states:frames.map(({file,...f})=>({...f,rawFile:path.basename(file)})),blockedRequests:blocked,runtimeErrors,...(failure?{failure,failureDetails,meta:cursor}:{})},null,2)+'\n',{mode:0o600});
 }
}
