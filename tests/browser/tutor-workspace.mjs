// Synthetic-only UI checks. Build first; BASELINE=1 captures the existing UI.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {chromium} from 'playwright-core';
import {startServer,login} from '../characterization/harness.mjs';

const baseline=process.env.BASELINE==='1';
const evidence=process.env.EVIDENCE_DIR??join(tmpdir(),`meabeclick-workspace-${baseline?'before':'after'}`);
await mkdir(evidence,{recursive:true});
const server=await startServer();
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN??(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':chromium.executablePath()),headless:true});
const report={syntheticOnly:true,baseline,errors:[],pages:[]};
try {
  const cookie=await login(server.baseUrl);
  for(const [i,name] of ['נועה לדוגמה','איתי לדוגמה','תמר לדוגמה'].entries()) {
    const response=await fetch(server.baseUrl+'/api/students',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({code:`ui-student-${i}`,name,subject:'מתמטיקה',level:'כיתה י',phone:`050123456${i}`,email:`ui-${i}@example.test`})});
    assert.equal(response.status,200);
  }
  const db=new DatabaseSync(server.dbPath),now=new Date().toISOString();
  const students=db.prepare('SELECT s.id,e.id AS enrollment FROM students_v2 s JOIN enrollments e ON e.student_id=s.id ORDER BY s.id').all();
  for(const [i,s] of students.entries()) {
    const start=new Date(Date.now()+(i===2?-1:i+1)*86400000).toISOString();
    db.prepare('INSERT INTO bookings_v2 (student_id,enrollment_id,start,"end",duration,at,status) VALUES (?,?,?,?,45,?,\'confirmed\')').run(s.id,s.enrollment,start,new Date(Date.parse(start)+2700000).toISOString(),now);
  }
  const event=db.prepare('INSERT INTO marketing_events (at,visitor_id,event,target,utm_source,utm_campaign,utm_content,booking_id) VALUES (?,?,?,?,?,?,?,?)');
  for(const [i,source] of ['instagram','whatsapp',null].entries())for(let visitor=0;visitor<3+i;visitor++)event.run(now,`ui-${i}-${visitor}`,'landing_visit',null,source,source?'שיעורי מתמטיקה':null,null,null);
  event.run(now,'ui-0-0','cta_click','booking','instagram','שיעורי מתמטיקה',null,null);
  event.run(now,'ui-0-0','booking_started',null,'instagram','שיעורי מתמטיקה',null,null);
  db.prepare("INSERT INTO library_items (template_id,skill_key,status,updated_at,problem) VALUES ('math-5u','func.basics.linquad','failed',?,?)").run(now,'ההכנה לא הושלמה. אפשר לנסות שוב.');
  db.close();
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  // Same font files as production, without depending on Google's availability.
  await context.route('https://fonts.googleapis.com/**',route=>route.fulfill({contentType:'text/css',body:`@font-face{font-family:Heebo;src:url('${server.baseUrl}/learning-assets/heebo-hebrew.woff2') format('woff2');font-weight:100 900;font-display:swap;}@font-face{font-family:Heebo;src:url('${server.baseUrl}/learning-assets/heebo-latin.woff2') format('woff2');font-weight:100 900;unicode-range:U+0000-00FF;font-display:swap;}`}));
  const [name,...value]=cookie.split('=');
  await context.addCookies([{name,value:value.join('='),url:server.baseUrl,httpOnly:true,sameSite:'Lax'}]);
  const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
  const paths=['dashboard','library','marketing'];
  for(const width of [1440,390,320]) {
    await page.setViewportSize({width,height:width===1440?1000:844});
    for(const path of paths) {
      await page.goto(`${server.baseUrl}/app/${path}`);
      await page.getByRole('heading',{level:1}).waitFor();await page.evaluate(()=>document.fonts.ready);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${path} overflows at ${width}`);
      const nav=page.getByRole('navigation',{name:'ניווט ראשי',exact:true});
      assert.equal(await nav.locator('a').count(),3);
      assert.equal(await nav.locator('[aria-current="page"]').getAttribute('href'),`/app/${path}`);
      if(!baseline) {
        assert.equal(await page.getByRole('banner').count(),1);
        assert.equal(await page.getByRole('button',{name:'יציאה מהחשבון',exact:true}).count(),1);
        assert.equal(await page.getByRole('heading',{level:1}).count(),1);
        const header=await page.getByRole('banner').boundingBox(),main=await page.locator('main').boundingBox();
        report.pages.push({path,width,headerHeight:header.height,contentLeft:main.x,contentWidth:main.width});
      }
      await page.screenshot({path:join(evidence,`${path}-${width}.png`)});
    }
    if(!baseline) {
      const geometry=report.pages.filter(entry=>entry.width===width);
      for(const entry of geometry) {
        assert.equal(entry.headerHeight,geometry[0].headerHeight,'shared header height');
        assert.equal(entry.contentLeft,geometry[0].contentLeft,'shared content alignment');
        assert.equal(entry.contentWidth,geometry[0].contentWidth,'shared content width');
      }
    }
  }
  await page.setViewportSize({width:390,height:844});
  await page.goto(server.baseUrl+'/app/dashboard');
  await page.getByRole('button',{name:/תלמיד חדש|תלמיד\/ה חדש\/ה/}).click();
  if(!baseline) {
    const dialog=page.getByRole('dialog',{name:'הוספת תלמיד/ה'});
    await dialog.waitFor();
    assert.equal(await page.locator('#ns-name').evaluate(el=>el===document.activeElement),true);
    await page.screenshot({path:join(evidence,'new-student-390.png')});
    for(let i=0;i<12;i++) {
      await page.keyboard.press('Tab');
      // Chromium can focus its browser chrome at the end of the native tab
      // cycle (activeElement is body); background page controls stay inert.
      assert.equal(await dialog.evaluate(el=>el.contains(document.activeElement)||document.activeElement===document.body),true,'background controls never receive focus');
    }
    await page.getByRole('button',{name:'יציאה מהחשבון',exact:true}).evaluate(el=>el.focus());
    assert.equal(await page.getByRole('button',{name:'יציאה מהחשבון',exact:true}).evaluate(el=>el===document.activeElement),false,'modal background is inert');
    await page.keyboard.press('Escape');
    await dialog.waitFor({state:'hidden'});
    assert.equal(await page.getByRole('button',{name:/תלמיד חדש|תלמיד\/ה חדש\/ה/}).evaluate(el=>el===document.activeElement),true);
    await page.waitForFunction(()=>document.body.style.overflow==='');
    await page.getByRole('button',{name:'תלמיד/ה חדש/ה',exact:true}).click();
    await dialog.getByRole('button',{name:'הוספת תלמיד/ה',exact:true}).click();
    await dialog.getByRole('alert').waitFor();
    assert.match(await dialog.getByRole('alert').innerText(),/נא להזין שם/);
    await page.locator('#ns-name').fill('תלמיד בדיקת ממשק');
    let attempts=0,releaseCreate;
    const createGate=new Promise(resolve=>{releaseCreate=resolve;});
    await page.route('**/api/students',async route=>{
      if(route.request().method()!=='POST')return route.continue();
      attempts++;
      if(attempts===1)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'תקלה זמנית — אפשר לנסות שוב.'})});
      await createGate;
      await route.continue();
    });
    await dialog.getByRole('button',{name:'הוספת תלמיד/ה',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.student-error')?.textContent.includes('תקלה זמנית'));
    assert.equal(await page.locator('#ns-name').inputValue(),'תלמיד בדיקת ממשק','failed creation keeps the draft');
    await dialog.getByRole('button',{name:'הוספת תלמיד/ה',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.student-dialog button[type="submit"]').disabled);
    assert.equal(await dialog.getByRole('button',{name:'ביטול',exact:true}).isDisabled(),true);
    await page.keyboard.press('Escape');
    assert.equal(await dialog.isVisible(),true,'pending creation cannot be dismissed');
    releaseCreate();
    await dialog.waitFor({state:'hidden'});
    await page.locator('.roster-table').getByRole('link',{name:'תלמיד בדיקת ממשק',exact:true}).waitFor();
    await page.getByRole('link',{name:'פתיחת התיק',exact:true}).waitFor();
    assert.equal(attempts,2,'one retry creates one student');
    await page.getByRole('button',{name:'תלמיד/ה חדש/ה',exact:true}).click();
    assert.equal(await page.locator('#ns-name').inputValue(),'','successful creation resets the form');
    await page.setViewportSize({width:320,height:568});
    await dialog.getByText('מטרות וסגנון למידה',{exact:true}).click();
    await page.locator('#ns-goals').fill('בדיקת טופס במסך קטן');
    const bounds=await dialog.boundingBox();
    assert.ok(bounds.y>=0&&bounds.y+bounds.height<=568,'dialog fits a short viewport');
    assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth),false,'expanded dialog has no horizontal overflow');
    const footer=await dialog.locator('.student-dialog-footer').boundingBox();
    assert.ok(footer.y>=0&&footer.y+footer.height<=568,'actions remain visible while editing optional fields');
    await page.screenshot({path:join(evidence,'new-student-320-expanded.png')});
    await page.keyboard.press('Escape');
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('link',{name:'פתיחת התיק',exact:true}).click();
    await page.getByRole('heading',{level:1,name:'תלמיד בדיקת ממשק',exact:true}).waitFor();
    assert.equal(await page.getByRole('banner').count(),1,'student detail shares the workspace header');
    // Destination changes use the shared shell, not a full reload-only affordance.
    await page.getByRole('navigation',{name:'ניווט ראשי',exact:true}).getByRole('link',{name:'ספריית תוכן'}).click();
    await page.getByRole('heading',{level:1,name:'ספריית תוכן'}).waitFor();
    await page.getByRole('link',{name:'בחירת נושא להכנה',exact:true}).click();
    await page.waitForURL(/#library-catalog$/);
    const catalog=await page.locator('#library-catalog').boundingBox(),banner=await page.getByRole('banner').boundingBox();
    assert.ok(catalog.y>=banner.y+banner.height,'preparation entry lands below the sticky header');
    await page.route('**/api/logout',route=>route.fulfill({status:503}));
    await page.getByRole('button',{name:'יציאה מהחשבון',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'לא הצלחנו לצאת'}).waitFor();
    assert.match(page.url(),/\/app\/library/,'failed sign-out keeps the tutor in place');
    await page.unroute('**/api/logout');
    await page.getByRole('button',{name:'יציאה מהחשבון',exact:true}).click();
    await page.waitForURL(server.baseUrl+'/');
    await page.goto(server.baseUrl+'/app/marketing');
    assert.match(page.url(),/\/login\?next=/);
  } else await page.screenshot({path:join(evidence,'new-student-390.png')});
  assert.deepEqual(report.errors,[]);
  await writeFile(join(evidence,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({evidence,...report}));
}finally{await browser.close();await server.stop();}
