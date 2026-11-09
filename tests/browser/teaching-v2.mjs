import assert from'node:assert/strict';import{mkdir,writeFile}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';import{DatabaseSync}from'node:sqlite';import{chromium}from'playwright-core';
import{startServer,login}from'../characterization/harness.mjs';import{seedLearning}from'../characterization/learning-fixture.mjs';import{teachingFixture}from'../teaching-fixture.mjs';import{visualFixture}from'../teaching-visual-fixture.mjs';import{renderLearningDocument}from'../../src/lib/server/learning-render.ts';import{teachingDisplay}from'../../src/lib/server/teaching-display.ts';
const evidence=process.env.EVIDENCE_DIR??join(tmpdir(),'meabeclick-teaching-v2');await mkdir(evidence,{recursive:true});
const server=await startServer(),browser=await chromium.launch({executablePath:process.env.CHROME_BIN??(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':chromium.executablePath()),headless:true}),report={syntheticOnly:true,errors:[],visuals:[],viewports:[]};
try{
 const context=await browser.newContext({viewport:{width:1440,height:1050},reducedMotion:'reduce'}),page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 const fixture=visualFixture(),html=renderLearningDocument(fixture,{demo:true,teaching:teachingDisplay(teachingFixture(),'synthetic')});
 await page.route('**/synthetic-v2',r=>r.fulfill({contentType:'text/html',body:html}));await page.goto(server.baseUrl+'/synthetic-v2');await page.locator('.plot-curve').first().waitFor();
 for(const kind of ['fraction','geometry','data-bars','normal','normal-school']){
  await page.locator('[data-scene-link]').nth(fixture.scenes.findIndex(s=>s.id===kind)).click();const section=page.locator(`[data-scene="${kind}"]`);
  const before=await section.locator('[data-formula]').innerText();await section.locator('[data-param]').first().evaluate(e=>{e.value=String(Number(e.value)+Number(e.step));e.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.notEqual(await section.locator('[data-formula]').innerText(),before);assert.ok(await section.locator('svg>*').count()>2);assert.equal(await section.locator('[data-math-error]').count(),0);report.visuals.push(kind);
 }
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`overflow at ${width}`);
  await page.screenshot({path:join(evidence,`visual-${width}.png`),fullPage:true});report.viewports.push(width);
 }
 await page.evaluate(()=>dispatchEvent(new Event('beforeprint')));assert.ok(await page.locator('[data-print-visual] svg,[data-print-visual]>path,[data-print-visual]>rect').count()>5);
 await page.emulateMedia({media:'print'});await page.pdf({path:join(evidence,'lesson-print.pdf'),format:'A4',printBackground:true});await page.emulateMedia({media:'screen'});
 const pupil=await seedLearning(server),db=new DatabaseSync(server.dbPath),plan=teachingFixture();db.prepare("UPDATE lesson_materials SET content=? WHERE lesson_slug=? AND kind='plan'").run(JSON.stringify(plan),pupil.slug);
 const family=await browser.newContext({viewport:{width:390,height:1000}});const[name,value]=pupil.cookie.split('=');await family.addCookies([{name,value,url:server.baseUrl,httpOnly:true,sameSite:'Lax'}]);
 const assigned=await family.newPage();assigned.on('pageerror',e=>report.errors.push(e.message));await assigned.goto(`${server.baseUrl}/app/learn/${pupil.slug}#scene=independent`);await assigned.locator('[data-save-status]').filter({hasText:'נשמרת בדף האישי'}).waitFor();
 const scene=assigned.locator('[data-scene="independent"]');assert.equal(await scene.locator('[data-solution]').isDisabled(),true);assert.ok(!(await assigned.content()).includes('PrivateSolution'));
 await scene.locator('[data-number-answer]').fill('-99');await scene.locator('[data-submit]').click();await scene.locator('[data-feedback][data-kind="retry"]').waitFor();assert.equal(await scene.locator('[data-solution]').isDisabled(),false);
 await scene.locator('[data-solution]').click();await scene.locator('[data-worked-solution]').filter({hasText:'PrivateSolution'}).waitFor();
 await scene.locator('[data-number-answer]').fill('4');await scene.locator('[data-submit]').click();await scene.locator('[data-feedback][data-kind="success"]').waitFor();
 const progress=await(await family.request.get(`${server.baseUrl}/api/learning/${pupil.slug}`)).json();assert.equal(progress.progress.independent.revealed,true);
 await assigned.goto(`${server.baseUrl}/app/learn/${pupil.slug}/homework#scene=homework-2`);const reasoning=assigned.locator('[data-reasoning]');await reasoning.waitFor();await family.setOffline(true);await reasoning.fill('נימוק סינתטי שנשמר במכשיר');await family.setOffline(false);await assigned.reload();await reasoning.waitFor();assert.equal(await reasoning.inputValue(),'נימוק סינתטי שנשמר במכשיר');assert.match(await assigned.locator('main').innerText(),/לבדיקת מורה/);
 await assigned.screenshot({path:join(evidence,'homework-mobile.png'),fullPage:true});
 const tutor=await browser.newContext(),cookie=await login(server.baseUrl),[tn,tv]=cookie.split('=');await tutor.addCookies([{name:tn,value:tv,url:server.baseUrl,httpOnly:true,sameSite:'Lax'}]);
 const before=db.prepare('SELECT COUNT(*) AS n FROM learning_events').get().n;const review=await tutor.newPage();review.on('pageerror',e=>report.errors.push(e.message));await review.goto(server.baseUrl+'/app/learning-review?version=v2');
 const count=await review.locator('article').count();report.candidateCases=count;
 if(count){assert.equal(count,10);const url=await review.locator('article nav a').first().getAttribute('href');await review.goto(server.baseUrl+url);await review.locator('[data-scene]').first().waitFor();assert.equal(await review.locator('[data-agenda]').count(),1);}
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM learning_events').get().n,before,'preview must not write evidence');db.close();assert.deepEqual(report.errors,[]);await writeFile(join(evidence,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();await server.stop();}
