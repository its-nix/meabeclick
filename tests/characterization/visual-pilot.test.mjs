import {test} from 'node:test';import assert from 'node:assert/strict';
import {startServer,login} from './harness.mjs';import {DatabaseSync} from 'node:sqlite';
import corpus from '../../src/lib/server/learning-pilot-corpus.json' with {type:'json'};
function reviewCounts(path){const db=new DatabaseSync(path);try{return ['lessons','lesson_materials','learning_assignments','native_results'].map(t=>db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n);}finally{db.close();}}
test('native review activities and checking stay tutor-only and never write customer evidence',async()=>{
 const server=await startServer();try{
  const cookie=await login(server.baseUrl),before=reviewCounts(server.dbPath);
  assert.equal((await fetch(server.baseUrl+'/app/native-review-activities',{redirect:'manual'})).status,302);
  assert.equal((await fetch(server.baseUrl+'/api/learning-pilot',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
  assert.equal((await fetch(server.baseUrl+'/app/learning-pilot',{headers:{Cookie:cookie}})).status,404,'the old pilot lesson page is gone');
  const get=await fetch(server.baseUrl+'/app/native-review-activities?view=homework',{headers:{Cookie:cookie}});
  if(corpus.manifest.status!=='ready'){assert.equal(get.status,503);return;}
  assert.equal(get.status,200);assert.match(get.headers.get('cache-control'),/private, no-store/);
  const preview=get.headers.get('set-cookie').split(';')[0],auth=cookie+'; '+preview;
  const homework=await get.text();assert.ok(!homework.includes('presenterNotes'));assert.ok(!homework.includes('"answer"'));
  const game=corpus.bundle.games[0],played=await fetch(server.baseUrl+'/app/native-review-activities?view=game&game='+game.id,{headers:{Cookie:auth}});assert.equal(played.status,200);assert.match(played.headers.get('x-robots-tag'),/noindex/);
  for(const view of ['presenter','lesson','unknown'])assert.equal((await fetch(server.baseUrl+'/app/native-review-activities?view='+view,{headers:{Cookie:auth}})).status,404,view);
  const task=corpus.bundle.homework.find(t=>t.check?.kind==='number');
  const post=(action,input,eventId)=>fetch(server.baseUrl+'/api/learning-pilot',{method:'POST',headers:{Cookie:auth,'Content-Type':'application/json'},body:JSON.stringify({version:corpus.manifest.bundleSha256,taskId:task.id,action,input,eventId})});
  assert.equal((await post('solution',null,'before')).status,409);
  const attempt=await post('attempt',task.check.answer,'try1');assert.equal(attempt.status,200);assert.equal((await attempt.json()).independent,task.support==='independent');
  assert.equal((await post('solution',null,'after')).status,200);
  assert.deepEqual(reviewCounts(server.dbPath),before);
 }finally{await server.stop();}
});
