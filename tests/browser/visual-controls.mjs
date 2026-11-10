import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {startServer} from '../characterization/harness.mjs';
import {visualDeckFixture} from '../visual-deck-fixture.mjs';
import {renderVisualDeck} from '../../src/lib/server/visual-deck-render.ts';
const server=await startServer(),browser=await chromium.launch({executablePath:process.env.CHROME_BIN??(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':chromium.executablePath()),headless:true});
try{
 const page=await browser.newPage({reducedMotion:'reduce'}),bundle=visualDeckFixture();
 const staged=bundle.slides[2].blocks[0].model;staged.mode='population';staged.interactive='none';staged.states=[staged.states[0],structuredClone(staged.states[0]),structuredClone(staged.states[0])];
 await page.route('**/visual-controls',r=>r.fulfill({contentType:'text/html',body:renderVisualDeck(bundle,{view:'lesson'})}));
 await page.goto(server.baseUrl+'/visual-controls');
 await page.evaluate(()=>document.fonts.ready);
 const model=page.locator('[data-slide]:visible [data-model]').first(),lower=model.locator('[data-live-param="lowerZ"]'),upper=model.locator('[data-live-param="upperZ"]');
 const move=(input,value)=>input.evaluate((el,value)=>{el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));},value);
 const values=()=>model.locator('[data-live-param]').evaluateAll(es=>es.map(e=>({value:Number(e.value),output:Number(e.parentElement.querySelector('output').textContent)})));
 const bands=await model.locator('[data-band-label]').evaluateAll(es=>es.map(e=>e.getBoundingClientRect()).map(r=>({x:r.x,right:r.right})).sort((a,b)=>a.x-b.x));for(let i=1;i<bands.length;i++)assert.ok(bands[i].x>=bands[i-1].right+1,'adjacent percentage labels remain distinct');
 await move(lower,1);assert.deepEqual(await values(),[{value:1,output:1},{value:1.5,output:1.5}],'crossing bounds synchronizes both controls');
 await page.locator('[data-replay]').click();assert.deepEqual(await values(),[{value:-.5,output:-.5},{value:.5,output:.5}],'replay synchronizes controls');
 await move(upper,2);const before=await model.locator('svg').evaluate(e=>e.outerHTML);await page.evaluate(()=>{dispatchEvent(new Event('beforeprint'));dispatchEvent(new Event('afterprint'));});
 assert.equal(await model.locator('svg').evaluate(e=>e.outerHTML),before,'returning from print restores live state');assert.deepEqual(await values(),[{value:-.5,output:-.5},{value:2,output:2}]);
 await page.locator('[data-go-slide]').nth(2).evaluate(e=>e.click());const population=page.locator('[data-slide]:visible svg'),initial=await population.evaluate(e=>e.outerHTML);await page.evaluate(()=>{dispatchEvent(new Event('beforeprint'));dispatchEvent(new Event('afterprint'));});assert.equal(await population.evaluate(e=>e.outerHTML),initial,'print does not advance a staged teaching model');
 await page.locator('[data-go-slide]').first().evaluate(e=>e.click());await move(lower,0);await move(upper,4);assert.equal(await upper.inputValue(),'4','live model reaches the whole right tail');assert.equal(await upper.locator('..').locator('output').textContent(),'∞');assert.match(await model.locator('.model-formula').textContent(),/50/);
 await page.locator('[data-go-slide]').nth(1).evaluate(e=>e.click());const spread=page.locator('[data-slide]:visible [data-model]'),sd=spread.locator('[data-live-param="sd"]'),ticks=()=>spread.locator('[data-z-tick] text').allTextContents(),fixedTicks=await ticks();
 for(const end of ['min','max']){await sd.evaluate((e,end)=>{e.value=e[end];e.dispatchEvent(new Event('input',{bubbles:true}));},end);assert.deepEqual(await ticks(),fixedTicks,'spread changes retain a stable score axis');const boxes=await spread.locator('[data-z-tick] text:visible').evaluateAll(es=>es.map(e=>e.getBoundingClientRect()).filter(r=>r.width).map(r=>({x:r.x,right:r.right})).sort((a,b)=>a.x-b.x));for(let i=1;i<boxes.length;i++)assert.ok(boxes[i].x>=boxes[i-1].right+1,'score labels do not overlap');}
 console.log('Visual controls: crossing, replay and print restoration pass');
}finally{await browser.close();await server.stop();}
