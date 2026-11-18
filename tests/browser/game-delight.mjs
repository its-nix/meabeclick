/** Real-Chromium check of the game player's feedback motion: classes, aria, reduced motion. Set GAME_SHOTS=dir to save frame sequences. */
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright-core';
import {startServer} from '../characterization/harness.mjs';
const shots=process.env.GAME_SHOTS;if(shots)await mkdir(shots,{recursive:true});
const server=await startServer();
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN??(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':chromium.executablePath()),headless:true});
try{
 for(const reduced of [false,true]){
  const tag=reduced?'reduced':'motion';
  const context=await browser.newContext({viewport:{width:390,height:700},deviceScaleFactor:2,isMobile:true,hasTouch:true,locale:'he-IL',reducedMotion:reduced?'reduce':'no-preference'}),page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  const round=n=>page.locator(`[data-round="${n}"]`),click=(n,sel)=>round(n).locator(sel).click();
  const frames=async(name,times)=>{if(!shots)return;let at=0;for(const t of times){await page.waitForTimeout(t-at);at=t;await page.screenshot({path:join(shots,`${tag}-${name}-${t}ms.png`)});}};
  const result=(n,r)=>page.waitForFunction(([n,r])=>document.querySelector(`[data-round="${n}"] [data-task-feedback]`).dataset.result===r,[n,r]);
  await page.goto(server.baseUrl+'/sample-game');await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('[data-round="0"] [data-task-feedback]').getAttribute('aria-live'),'polite');
  // wrong
  await click(0,'[data-choice="1"]');await click(0,'[data-task-action="attempt"]');await result(0,'retry');
  assert.ok(await page.locator('[data-round="0"].game-round .task-card.flash-no').count(),'wrong flash class');assert.ok(await page.locator('[data-round="0"] .task-input.shake').count(),'shake class');
  assert.equal(await page.locator('[data-round="0"] .win-badge').count(),0,'no success badge on wrong');
  await frames('wrong',[60,160,320]);
  // correct
  await click(0,'[data-choice="0"]');await click(0,'[data-task-action="attempt"]');await result(0,'correct');
  assert.ok(await page.locator('[data-round="0"] .task-card.flash-ok').count());assert.ok(await page.locator('[data-round="0"] [data-choice].is-correct.pop .tick path').count(),'option check drawn');assert.ok(await page.locator('[data-round="0"] .win-badge .tick').count());assert.ok(await page.locator('[data-dot="0"].complete').count());
  assert.equal(await page.locator('[data-round="0"] [data-task-feedback]').getAttribute('aria-live'),'polite');
  await frames('correct',[60,160,320,500]);
  const anim=await page.evaluate(()=>getComputedStyle(document.querySelector('[data-round="0"] .is-correct')).animationName);
  assert.equal(anim==='none',reduced,`reduced-motion ${reduced}: option animation ${anim}`);
  assert.equal(await page.evaluate(()=>document.querySelectorAll('.fx-canvas').length),0,'no confetti mid-game on a single correct');
  await click(0,'[data-next-round]');await round(1).waitFor({state:'visible'});
  assert.equal(await page.locator('[data-round="1"].in-next').count(),reduced?0:1,'slide class');
  await frames('slide',[80,160,300]);
  // finish: use solutions through remaining rounds
  for(const n of [1,2,3]){await click(n,'[data-task-action="solution"]');await result(n,'help');await click(n,'[data-next-round]');if(n<3)await round(n+1).waitFor({state:'visible'});}
  await page.locator('[data-game-done]').waitFor({state:'visible'});
  assert.equal(await page.locator('.fx-canvas').count(),reduced?0:1,'confetti only with motion');
  await frames('done',[200,600,1000,1600]);
  await page.waitForTimeout(1700);
  assert.equal(await page.locator('.fx-canvas').count(),0,'canvas removed');
  const done=await page.evaluate(()=>({first:document.querySelector('[data-count-first]').textContent,assist:document.querySelector('[data-count-assist]').textContent,stars:document.querySelectorAll('.stars svg.on').length,label:document.querySelector('[data-game-done]').getAttribute('aria-label'),sh:document.documentElement.scrollHeight,vh:innerHeight}));
  assert.equal(done.first,'0');assert.equal(done.assist,'1');assert.equal(done.stars,1);assert.ok(done.label.includes('בעזרה'));assert.ok(done.sh<=done.vh,'completion fits');
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('Game delight: feedback motion, completion summary and reduced motion verified');
}finally{await browser.close();await server.stop();}
