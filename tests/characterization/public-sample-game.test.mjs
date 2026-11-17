import {test} from 'node:test';import assert from 'node:assert/strict';
import {startServer} from './harness.mjs';import {DatabaseSync} from 'node:sqlite';
import sample from '../../src/lib/server/native-learning/public-sample.json' with {type:'json'};

const counts=path=>{const db=new DatabaseSync(path);try{return ['native_results','native_games'].map(t=>{try{return db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n;}catch{return -1;}});}finally{db.close();}};
const post=(base,cookie,body)=>fetch(base+'/api/sample-game',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});

test('the public sample quiz plays without login, grades on the server and writes nothing',async()=>{
 const server=await startServer();try{
  const before=counts(server.dbPath);
  const get=await fetch(server.baseUrl+'/sample-game',{redirect:'manual'});
  assert.equal(get.status,200);
  const cookie=get.headers.get('set-cookie').split(';')[0];
  const html=await get.text();
  assert.match(html,/<html lang="he" dir="rtl"/);assert.match(html,/width=device-width/);
  assert.match(html,/חידון פרבולות/);
  for(const secret of ['"answer"','המקדם של \\\\(x^2\\\\) שלילי','presenterNotes'])assert.ok(!html.includes(secret),secret);
  const version=/"version":"([0-9a-f]{64})"/.exec(html)?.[1];assert.ok(version);
  const round=sample.games[0].rounds;
  const act=(r,action,input,eventId)=>post(server.baseUrl,cookie,{version,taskId:r.id,action,input,eventId});
  assert.equal((await act(round[0],'hint',null,'e0')).status,409,'no help before an attempt');
  assert.equal((await (await act(round[0],'attempt',1,'e1')).json()).correct,false);
  assert.equal((await (await act(round[0],'attempt',round[0].check.answer,'e2')).json()).correct,true);
  assert.equal((await (await act(round[2],'attempt',3,'e3')).json()).correct,true);
  assert.equal((await post(server.baseUrl,'',{version,taskId:round[0].id,action:'attempt',input:0,eventId:'e4'})).status,409,'a session is required');
  assert.equal((await post(server.baseUrl,cookie,{version:'x',taskId:round[0].id,action:'attempt',input:0,eventId:'e5'})).status,409);
  assert.deepEqual(counts(server.dbPath),before,'no student results or approvals are written');
  assert.equal((await fetch(server.baseUrl+'/learn/parabolas',{redirect:'manual'})).status,404,'the old sample is gone');
 }finally{await server.stop();}
});
