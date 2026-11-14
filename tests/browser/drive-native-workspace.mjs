import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {chromium} from 'playwright-core';
import {startServer,login} from '../characterization/harness.mjs';
import {seedRetired,receipt} from '../learning-archive-fixture.mjs';

const evidence=process.env.EVIDENCE_DIR??join(tmpdir(),'meabeclick-native-workspace');
await mkdir(evidence,{recursive:true});
const server=await startServer(),db=new DatabaseSync(server.dbPath);seedRetired(db);db.close();
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN??(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':chromium.executablePath()),headless:true});
const report={syntheticOnly:true,errors:[],viewports:[]};
try{
 const cookie=await login(server.baseUrl);
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
  const context=await browser.newContext({viewport,reducedMotion:'reduce'});
  await context.addCookies([{name:'maab_session',value:cookie.split('=')[1],url:server.baseUrl}]);
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(server.baseUrl+'/app/library');
  await page.getByRole('heading',{name:'מרחב ההוראה',exact:true}).waitFor();
  assert.equal(await page.locator('[data-native-workspace] .material-card').count(),4);
  assert.equal(await page.locator('#library-catalog').count(),0);
  assert.equal(await page.getByRole('link',{name:'פתיחת המרחב ב־Drive'}).getAttribute('href'),`https://drive.google.com/drive/folders/${receipt.workspaceId}`);
  const summary=page.locator('details.archive summary');await summary.focus();await page.keyboard.press('Enter');
  await page.getByRole('link',{name:'פתיחת רישום הארכיון'}).waitFor({state:'visible'});
  assert.equal(await page.getByRole('link',{name:'פתיחת רישום הארכיון'}).getAttribute('target'),'_blank');
  assert.equal(await page.evaluate(()=>document.documentElement.dir),'rtl');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'native hub must fit narrow screens');
  await summary.evaluate(el=>el.blur());await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:join(evidence,`native-${viewport.width}.png`),fullPage:true});
  await page.goto(server.baseUrl+'/app/dashboard');
  await page.getByRole('status').filter({hasText:'מרחב ההוראה עבר ל־Google Drive'}).waitFor();
  report.viewports.push(viewport);await context.close();
 }
 assert.deepEqual(report.errors,[]);console.log(JSON.stringify(report));
}finally{await writeFile(join(evidence,'report.json'),JSON.stringify(report,null,2));await browser.close();await server.stop();}
