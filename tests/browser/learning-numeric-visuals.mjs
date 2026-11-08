import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { numericLesson } from '../fixtures/learning-numeric-visuals.mjs';
import { renderLearningDocument } from '../../src/lib/server/learning-render.ts';
import { drawLearningVisual, learningFrameAt } from '../../src/lib/learning/visual.ts';

const evidence=process.env.EVIDENCE_DIR??join(tmpdir(),'meabeclick-numeric-visual-evidence');
await mkdir(evidence,{recursive:true});
const kinds=['fraction-bar','right-triangle','function-tangent'];
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(kinds.includes(url.pathname.slice(1))) {
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(renderLearningDocument(numericLesson(url.pathname.slice(1)),{demo:true}));return;
  }
  try {
    const path=resolve('static',url.pathname.slice(1));
    if(!path.startsWith(resolve('static')+'/'))throw Error('bad path');
    res.setHeader('Content-Type',path.endsWith('.js')?'application/javascript':path.endsWith('.css')?'text/css':path.endsWith('.svg')?'image/svg+xml':'application/octet-stream');
    res.end(await readFile(path));
  } catch {res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN??(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':chromium.executablePath())});
const errors=[], report={syntheticOnly:true,kinds,viewports:[390,1440],browser:browser.version()};
try {
  const context=await browser.newContext();
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  for(const kind of kinds) {
    for(const width of report.viewports) {
      await page.setViewportSize({width,height:1000});
      await page.goto(`${base}/${kind}`);
      await page.locator('[data-scene="numeric-0"] svg > *').first().waitFor({state:'attached'});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${kind} overflow ${width}`);
      await page.screenshot({path:join(evidence,`${kind}-${width}-worked.png`),fullPage:true});
      await page.locator('[data-scene-link]').nth(2).click();
      const challenge=page.locator('[data-scene="numeric-2"]');
      const publicQuestion=await page.locator('#learning-data').evaluate(e=>JSON.parse(e.textContent).experience.scenes.find(s=>s.id==='numeric-2'));
      assert.equal(publicQuestion.frames[0].tex,publicQuestion.questionVisual.tex,'public payload contains stimulus only');
      assert.equal(publicQuestion.frames[0].caption,publicQuestion.questionVisual.caption);
      const formulaSources=await challenge.locator('[data-formula-template]').evaluateAll(templates=>templates.map(t=>t.content.querySelector('annotation').textContent));
      assert.deepEqual(formulaSources,[publicQuestion.questionVisual.tex],'compiled templates contain stimulus only');
      assert.equal(await challenge.locator('[data-caption]').innerText(),'השתמשו בנתונים המסומנים');
      assert.equal(await challenge.locator('[data-formula]').innerText().then(t=>t.includes('987')),false);
      if(kind==='fraction-bar') {
        assert.equal(await challenge.locator('.fraction-cell').count(),4);
        assert.equal(await challenge.locator('.fraction-filled').count(),3);
        assert.equal(await challenge.locator('.plot-note').textContent(),'כל החלקים שווים בגודלם');
      } else if(kind==='right-triangle') {
        assert.equal(await challenge.locator('[data-derived]').textContent(),'?');
        const geometry=await challenge.locator('.triangle-shape').getAttribute('d');
        const points=geometry.match(/[\d.]+/g).map(Number);
        assert.ok(Math.abs((points[4]-points[0])/(points[3]-points[1])-5/12)<1e-10,'uniform triangle scale');
      } else {
        assert.equal(await challenge.locator('.plot-tangent').count(),1);
        assert.equal(await challenge.locator('[data-derived]').textContent(),'x = 2');
      }
      await page.screenshot({path:join(evidence,`${kind}-${width}-question.png`),fullPage:true});
      await page.evaluate(()=>dispatchEvent(new Event('beforeprint')));
      if(kind==='fraction-bar') assert.equal(await page.locator('.print-pages .fraction-cell').count(),8);
      if(kind==='right-triangle') for(const text of await page.locator('.print-pages [data-derived]').allTextContents()) assert.equal(text,'?');
      if(kind==='function-tangent') for(const text of await page.locator('.print-pages [data-derived]').allTextContents()) assert.ok(!text.includes('m ='));
      await page.emulateMedia({media:'print'});
      await page.screenshot({path:join(evidence,`${kind}-${width}-print.png`),fullPage:true});
      await page.emulateMedia({media:'screen'});
      const answer=numericLesson(kind).scenes[2].check.answer;
      await challenge.locator('[data-number-answer]').fill(String(answer+1));
      await challenge.locator('[data-submit]').click();
      assert.equal(await challenge.locator('[data-feedback]').getAttribute('data-kind'),'retry');
      if(kind==='right-triangle') assert.equal(await challenge.locator('[data-derived]').textContent(),'?');
      if(kind==='function-tangent') assert.equal(await challenge.locator('[data-derived]').textContent(),'x = 2');
      await challenge.locator('[data-number-answer]').fill(String(answer));
      await challenge.locator('[data-submit]').click();
      assert.equal(await challenge.locator('[data-feedback]').getAttribute('data-kind'),'success');
      if(kind==='right-triangle') assert.match(await challenge.locator('[data-derived]').textContent(),/13/);
      if(kind==='function-tangent') assert.match(await challenge.locator('[data-derived]').textContent(),/m = 4/);
      await page.evaluate(()=>localStorage.clear());
    }
  }
  const guided=numericLesson('fraction-bar');
  guided.scenes.splice(1,0,{...structuredClone(guided.scenes[0]),id:'guided-fraction',phase:'explore',frames:[
    {values:[1,2],tex:'\\frac{1}{2}',caption:'השלם מחולק לשני חלקים שווים.'},
    {values:[2,4],tex:'\\frac{2}{4}',caption:'אותו חלק צבוע, בחלוקה לארבעה חלקים שווים.'},
  ]});
  await context.route('**/guided-numeric',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:renderLearningDocument(guided,{demo:true})}));
  await page.goto(`${base}/guided-numeric`);
  await page.locator('[data-scene-link]').nth(1).click();
  const guidedSection=page.locator('[data-scene="guided-fraction"]');
  assert.equal(await guidedSection.locator('[data-param]').count(),0);
  assert.equal(await guidedSection.locator('[data-play]').isVisible(),true);
  await guidedSection.locator('[data-frame-dot]').nth(1).click();
  assert.equal(await guidedSection.locator('.fraction-cell').count(),4);
  assert.equal(await guidedSection.locator('.fraction-filled').count(),2);
  assert.equal(await guidedSection.locator('[data-formula] annotation').textContent(),'\\frac{2}{4}');
  const tinyLesson=numericLesson('function-tangent',[.1,0,0,.0000002]);
  for(const scene of tinyLesson.scenes.filter(s=>s.check)) scene.check.answer=.00000004;
  await context.route('**/tiny-tangent',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:renderLearningDocument(tinyLesson,{demo:true})}));
  await page.goto(`${base}/tiny-tangent`);
  await page.locator('[data-scene-link]').nth(2).click();
  const tinyChallenge=page.locator('[data-scene="numeric-2"]');
  await tinyChallenge.locator('[data-number-answer]').fill('0');
  await tinyChallenge.locator('[data-submit]').click();
  assert.equal(await tinyChallenge.locator('[data-feedback]').getAttribute('data-kind'),'retry','demo grading preserves small nonzero answers');
  await tinyChallenge.locator('[data-number-answer]').fill('0.00000004');
  await tinyChallenge.locator('[data-submit]').click();
  assert.equal(await tinyChallenge.locator('[data-feedback]').getAttribute('data-kind'),'success');
  // Direct geometry assertions guard the common renderer independently of UI wiring.
  const geometry=await page.evaluate(drawSource=>{
    const draw=(0,eval)(`(${drawSource})`),svg=document.querySelector('[data-scene="numeric-2"] svg');
    draw(svg,'function-tangent',[2,3,-1,1],[-5,5],[-5,30]);
    const line=svg.querySelector('.plot-tangent');
    return {x1:Number(line.getAttribute('x1')),x2:Number(line.getAttribute('x2')),y1:Number(line.getAttribute('y1')),y2:Number(line.getAttribute('y2'))};
  },drawLearningVisual.toString());
  assert.ok(Math.abs((geometry.y2-geometry.y1)/(geometry.x2-geometry.x1)/(-390/35/(712/10))-7)<1e-10,'tangent uses derivative 2at+b');
  const partitions=await page.evaluate(({drawSource,atSource})=>{
    const draw=(0,eval)(`(${drawSource})`),at=(0,eval)(`(${atSource})`);
    const svg=document.querySelector('[data-scene="numeric-2"] svg');
    const scene={visual:'fraction-bar',frames:[{values:[1,2]},{values:[2,4]}]};
    const result=[];
    for(let time=0;time<6;time+=.2) {
      const state=at(scene,time);
      draw(svg,'fraction-bar',state.values,[0,1],[0,1]);
      result.push({total:svg.querySelectorAll('.fraction-cell').length,filled:svg.querySelectorAll('.fraction-filled').length,frame:state.frame});
    }
    return result;
  },{drawSource:drawLearningVisual.toString(),atSource:learningFrameAt.toString()});
  for(const state of partitions) {
    assert.equal(state.filled/state.total,.5,'equivalent fractions retain the same shaded share');
    assert.equal(state.total,state.frame===0?2:4,'partitions and frame stay synchronized');
  }
  const preciseLabels=await page.evaluate(drawSource=>{
    const draw=(0,eval)(`(${drawSource})`),svg=document.querySelector('[data-scene="numeric-2"] svg');
    draw(svg,'right-triangle',[.004,4],[-5,5],[-5,30],{question:true});
    const triangle=[...svg.querySelectorAll('.plot-coordinate')].map(e=>e.textContent);
    draw(svg,'function-tangent',[.1,.004,.003,.002],[-5,5],[-5,30]);
    const tangent=svg.querySelector('[data-derived]').textContent;
    return {triangle,tangent};
  },drawLearningVisual.toString());
  assert.deepEqual(preciseLabels.triangle,['0.004','4','?']);
  assert.equal(preciseLabels.tangent,'x = 0.002, m = 0.0044');
  const slopes=await page.evaluate(drawSource=>{
    const draw=(0,eval)(`(${drawSource})`),svg=document.querySelector('[data-scene="numeric-2"] svg');
    return [[.1,-.02,0,.1],[.1,-.019999999999999997,0,.1],[.1,0,0,.0000002]].map(values=>{
      draw(svg,'function-tangent',values,[-5,5],[-5,30]);
      return svg.querySelector('[data-derived]').textContent;
    });
  },drawLearningVisual.toString());
  assert.equal(slopes[0],'x = 0.1, m = 0','decimal cancellation yields a horizontal tangent');
  assert.equal(slopes[1],'x = 0.1, m = 3e−18','genuine small residual remains visible');
  assert.equal(slopes[2],'x = 2e−7, m = 4e−8','small slope without cancellation remains visible');

  const videoTemp=await mkdtemp(join(tmpdir(),'numeric-video-'));
  try {
    for(const kind of kinds) {
      const input=join(videoTemp,`${kind}.json`);
      await writeFile(input,JSON.stringify(numericLesson(kind)));
      const output=execFileSync(process.execPath,['scripts/render-learning-video.mjs','--input',input,'--scene','numeric-2','--prepare-only'],{encoding:'utf8'}).trim();
      const videoDir=output.slice('Composition: '.length);
      try {
        const html=await readFile(join(videoDir,'index.html'),'utf8');
        assert.ok(!html.includes('presenterNotes'));
        assert.ok(!html.includes('"answer":'));
        await page.setViewportSize({width:1280,height:720});
        await page.goto(pathToFileURL(join(videoDir,'index.html')).href);
        await page.locator('#film-plot > *').first().waitFor({state:'attached'});
        if(kind==='right-triangle') assert.equal(await page.locator('#film-plot [data-derived]').textContent(),'?');
        if(kind==='function-tangent') assert.equal(await page.locator('#film-plot [data-derived]').textContent(),'x = 2');
        if(kind==='fraction-bar') {
          assert.equal(await page.locator('#film-plot .fraction-filled').count(),3);
          assert.notEqual(await page.locator('#film-plot .fraction-filled').first().evaluate(e=>getComputedStyle(e).fill),'rgb(0, 0, 0)');
        }
        await page.evaluate(()=>renderAt(3));
        await page.screenshot({path:join(evidence,`${kind}-video-question.png`)});
      } finally {await rm(videoDir,{recursive:true,force:true});}
    }
  } finally {await rm(videoTemp,{recursive:true,force:true});}
  assert.deepEqual(errors,[]);
  await writeFile(join(evidence,'report.json'),JSON.stringify({...report,errors},null,2));
  console.log(JSON.stringify({ok:true,evidence,...report}));
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
