import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { DatabaseSync } from 'node:sqlite';
import corpus from '../../src/lib/server/learning-review-corpus.json' with { type:'json' };
import { startServer, login } from '../characterization/harness.mjs';
import { TEMPLATE_FILES } from '../../src/lib/server/lesson/prep.ts';

const evidence=process.env.EVIDENCE_DIR??join(tmpdir(),'meabeclick-review-evidence');
await mkdir(evidence,{recursive:true});
assert.equal(corpus.cases.length,10);
const server=await startServer();
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN??(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':chromium.executablePath()),headless:true});
const report={syntheticOnly:true,errors:[],badRequests:[],scenes:0,games:0,viewports:[390,1440]};
function counts(){const db=new DatabaseSync(server.dbPath);try{return ['lessons','library_items','lesson_materials','learning_assignments','learning_progress','learning_events','results_v2'].map(t=>db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n);}finally{db.close();}}
try{
  const cookie=await login(server.baseUrl);
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const [name,...value]=cookie.split('=');
  await context.addCookies([{name,value:value.join('='),url:server.baseUrl}]);
  const page=await context.newPage();
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('request',request=>{if(request.method()==='POST'&&/\/api\/(learning|game-result)/.test(request.url()))report.badRequests.push(request.url());});
  const before=counts();
  await page.goto(server.baseUrl+'/app/learning-review');
  assert.equal(await page.locator('article').count(),10);
  await page.screenshot({path:join(evidence,'index-desktop.png'),fullPage:true});
  for(const item of corpus.cases){
    const base=`${server.baseUrl}/app/learning-review?case=${item.brief.id}`;
    for(const width of report.viewports){
      await page.setViewportSize({width,height:1000});
      await page.goto(base+'&view=lesson');
      for(let i=0;i<item.plan.learning.scenes.length;i++){
        await page.locator('[data-scene-link]').nth(i).click();
        assert.equal(await page.locator('[data-scene]:visible').count(),1);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${item.brief.id} stage ${i+1} width ${width}`);
        assert.equal(await page.locator('.katex-error,[data-math-error]').count(),0);
        const scene=item.plan.learning.scenes[i];
        if(scene.visual==='steps'){
          const section=page.locator(`[data-scene="${scene.id}"]`);
          assert.equal(await section.locator('[data-formula]:visible').count(),0,'no duplicate formula');
          assert.equal(await section.locator('[data-caption]:visible').count(),0,'no duplicate caption');
          assert.equal(await section.locator('[data-step-formula]:visible').count(),1);
          assert.equal(await section.locator('[data-step-caption]:visible').count(),1);
          assert.equal(await section.locator('[data-plot]').evaluate(el=>el.getBoundingClientRect().height),0);
        }
        if(width===1440 && scene.check && ['choice','number'].includes(scene.check.kind)){
          if(scene.check.kind==='choice')await page.locator(`[data-scene="${scene.id}"] [data-option]`).first().click();
          else await page.locator(`[data-scene="${scene.id}"] [data-number-answer]`).fill(String(scene.check.answer));
          await page.locator(`[data-scene="${scene.id}"] [data-submit]`).click();
          await page.locator(`[data-scene="${scene.id}"] [data-feedback][data-kind]`).waitFor();
        }
        report.scenes++;
      }
      await page.locator('[data-scene-link]').first().click();
      await page.screenshot({path:join(evidence,`${item.brief.id}-${width}.png`),fullPage:true});
    }
    await page.goto(base+'&view=presenter');
    assert.equal(await page.locator('.notes-section').count(),item.plan.learning.scenes.length);
    const projection=context.waitForEvent('page');
    await page.locator('.notes-section header a').first().click();
    // target=lesson-presentation creates a private projection window, with no notes in its DOM.
    const projected=await projection;
    if(projected){await projected.waitForLoadState();assert.equal(await projected.locator('.notes-section').count(),0);await projected.close();}
    await page.goto(base+'&view=homework');
    assert.equal(await page.locator('article').count(),item.plan.homework.length);
    assert.equal(await page.locator('.katex-error,[data-math-error]').count(),0);
    for(const [key,body]of Object.entries(item.plan.games))if(body){
      await page.goto(`${server.baseUrl}/app/review-game/${item.brief.id}/${TEMPLATE_FILES[key]}`);
      await page.locator('.preview-banner').waitFor();
      assert.equal(await page.locator('.katex-error,[data-math-error]').count(),0,'valid game math');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${item.brief.id}/${key} overflow`);
      if(key==='quiz'||key==='twoTruths'){
        const rounds=key==='quiz'?body.questions:body.rounds;
        for(let i=0;i<rounds.length;i++){
          assert.equal(await page.locator('.katex-error,[data-math-error]').count(),0,'valid round math');
          await page.locator('.opt').first().click();
          await page.getByRole('button',{name:i+1<rounds.length?'הבא ←':'סיום 🏁',exact:true}).click();
        }
        await page.locator('#done').waitFor();
      }
      report.games++;
    }
  }
  assert.deepEqual(counts(),before,'no customer records or scores from review');
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.badRequests,[]);
  console.log(`Reviewed ${report.scenes} scene viewports and ${report.games} games. Evidence: ${evidence}`);
}finally{
  await writeFile(join(evidence,'report.json'),JSON.stringify(report,null,2));
  await browser.close();await server.stop();
}
