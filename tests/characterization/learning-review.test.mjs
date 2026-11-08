import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import corpus from '../../src/lib/server/learning-review-corpus.json' with { type:'json' };
import { startServer, login } from './harness.mjs';
import { seedLearning } from './learning-fixture.mjs';
import { TEMPLATE_FILES } from '../../src/lib/server/lesson/prep.ts';

const tables=['lessons','lesson_materials','library_items','library_uses','lesson_game_assignments','learning_assignments','learning_progress','learning_events','results_v2'];
export function reviewCounts(path) {
  const db=new DatabaseSync(path);try{return Object.fromEntries(tables.map(table=>[table,db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n]));}finally{db.close();}
}
test('ten review bundles are tutor-only, private, playable and isolated from customer materials',async()=>{
  assert.equal(corpus.cases.length,10);
  assert.equal(corpus.manifest.syntheticOnly,true);
  assert.equal(corpus.manifest.approval,'needs-human-review');
  for(const item of corpus.cases){
    const metadata=corpus.manifest.cases.find(c=>c.brief.id===item.brief.id);
    assert.equal(createHash('sha256').update(JSON.stringify(item.plan,null,2)+'\n').digest('hex'),metadata.planSha256,'packaged plans retain their original generated checksum');
  }
  const server=await startServer();try{
    const tutor=await login(server.baseUrl),pupil=await seedLearning(server);
    const get=(path,cookie=tutor)=>fetch(server.baseUrl+path,{headers:cookie?{Cookie:cookie}:{},redirect:'manual'});
    const before=reviewCounts(server.dbPath);
    const paths=['/app/learning-review'];
    for(const item of corpus.cases){
      const id=item.brief.id;
      paths.push(...['lesson','presenter','homework','quality'].map(view=>`/app/learning-review?case=${id}&view=${view}`));
      for(const [key,body]of Object.entries(item.plan.games))if(body)paths.push(`/app/review-game/${id}/${TEMPLATE_FILES[key]}`);
    }
    for(const path of paths){
      for(const cookie of ['',pupil.cookie])assert.equal((await get(path,cookie)).status,302,`must require tutor ${path}`);
      const response=await get(path);assert.equal(response.status,200,path);
      assert.match(response.headers.get('cache-control'),/private, no-store/);
      assert.match(response.headers.get('x-robots-tag'),/noindex/);
      const html=await response.text();
      if(path.includes('view=lesson')){
        assert.ok(!html.includes('presenterNotes'),'notes absent from student/projector data');
        assert.ok(!html.includes('"slug":"'),'no real learning slug');
      }
      if(path.includes('view=presenter'))assert.match(html,/view=lesson#scene=/,'projection goes to matching review sample');
    }
    assert.equal((await get('/app/learning-review?case=../../private')).status,404);
    assert.equal((await get('/app/learning-review?case=01-fractions&view=unknown')).status,404);
    assert.equal((await get('/app/review-game/01-fractions/unknown')).status,404);
    assert.deepEqual(reviewCounts(server.dbPath),before,'review GETs must not create reusable masters, assignments, scores or progress');
  }finally{await server.stop();}
});
