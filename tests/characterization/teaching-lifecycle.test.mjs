import{test}from'node:test';import assert from'node:assert/strict';import{DatabaseSync}from'node:sqlite';import{randomUUID}from'node:crypto';import{startServer,login}from'./harness.mjs';import{seedLearning}from'./learning-fixture.mjs';import{teachingFixture}from'../teaching-fixture.mjs';
test('solutions require an attempt, are idempotent, and do not count as independent success',async()=>{
 const server=await startServer();try{
 const a=await seedLearning(server),b=await seedLearning(server,'two'),teacher=await login(server.baseUrl),db=new DatabaseSync(server.dbPath),p=teachingFixture();
 db.prepare("UPDATE lesson_materials SET content=? WHERE lesson_slug=? AND kind='plan'").run(JSON.stringify(p),a.slug);db.close();
 const path=`${server.baseUrl}/api/learning/${a.slug}`;const get=()=>fetch(path,{headers:{Cookie:a.cookie}}).then(r=>r.json());const state=await get();
 const post=(action,extra={},cookie=a.cookie)=>fetch(path,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({id:randomUUID(),sceneId:'independent',fingerprint:state.fingerprint,action,...extra})});
 assert.equal((await post('solution')).status,400);assert.equal((await post('answer',{value:-100})).status,200);
 const id=randomUUID();const first=await post('solution',{id});assert.equal(first.status,200);assert.match((await first.json()).solution,/PrivateSolution/);assert.equal((await post('solution',{id})).status,200);
 await post('answer',{value:p.learning.scenes.find(s=>s.id==='independent').check.answer});
 assert.equal((await get()).progress.independent.revealed,true);
 assert.equal((await post('solution',{},teacher)).status,403);assert.equal((await post('solution',{},b.cookie)).status,401);
 const html=await(await fetch(`${server.baseUrl}/app/learn/${a.slug}`,{headers:{Cookie:a.cookie}})).text();assert.ok(!html.includes('PrivateSolution'));
 const hw=await fetch(`${server.baseUrl}/app/learn/${a.slug}/homework`,{headers:{Cookie:a.cookie}});assert.equal(hw.status,200);assert.match(await hw.text(),/לבדיקת מורה/);
 const source=`${server.baseUrl}/app/lessons/${a.slug}/source/moe-2025b-35571-1c2`;assert.equal((await fetch(source,{headers:{Cookie:a.cookie}})).status,404);
 const sourceDb=new DatabaseSync(server.dbPath);p.teaching.sources=[{questionId:'moe-2025b-35571-1c2',kind:'adapted',asset:'homework',ref:'homework-1'}];
 sourceDb.prepare("UPDATE lesson_materials SET content=? WHERE lesson_slug=? AND kind='plan'").run(JSON.stringify(p),a.slug);
 const excerpt=await fetch(source,{headers:{Cookie:a.cookie}});assert.equal(excerpt.status,200);assert.match(excerpt.headers.get('cache-control'),/private, no-store/);
 const safe=await excerpt.json();assert.match(safe.label,/עיבוד/);for(const key of ['answer','verification','documentSha256'])assert.equal(safe[key],undefined);
 assert.equal((await fetch(source,{headers:{Cookie:b.cookie}})).status,404);
 sourceDb.prepare("UPDATE learning_assignments SET practice_state='held',held_until='2099-01-01' WHERE lesson_slug=?").run(a.slug);sourceDb.close();
 assert.equal((await fetch(`${server.baseUrl}/app/learn/${a.slug}/homework`,{headers:{Cookie:a.cookie}})).status,404);
 assert.equal((await fetch(path+'?view=homework',{headers:{Cookie:a.cookie}})).status,404);
 }finally{await server.stop();}
});
