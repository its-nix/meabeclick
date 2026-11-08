/** Synthetic banks only. Requires a current production build, never calls a model. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright-core';
import { startServer, login } from '../characterization/harness.mjs';
const evidenceDir = process.env.EVIDENCE_DIR ?? join(tmpdir(), 'meabeclick-adaptive-games-evidence');
await mkdir(evidenceDir, {recursive:true});
const server = await startServer();
process.env.DB_PATH = server.dbPath;
process.env.DATA_DIR = server.dataDir;
process.env.SESSION_SECRET = 'test-secret-not-a-real-one';
const { createAccount, createStudent } = await import('../../src/lib/server/entities.ts');
const { createLesson } = await import('../../src/lib/server/db.ts');
const { gameUrl } = await import('../../src/lib/server/urls.ts');
const account = createAccount({name:'Synthetic practice household',credential:'synthetic'});
const student = createStudent({code:'synthetic-adaptive',name:'Synthetic practice learner',accountId:account.id,credential:'synthetic'});
createLesson({slug:'synthetic-adaptive',student:student.name,subject:'math'});
const db = new DatabaseSync(server.dbPath);
const lesson = db.prepare('SELECT id FROM lessons WHERE slug=?').get('synthetic-adaptive');
const base = Array.from({length:15},(_,i)=>({id:`q${i}`,difficulty:i%3+1,hint:'Think about the operation first',why:'Synthetic explanation'}));
const banks = {
 quiz: {questions:base.map((r,i)=>({...r,q:`synthetic-${i}`,options:[`right${i}`,`wrong${i}`],answer:0}))},
 'error-hunt':{rounds:base.map((r,i)=>({...r,problem:`synthetic-${i}`,steps:[`start${i}`,`error${i}`],badStep:1}))},
 'two-truths':{rounds:base.map((r,i)=>({...r,statements:[`truth-a-${i}`,`truth-b-${i}`,`false-${i}`],lieIndex:2}))},
 'graph-match':{rounds:base.map((r,i)=>({...r,prompt:`synthetic-${i}`,mainLabel:'f(x)',
  ...(i%3===0?{main:[0,1,2,3,4],options:[[0,0.5,1,1.5,2],[0,1,2,3,4]]}
   :i%3===1?{main:[-2,-1,0,1,2],options:[[-6,-3,0,3,6],[-4,-2,0,2,4]]}
   :{main:[3,3,3,3,3],options:[[0,0,0,0,0],[2,2,2,2,2]]}),answer:0}))},
 'number-line':{min:0,max:20,rounds:base.map((r,i)=>({...r,target:i,label:String(i),tolerance:0.5}))},
 'speed-drill':{seconds:2,items:base.map(({hint,...r},i)=>({...r,q:`synthetic-${i}`,a:`right${i}`,options:[`right${i}`,`wrong${i}`,`other${i}`]}))},
};
for(const [template,body] of Object.entries(banks)) {
 body.title=`Synthetic ${template}`;body.subject='Assigned arithmetic skill';
 db.prepare('INSERT INTO game_filler(id,body) VALUES(?,?)').run(`synthetic-${template}`,JSON.stringify(body));
 db.prepare(`INSERT INTO lesson_game_assignments(id,lesson_id,student_id,template,title,status,draft_body,created_at,updated_at) VALUES(?,?,?,?,?,'draft',?,?,?)`).run(`synthetic-${template}`,lesson.id,student.id,template,body.title,JSON.stringify(body),new Date().toISOString(),new Date().toISOString());
}
const browser = await chromium.launch({executablePath:process.env.CHROME_BIN??(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':chromium.executablePath()),headless:true});
const report={syntheticOnly:true,viewport:{width:390,height:844},templates:[],previewWrites:0,errors:[],screenshots:[],graphComparisons:[]};
try {
 const context = await browser.newContext({viewport:{width:390,height:844}});
 const cookie = await login(server.baseUrl);const [name,...value]=cookie.split('=');
 await context.addCookies([{name,value:value.join('='),url:server.baseUrl}]);
 const page = await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 async function finite(template, preview=false, hinted=false) {
  const dataId=`synthetic-${template}`;
  await page.goto(preview?`${server.baseUrl}/app/play/${template}?preview=${dataId}`:server.baseUrl+gameUrl({template,dataId,student:student.code}));
  await page.locator('.stats').waitFor();
  const screenshot = `${template}${preview?'-preview':hinted?'-hinted':''}.png`;
  await page.screenshot({path:join(evidenceDir,screenshot),fullPage:true});
  report.screenshots.push(screenshot);
  for(let n=0;n<10;n++){
   assert.match(await page.locator('.stats .stat-val').first().innerText(),new RegExp(`^${n+1}/10$`));
   if(hinted && n===0) await page.getByRole('button',{name:/רמז/}).click();
   if(template==='quiz'){
    const i=(await page.locator('.q-text').innerText()).match(/synthetic-(\d+)/)[1];
    await page.getByRole('button',{name:`right${i}`,exact:true}).click();
   }else if(template==='error-hunt')await page.locator('.step').nth(1).click();
   else if(template==='two-truths')await page.locator('.opt').filter({hasText:'false-'}).click();
   else if(template==='graph-match'){
    const points=await page.locator('.gopt polyline').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('points')));
    assert.equal(new Set(points).size,points.length,`proportional alternatives must remain geometrically distinct: ${points.join(' | ')}`);
    const axes=await page.locator('.main-graph svg > line:first-of-type, .gopt svg > line:first-of-type').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('y1')));
    assert.equal(new Set(axes).size,1,'main and option graphs share the same zero baseline');
    const labels=await page.locator('.main-graph svg,.gopt svg').evaluateAll(nodes=>nodes.map(svg=>Array.from(svg.querySelectorAll('text'),n=>n.textContent)));
    assert.ok(labels[0].length>=2,'numeric y ticks explain the common units');
    assert.ok(labels.every(ticks=>JSON.stringify(ticks)===JSON.stringify(labels[0])),'all curves show the same numeric scale');
    report.graphComparisons.push({prompt:await page.locator('.prompt').innerText(),points,zeroY:axes[0],ticks:labels[0]});
    await page.locator('.gopt').first().click();
   }
   else {
    const target=Number(await page.locator('.target-val').innerText());
    await page.locator('[role=slider]').press('Home');
    for(let i=0;i<target*2;i++)await page.locator('[role=slider]').press('ArrowRight');
    await page.getByRole('button',{name:'בדיקה ✓',exact:true}).click();
   }
   await page.getByRole('button',{name:n===9?'סיום 🏁':'הבא ←',exact:true}).click();
  }
  await page.locator('#done').waitFor();
  if(!preview){
   await page.getByText('✓ נשמר', {exact:true}).waitFor();
   const row=db.prepare('SELECT * FROM results_v2 WHERE student_id=? AND data_id=? ORDER BY id DESC LIMIT 1').get(student.id,dataId);
   assert.equal(row.total,10);
   const evidence=JSON.parse(row.question_evidence);
   assert.equal(evidence.length,10);assert.equal(new Set(evidence.map(e=>e.questionId)).size,10);
   assert.equal(evidence[0].difficulty,2);
   if(template==='quiz'){
    assert.equal(evidence[1].difficulty,hinted?1:2,JSON.stringify(evidence));
    if(hinted)assert.equal(evidence[0].hints,1);else assert.equal(evidence[2].difficulty,3);
   }
   report.templates.push({template,rounds:10,hinted,evidence});
  }
 }
 for(const template of Object.keys(banks).filter(t=>t!=='speed-drill'))await finite(template);
 await finite('quiz',false,true);
 const before=db.prepare('SELECT count(*) AS n FROM results_v2').get().n;
 page.on('request',r=>{if(r.method()==='POST' && r.url().includes('/api/game-result'))report.previewWrites++;});
 await finite('quiz',true);
 assert.equal(report.previewWrites,0);
 assert.equal(db.prepare('SELECT count(*) AS n FROM results_v2').get().n,before);
 // Count drill writes separately from preview, and advance its real timer locally.
 const drill = await context.newPage();drill.on('pageerror',e=>report.errors.push(e.message));
 await drill.clock.install();
 await drill.goto(server.baseUrl+gameUrl({template:'speed-drill',dataId:'synthetic-speed-drill',student:student.code}));
 await drill.getByRole('button',{name:'יאללה, מתחילים! 🚀',exact:true}).click();
 for(let n=0;n<5;n++){
  const i=(await drill.locator('.q').innerText()).match(/synthetic-(\d+)/)[1];
  await drill.getByRole('button',{name:`right${i}`,exact:true}).click();
  await drill.clock.runFor(200);
 }
 await drill.clock.runFor(1200);
 await drill.locator('#done').waitFor();await drill.getByText('✓ נשמר', {exact:true}).waitFor();
 const timed=db.prepare('SELECT * FROM results_v2 WHERE student_id=? AND template=? ORDER BY id DESC LIMIT 1').get(student.id,'speed-drill');
 const timedEvidence=JSON.parse(timed.question_evidence);assert.equal(timedEvidence.length,5);assert.equal(timed.total,5);
 assert.equal(timedEvidence[2].difficulty,3);assert.equal(timedEvidence[0].hints,null);
 await drill.screenshot({path:join(evidenceDir,'speed-drill-finished.png'),fullPage:true});
 report.screenshots.push('speed-drill-finished.png');
 report.templates.push({template:'speed-drill',timed:true,rounds:5,evidence:timedEvidence});
 assert.deepEqual(report.errors,[]);
 await writeFile(join(evidenceDir,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({passed:true,evidenceDir,templates:report.templates.map(({evidence,...t})=>t),previewWrites:report.previewWrites,errors:report.errors},null,2));
} finally { await browser.close();db.close();await server.stop(); }
