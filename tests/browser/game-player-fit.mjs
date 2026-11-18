/** Real-Chromium check that every game question screen fits one phone viewport, with icon controls. Set GAME_SHOTS=dir to save screenshots. */
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright-core';
import {startServer} from '../characterization/harness.mjs';
import {visualDeckFixture} from '../visual-deck-fixture.mjs';
import {renderVisualDeck} from '../../src/lib/server/visual-deck-render.ts';
import {sampleBundle,SAMPLE_GAME_ID,SAMPLE_VERSION} from '../../src/lib/server/native-learning/public-sample.ts';
const shots=process.env.GAME_SHOTS;if(shots)await mkdir(shots,{recursive:true});
const server=await startServer();
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN??(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':chromium.executablePath()),headless:true});
const REMOVED=['תצוגת בדיקה','התרגול אינו רושם','השלמת המשחק','נרשם כעזרה','משימה משחקית','ארבע שאלות קצרות','נסו בעצמכם, ואם נתקעים','פיילוט חזותי','חומרי השיעור'];
try{
 for(const [width,height] of [[390,700],[360,640]]){
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:2,isMobile:true,hasTouch:true,locale:'he-IL'}),page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  const fits=async label=>{
   const m=await page.evaluate(()=>{const body=document.querySelector('.task-body'),actions=document.querySelector('.game-round:not([hidden]) .task-actions')??document.querySelector('.game-done .task-actions'),r=actions?.getBoundingClientRect();return{doc:document.documentElement.scrollHeight,vh:innerHeight,sw:document.documentElement.scrollWidth,vw:innerWidth,bodyOverflow:body&&!body.closest('[hidden]')?body.scrollHeight-body.clientHeight:0,actionsBottom:r?.bottom??0,small:[...document.querySelectorAll('button:not([hidden]),a.icon-btn')].filter(b=>b.offsetParent&&!b.disabled&&(b.getBoundingClientRect().width<44||b.getBoundingClientRect().height<44)).map(b=>b.outerHTML.slice(0,60))};});
   assert.ok(m.doc<=m.vh,`${width}x${height} ${label}: document ${m.doc} > viewport ${m.vh}`);assert.ok(m.sw<=m.vw,`${label}: horizontal overflow`);assert.ok(m.actionsBottom<=m.vh,`${label}: actions below the fold`);assert.ok(m.bodyOverflow<=1,`${label}: question content scrolls (${m.bodyOverflow}px)`);assert.deepEqual(m.small,[],`${label}: tap targets under 44px`);
  };
  const shot=async name=>{await fits(name);if(shots)await page.screenshot({path:join(shots,`${name}-${width}x${height}.png`)});};
  const round=n=>page.locator(`[data-round="${n}"]`),fb=n=>round(n).locator('[data-task-feedback]');
  const click=(n,sel)=>round(n).locator(sel).click();
  // public sample
  await page.goto(server.baseUrl+'/sample-game');await page.evaluate(()=>document.fonts.ready);
  const text=await page.evaluate(()=>document.body.innerText);for(const gone of REMOVED)assert.ok(!text.includes(gone),'removed copy: '+gone);
  for(const [sel,label] of [['[data-round="0"] [data-prev-round]','לשאלה הקודמת'],['[data-round="0"] [data-next-round]','לשאלה הבאה'],['[data-round="0"] [data-task-action="hint"]','רמז'],['[data-round="0"] [data-task-action="solution"]','הצגת הפתרון'],['[data-round="0"] [data-task-action="attempt"]','בדיקת התשובה']])assert.equal(await page.locator(sel).getAttribute('aria-label'),label);
  assert.equal(await page.locator('[data-round="0"] [data-prev-round]').isDisabled(),true,'no previous on the first question');
  const box=async sel=>(await page.locator(sel).boundingBox());
  const nb=await box('[data-round="0"] [data-next-round]'),pb=await box('[data-round="0"] [data-prev-round]');assert.ok(nb.x<pb.x,'RTL: next sits left of previous');
  assert.ok(await page.locator('[data-round="0"] [data-next-round] path[d^="m12 19"]').count(),'next arrow points left');assert.ok(await page.locator('[data-round="0"] [data-prev-round] path[d^="M5 12h14"]').count(),'previous arrow points right');
  await shot('01-choice');
  await click(0,'[data-choice="1"]');await click(0,'[data-task-action="attempt"]');await fb(0).filter({hasText:/\S/}).waitFor();assert.equal(await fb(0).getAttribute('data-result'),'retry');await shot('02-choice-wrong');
  await click(0,'[data-task-action="hint"]');await page.waitForFunction(()=>document.querySelector('[data-round="0"] [data-task-feedback]').dataset.result==='help');await shot('03-hint');
  await click(0,'[data-choice="0"]');await click(0,'[data-task-action="attempt"]');await page.waitForFunction(()=>document.querySelector('[data-round="0"] [data-task-feedback]').dataset.result==='correct');await shot('04-choice-right');
  await click(0,'[data-next-round]');await round(1).waitFor({state:'visible'});assert.equal(await page.locator('[data-game-position]').getAttribute('aria-label'),'שאלה 2 מתוך 4');
  await click(1,'[data-prev-round]');await round(0).waitFor({state:'visible'});await click(0,'[data-next-round]');
  await click(1,'[data-next-round]');await shot('05-number');
  await round(2).locator('[data-number]').fill('4');await click(2,'[data-task-action="attempt"]');await page.waitForFunction(()=>document.querySelector('[data-round="2"] [data-task-feedback]').dataset.result==='retry');await shot('06-number-wrong');
  await round(2).locator('[data-number]').fill('3');await click(2,'[data-task-action="attempt"]');await page.waitForFunction(()=>document.querySelector('[data-round="2"] [data-task-feedback]').dataset.result==='correct');await shot('07-number-right');
  await click(2,'[data-task-action="solution"]');await page.waitForFunction(()=>/\S/.test(document.querySelector('[data-round="2"] [data-task-feedback]').textContent));await shot('08-solution');
  await click(2,'[data-next-round]');await shot('09-open-ended-last');assert.equal(await page.locator('[data-round="3"] [data-next-round]').getAttribute('aria-label'),'סיום');
  await round(3).locator('textarea').fill('המספר 3 מזיז את הפרבולה ימינה');await click(3,'[data-task-action="attempt"]');await fb(3).filter({hasText:/\S/}).waitFor();await shot('10-open-ended-sent');
  await click(3,'[data-next-round]');await page.locator('[data-game-done]').waitFor({state:'visible'});await shot('11-done');
  assert.deepEqual(errors,[]);
  // student player chrome, graded by the sample session
  await page.route('**/student-player',r=>r.fulfill({contentType:'text/html',body:renderVisualDeck(sampleBundle(),{view:'game',gameId:SAMPLE_GAME_ID,baseUrl:'/app/student/games',actionUrl:'/api/sample-game',version:SAMPLE_VERSION,activitiesOnly:true,studentPlayer:true})}));
  await page.goto(server.baseUrl+'/student-player');await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('.top-back').getAttribute('aria-label'),'חזרה למשחקים');
  await click(0,'[data-choice="0"]');await click(0,'[data-task-action="attempt"]');await page.waitForFunction(()=>document.querySelector('[data-round="0"] [data-task-feedback]').dataset.result==='correct');await shot('12-student-player');
  // a game with a graph model (tutor review chrome keeps its menu)
  await page.route('**/review-game',r=>r.fulfill({contentType:'text/html',body:renderVisualDeck(visualDeckFixture(),{view:'game',gameId:visualDeckFixture().games[0].id,baseUrl:'/review',actionUrl:'/api/none',version:'v',activitiesOnly:true})}));
  await page.goto(server.baseUrl+'/review-game');await page.evaluate(()=>document.fonts.ready);
  assert.ok(await page.locator('.material-menu').count(),'review chrome kept');
  {const t=await page.evaluate(()=>document.body.innerText);for(const gone of ['התרגול אינו רושם','השלמת המשחק'])assert.ok(!t.includes(gone));}
  const rounds=await page.locator('[data-round]').count();for(let i=0;i<rounds;i++){await shot(`13-review-model-${i}`);if(i<rounds-1)await click(i,'[data-next-round]');}
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('Game player: every question fits 390x700 and 360x640 with icon controls');
}finally{await browser.close();await server.stop();}
