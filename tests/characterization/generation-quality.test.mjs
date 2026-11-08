import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {startServer,login} from './harness.mjs';
import {seedLearning} from './learning-fixture.mjs';

test('generation assessment is tutor-only and distinguishes edited drafts from the assessed publication',async()=>{
 const server=await startServer();
 try {
  const tutor=await login(server.baseUrl),pupil=await seedLearning(server);
  const db=new DatabaseSync(server.dbPath);
  try {
   const plan=JSON.parse(db.prepare("SELECT content FROM lesson_materials WHERE lesson_slug=? AND kind='plan'").get(pupil.slug).content);
   const report={version:1,scope:'generation-snapshot',status:'passed',at:new Date().toISOString(),engine:'synthetic',model:'synthetic',attempts:[{
    candidateHash:createHash('sha256').update(JSON.stringify(plan)).digest('hex'),issues:[],critique:'passed',checks:[{path:'learning.scenes[0]',math:'pass',answerKey:'pass',context:'pass',teaching:'pass',explanation:'PRIVATE_SYNTHETIC_ASSESSMENT'}],
   }]};
   db.prepare('INSERT INTO lesson_generation_quality(lesson_slug,at,report) VALUES(?,?,?)').run(pupil.slug,report.at,JSON.stringify(report));
   const get=(slug,cookie)=>fetch(`${server.baseUrl}/api/lessons/${slug}/quality`,{headers:cookie?{Cookie:cookie}:{},redirect:'manual'});
   for(const cookie of ['',pupil.cookie]){
    const response=await get(pupil.slug,cookie);
    assert.equal(response.status,401);
    assert.ok(!(await response.text()).includes('PRIVATE_SYNTHETIC_ASSESSMENT'));
   }
   assert.equal((await get('missing-synthetic-lesson',tutor)).status,404);
   let response=await get(pupil.slug,tutor);
   assert.match(response.headers.get('cache-control'),/no-store/);
   assert.deepEqual(await response.json(),{report,matchesLatestDraft:true,matchesPublished:true});
   const edited={...plan,title:'Synthetic tutor edit'};
   db.prepare("INSERT INTO lesson_materials(lesson_slug,kind,version,content,origin,created_at) VALUES(?,'plan',2,?,'edited',?)").run(pupil.slug,JSON.stringify(edited),report.at);
   response=await get(pupil.slug,tutor);
   assert.deepEqual(await response.json(),{report,matchesLatestDraft:false,matchesPublished:true});
   db.prepare("UPDATE lesson_materials SET published_at=? WHERE lesson_slug=? AND version=2").run(report.at,pupil.slug);
   response=await get(pupil.slug,tutor);
   assert.deepEqual(await response.json(),{report,matchesLatestDraft:false,matchesPublished:false});
   assert.equal(db.prepare('SELECT count(*) AS n FROM lesson_generation_quality').get().n,1,'reads and tutor edits never rewrite the assessment');
  } finally {db.close();}
 } finally {await server.stop();}
});
