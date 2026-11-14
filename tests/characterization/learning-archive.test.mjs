import{test,before,after}from'node:test';import assert from'node:assert/strict';
import{DatabaseSync}from'node:sqlite';import{mkdir,writeFile}from'node:fs/promises';import{join}from'node:path';
import{startServer}from'./harness.mjs';import{seedRetired,receipt}from'../learning-archive-fixture.mjs';
let server,cookie;
before(async()=>{
 server=await startServer({env:{CRON_KEY:'synthetic-archive-cron'}});const db=new DatabaseSync(server.dbPath);seedRetired(db);
 db.prepare("INSERT INTO library_items(template_id,skill_key,slug,status,updated_at) VALUES('math-8','synthetic','retired-lesson','ready',?)").run(new Date().toISOString());db.close();
 await mkdir(join(server.dataDir,'lessons','retired-lesson'),{recursive:true});await writeFile(join(server.dataDir,'lessons','retired-lesson','slides.html'),'<!doctype html><h1>Historical material remains available</h1>');
 const r=await fetch(server.baseUrl+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'test-password'})});cookie=r.headers.getSetCookie().find(c=>c.startsWith('maab_session='))?.split(';')[0];assert.ok(cookie);
});
after(async()=>{await server?.stop();});
const get=(path,auth=true)=>fetch(server.baseUrl+path,{redirect:'manual',headers:auth?{Cookie:cookie}:{}});
test('fresh native workspace replaces the old catalog and galleries, with authenticated access',async()=>{
 const page=await get('/app/library');assert.equal(page.status,200);const html=await page.text();
 assert.ok(html.includes('data-native-workspace'));assert.ok(html.includes(receipt.workspaceId));assert.ok(html.includes(receipt.archiveIndexId));assert.ok(!html.includes('library-catalog'));
 assert.equal((await get('/app/library',false)).status,302);
 const list=await(await get('/api/lessons')).json();assert.deepEqual(list.lessons,[]);
 const library=await(await get('/api/library?all=1')).json();assert.deepEqual(library.rows,[]);assert.equal(library.nativeWorkspace.archiveId,receipt.archiveId);
 for(const path of ['/app/learning-review','/app/learning-review?version=v2','/app/learning-pilot']){const r=await get(path);assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/app/library');}
 const historical=await get('/lessons/retired-lesson');assert.equal(historical.status,200);assert.match(await historical.text(),/Historical material remains available/);
});
test('stale preparation/import cannot recreate legacy material and only the operator can request global retirement',async()=>{
 for(const path of ['/api/library/prepare','/api/library/import']){
  const r=await fetch(server.baseUrl+path,{method:'POST',headers:{Cookie:cookie,'content-type':'application/json'},body:JSON.stringify({template:'math-8',skill:'synthetic'})});assert.equal(r.status,409);assert.equal((await r.json()).workspaceUrl,'/app/library');
 }
 assert.equal((await fetch(server.baseUrl+'/api/central-drive-sync',{method:'POST',headers:{Cookie:cookie}})).status,401);
 assert.equal((await fetch(server.baseUrl+'/api/central-drive-sync',{method:'POST',headers:{'x-cron-key':'synthetic-archive-cron'}})).status,202);
 const db=new DatabaseSync(server.dbPath,{readOnly:true});assert.equal(db.prepare('SELECT count(*) n FROM lesson_materials').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM lessons').get().n,1);db.close();
});
