import{test,before,after}from'node:test';import assert from'node:assert/strict';
import{DatabaseSync}from'node:sqlite';
import{startServer}from'./harness.mjs';import{seedRetired,receipt}from'../learning-archive-fixture.mjs';
let server,cookie;
before(async()=>{
 server=await startServer({env:{CRON_KEY:'synthetic-archive-cron'}});const db=new DatabaseSync(server.dbPath);seedRetired(db);db.close();
 const r=await fetch(server.baseUrl+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'test-password'})});cookie=r.headers.getSetCookie().find(c=>c.startsWith('maab_session='))?.split(';')[0];assert.ok(cookie);
});
after(async()=>{await server?.stop();});
const get=(path,auth=true)=>fetch(server.baseUrl+path,{redirect:'manual',headers:auth?{Cookie:cookie}:{}});
test('the native workspace is the only teaching page, with authenticated access',async()=>{
 const page=await get('/app/library');assert.equal(page.status,200);const html=await page.text();
 assert.ok(html.includes('data-native-workspace'));assert.ok(html.includes(receipt.workspaceId));assert.ok(html.includes(receipt.archiveIndexId));assert.ok(!html.includes('library-catalog'));
 assert.equal((await get('/app/library',false)).status,302);
});
test('the removed catalog, review pages and preparation endpoints answer 404, and only the operator can request global retirement',async()=>{
 for(const path of ['/api/library','/api/library?all=1','/api/library/due','/app/learning-review','/app/learning-review?version=v2','/app/learning-pilot','/api/drive-sync','/api/health/generation'])assert.equal((await get(path)).status,404,path);
 for(const path of ['/api/library/prepare','/api/library/import']){
  const r=await fetch(server.baseUrl+path,{method:'POST',headers:{Cookie:cookie,'content-type':'application/json'},body:JSON.stringify({template:'math-8',skill:'synthetic'})});assert.equal(r.status,404,path);
 }
 assert.equal((await fetch(server.baseUrl+'/api/central-drive-sync',{method:'POST',headers:{Cookie:cookie}})).status,401);
 assert.equal((await fetch(server.baseUrl+'/api/central-drive-sync',{method:'POST',headers:{'x-cron-key':'synthetic-archive-cron'}})).status,202);
 const db=new DatabaseSync(server.dbPath,{readOnly:true});assert.equal(db.prepare('SELECT count(*) n FROM lesson_materials').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM lessons').get().n,1);db.close();
});
