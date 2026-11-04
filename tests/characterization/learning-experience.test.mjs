import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { startServer, login } from './harness.mjs';
import { seedLearning } from './learning-fixture.mjs';

test('assigned learning enforces family scope, server grading, idempotency and versioned progress', async () => {
  const server=await startServer();
  try {
    const one=await seedLearning(server,'one'), two=await seedLearning(server,'two');
    const api=`${server.baseUrl}/api/learning/${one.slug}`;
    assert.equal((await fetch(api)).status,401);
    assert.equal((await fetch(api,{headers:{Cookie:two.cookie}})).status,401);
    assert.equal((await fetch(`${server.baseUrl}/app/learn/${one.slug}`,{headers:{Cookie:two.cookie}})).status,404);
    const page=await fetch(`${server.baseUrl}/app/learn/${one.slug}`,{headers:{Cookie:one.cookie}});
    assert.equal(page.status,200);
    const payload=JSON.parse((await page.text()).match(/<script id="learning-data" type="application\/json">(.*?)<\/script>/s)[1]);
    assert.equal(payload.demoChecks,undefined);
    assert.equal(payload.experience.scenes.find(s=>s.id==='independent').check.answer,undefined);
    assert.equal((await fetch(`${server.baseUrl}/app/learn/${one.slug}?solutions=1`,{headers:{Cookie:one.cookie}})).status,403);
    const state=await (await fetch(api,{headers:{Cookie:one.cookie}})).json();
    const post=body=>fetch(api,{method:'POST',headers:{Cookie:one.cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});
    const base={fingerprint:state.fingerprint,sceneId:'independent',action:'answer'};
    const wrong=await (await post({...base,id:randomUUID(),value:-4})).json();
    assert.equal(wrong.correct,false);
    const event={...base,id:randomUUID(),value:'8/2'};
    const correct=await (await post(event)).json();
    assert.equal(correct.correct,true);
    assert.equal(correct.progress.independent.attempts,2);
    assert.equal(correct.progress.independent.solved,true);
    const repeat=await (await post(event)).json();
    assert.equal(repeat.progress.independent.attempts,2);
    const other=await (await fetch(`${server.baseUrl}/api/learning/${two.slug}`,{headers:{Cookie:two.cookie}})).json();
    assert.deepEqual(other.progress,{});
    assert.equal((await post({...base,id:randomUUID(),fingerprint:'old',value:4})).status,409);
    assert.equal((await post({...base,id:randomUUID(),sceneId:'missing',value:4})).status,400);
    const tutor=await login(server.baseUrl);
    const preview=await fetch(api,{method:'POST',headers:{Cookie:tutor,'Content-Type':'application/json'},body:JSON.stringify({...base,id:randomUUID(),value:4})});
    assert.equal(preview.status,403);
    const portal=await (await fetch(`${server.baseUrl}/api/portal/${one.code}`,{headers:{Cookie:one.cookie}})).json();
    assert.equal(portal.learning[0].url,`/app/learn/${one.slug}`);
    assert.equal(portal.learning[0].solved,1);
    const editor=`${server.baseUrl}/api/lessons/${one.slug}/experience`;
    const {PARABOLAS}=await import('../../src/lib/learning/parabolas.ts');
    const revised=structuredClone(PARABOLAS);revised.title='כותרת שנערכה';
    const edit=body=>fetch(editor,{method:'PUT',headers:{Cookie:tutor,'Content-Type':'application/json'},body:JSON.stringify({expectedTarget:one.slug,...body})});
    assert.equal((await fetch(editor,{method:'PUT',headers:{Cookie:one.cookie,'Content-Type':'application/json'},body:JSON.stringify({action:'publish',expectedVersion:1,learning:revised})})).status,401);
    const draft=await(await edit({action:'draft',expectedVersion:1,learning:revised})).json();
    assert.equal(draft.version,2);
    assert.equal(draft.published,false);
    assert.ok(!(await(await fetch(`${server.baseUrl}/app/learn/${one.slug}`,{headers:{Cookie:one.cookie}})).text()).includes('כותרת שנערכה'));
    assert.equal((await edit({action:'publish',expectedVersion:1,learning:revised})).status,409);
    assert.equal((await edit({action:'publish',expectedVersion:2,learning:revised})).status,200);
    const updated=await(await fetch(api,{headers:{Cookie:one.cookie}})).json();
    assert.equal(updated.fingerprint,state.fingerprint);
    assert.equal(updated.progress.independent.solved,true);
    // A newer, unaccepted regeneration must never become the rest of a learning-only edit.
    const db=new DatabaseSync(server.dbPath);
    const current=db.prepare("SELECT * FROM lesson_materials WHERE lesson_slug=? AND kind='plan' ORDER BY version DESC LIMIT 1").get(one.slug);
    const baseline=JSON.parse(current.content);
    const sentinel={...baseline,title:'UNACCEPTED',homework:[{task:'UNACCEPTED'}]};
    db.prepare("INSERT INTO lesson_materials (lesson_slug,kind,version,content,origin,created_at) VALUES (?,'plan',?,?, 'generated',?)").run(one.slug,current.version+1,JSON.stringify(sentinel),new Date().toISOString());
    assert.equal((await edit({action:'publish',expectedVersion:current.version+1,learning:revised})).status,409);
    assert.equal((await edit({action:'publish',expectedVersion:current.version,learning:revised})).status,200);
    const published=JSON.parse(db.prepare("SELECT content FROM lesson_materials WHERE lesson_slug=? AND kind='plan' AND published_at IS NOT NULL ORDER BY version DESC LIMIT 1").get(one.slug).content);
    assert.deepEqual(published.homework,baseline.homework);
    assert.notEqual(published.title,'UNACCEPTED');
    // Existing dashboard presentation links are usable teaching previews, without student writes.
    const presentation=await fetch(`${server.baseUrl}/lessons/${one.slug}`,{headers:{Cookie:tutor}});
    const teaching=JSON.parse((await presentation.text()).match(/<script id="learning-data" type="application\/json">(.*?)<\/script>/s)[1]);
    assert.equal(teaching.demo,true);
    assert.equal(teaching.demoChecks.independent.answer,4);
    assert.match(teaching.storageScope,/^teacher:/);
    db.close();
  } finally {await server.stop();}
});

test('replacement practice stays editable and tutor preview/solutions match the student material',async()=>{
  const server=await startServer();
  try {
    const pupil=await seedLearning(server), tutor=await login(server.baseUrl);
    const {PARABOLAS}=await import('../../src/lib/learning/parabolas.ts');
    const practice={...structuredClone(PARABOLAS),title:'תרגול ממה שנלמד'};
    const target=`${pupil.slug}--practice`,db=new DatabaseSync(server.dbPath),now=new Date().toISOString();
    db.prepare("INSERT INTO lesson_materials (lesson_slug,kind,version,content,origin,published_at,created_at) VALUES (?,'plan',1,?,'generated',?,?)").run(target,JSON.stringify({learning:practice}),now,now);
    db.prepare("UPDATE learning_assignments SET practice_material_slug=? WHERE lesson_slug=?").run(target,pupil.slug);
    const html=async(path,cookie)=>(await fetch(`${server.baseUrl}${path}`,{headers:{Cookie:cookie}})).text();
    for(const [path,cookie] of [[`/app/learn/${pupil.slug}`,pupil.cookie],[`/app/learn/${pupil.slug}?solutions=1`,tutor],[`/lessons/${pupil.slug}`,tutor]]) {
      assert.match(await html(path,cookie),/תרגול ממה שנלמד/);
    }
    assert.match(await html(`/app/lessons/${pupil.slug}/experience`,tutor),/תרגול ממה שנלמד/);
    const edit=body=>fetch(`${server.baseUrl}/api/lessons/${pupil.slug}/experience`,{method:'PUT',headers:{Cookie:tutor,'Content-Type':'application/json'},body:JSON.stringify(body)});
    practice.title='תרגול עם תיקון של המורה';
    assert.equal((await edit({action:'publish',expectedTarget:pupil.slug,expectedVersion:1,learning:practice})).status,409,'a report changing the target invalidates an open editor');
    assert.equal((await edit({action:'draft',expectedTarget:target,expectedVersion:1,learning:practice})).status,200);
    assert.ok(!(await html(`/app/learn/${pupil.slug}`,pupil.cookie)).includes(practice.title));
    assert.equal((await edit({action:'publish',expectedTarget:target,expectedVersion:2,learning:practice})).status,200);
    assert.match(await html(`/app/learn/${pupil.slug}`,pupil.cookie),/תרגול עם תיקון של המורה/);
    assert.match(await html(`/app/learn/${pupil.slug}?solutions=1`,tutor),/תרגול עם תיקון של המורה/);
    assert.equal(JSON.parse(db.prepare("SELECT content FROM lesson_materials WHERE lesson_slug=? AND kind='plan'").get(pupil.slug).content).learning.title,PARABOLAS.title);
    db.close();
  }finally{await server.stop();}
});
