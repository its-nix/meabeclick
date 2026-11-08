import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {generationPlan,passingCritique} from '../helpers/generation-plan.mjs';
import {getGenerationQualityReport} from '../../src/lib/server/lesson/quality.ts';
process.env.DATA_DIR = await mkdtemp(join(tmpdir(),'quality-db-'));
process.env.DB_PATH = join(process.env.DATA_DIR,'results.db');
process.env.SESSION_SECRET='synthetic-quality-test-secret';
const {generateLesson}=await import('../../src/lib/server/lesson/prep.ts');
const {messageForFailure}=await import('../../src/lib/server/lesson/queue.ts');

async function engine(replies,fn) {
 const dir=await mkdtemp(join(tmpdir(),'quality-stub-'));
 const script=join(dir,'engine');
 await writeFile(script,`#!/usr/bin/env node\nimport fs from 'node:fs';\nconst dir=${JSON.stringify(dir)};const replies=${JSON.stringify(replies)};\nlet prompt='';for await(const chunk of process.stdin)prompt+=chunk;\nconst calls=fs.existsSync(dir+'/calls.json')?JSON.parse(fs.readFileSync(dir+'/calls.json')):[];calls.push(prompt);fs.writeFileSync(dir+'/calls.json',JSON.stringify(calls));\nconst reply=replies[calls.length-1];if(reply?.hang)await new Promise(resolve=>setTimeout(resolve,5000));if(reply?.error){process.stderr.write(reply.error);process.exit(1)}\nconst out=process.argv[process.argv.indexOf('-o')+1];if(reply!==undefined)fs.writeFileSync(out,typeof reply==='string'?reply:JSON.stringify(reply));`,{mode:0o755});
 // Extensionless stubs are shell-neutral CommonJS, with dynamic import for stdin.
 await writeFile(script,(await readFile(script,'utf8')).replace("import fs from 'node:fs';","const fs = require('node:fs');\n(async()=>{")+ '\n})();');
 const saved=process.env.CODEX_BIN;process.env.CODEX_BIN=script;
 try{return await fn(async()=>JSON.parse(await readFile(join(dir,'calls.json'),'utf8')));}finally{if(saved===undefined)delete process.env.CODEX_BIN;else process.env.CODEX_BIN=saved;}
}
const req={subject:'מתמטיקה',level:'כיתה ט',skill:'פרבולות'};
test('semantic failure repairs the exact rejected candidate and retains private scene reports',async()=>{
 const rejected=generationPlan();rejected.homework[0].answer='27';
 const fixed=generationPlan();const bad=passingCritique(rejected);bad.checks.find(c=>c.path==='homework[0]').answerKey='fail';bad.checks.find(c=>c.path==='homework[0]').explanation='3² = 9, but the key says 27.';
 await engine([rejected,bad,fixed,passingCritique(fixed)],async calls=>{
  const plan=await generateLesson(req);assert.equal(plan.homework[0].answer,'9');
  const prompts=await calls();assert.equal(prompts.length,4);assert.ok(prompts[2].includes('3² = 9, but the key says 27.'));assert.ok(prompts[2].includes('"answer":"27"'));
  const {getGenerationQualityReport}=await import('../../src/lib/server/lesson/quality.ts');const report=getGenerationQualityReport(plan);
  assert.equal(report.status,'passed');assert.equal(report.attempts.length,2);assert.equal(report.attempts[0].issues[0].path,'homework[0]');assert.ok(report.attempts[1].candidateHash);
  assert.ok(!JSON.stringify(plan).includes('3² = 9, but the key says 27.'));assert.ok(!JSON.stringify(plan).includes('candidateHash'));
 });
});

test('exhausted semantic repair fails with both reports and no public diagnostics',async()=>{
 const plan=generationPlan(),bad=passingCritique(plan);bad.checks[0].teaching='fail';bad.checks[0].explanation='PRIVATE_MODEL_EXPLANATION';
 await engine([plan,bad,plan,bad],async calls=>{
  await assert.rejects(generateLesson(req),error=>{
   assert.equal(getGenerationQualityReport(error).status,'failed');assert.equal(getGenerationQualityReport(error).attempts.length,2);
   assert.ok(!messageForFailure(error).includes('PRIVATE_MODEL_EXPLANATION'));return true;
  });assert.equal((await calls()).length,4);
 });
});
test('a malformed or ungrounded critique cannot approve or spend a repair',async()=>{
 const plan=generationPlan();
 for(const bad of [{checks:[]},{checks:[{path:'invented-artifact',math:'pass'}]},passingCritique(plan).checks,{checks:passingCritique(plan).checks.map((c,i)=>i?c:{...c,math:'maybe'})}]){
  await engine([plan,bad],async calls=>{await assert.rejects(generateLesson(req),error=>error.kind==='bad-output');assert.equal((await calls()).length,2);});
 }
});
test('critic engine faults stop immediately and retain the failed assessment',async()=>{
 const plan=generationPlan();
 for (const [message,kind] of [['Not logged in','engine-auth'],["You have hit your usage limit",'engine-quota'],['Something broke','engine-failed']]) {
  await engine([plan,{error:message}],async calls=>{
   await assert.rejects(generateLesson(req),error=>{assert.equal(error.kind,kind);assert.equal(getGenerationQualityReport(error).attempts[0].critique,'engine-failed');return true;});assert.equal((await calls()).length,2);
  });
 }
});
test('mechanical quality failure uses the rejected candidate and exact artifact without critiquing broken output',async()=>{
 const plan=generationPlan(),broken=generationPlan();broken.examples[0].steps=['4'];
 await engine([broken,plan,passingCritique(plan)],async calls=>{
  await generateLesson(req);const prompts=await calls();assert.equal(prompts.length,3);assert.ok(prompts[1].includes('examples[0]'));assert.ok(prompts[1].includes('intermediate steps'));assert.ok(prompts[1].includes('rejectedCandidate'));
 });
});

test('generation publishes a report callback on success and on engine failure',async()=>{
 const plan=generationPlan();
 for(const [replies,passes] of [[[plan,passingCritique(plan)],true],[[{error:'Not logged in'}],false]]){
  let report=null;
  await engine(replies,async()=>{
   const generated=generateLesson(req,{onQualityReport:value=>{report=value;}});
   if(passes)await generated;else await assert.rejects(generated);
   assert.equal(report?.status,passes?'passed':'failed');assert.equal(report.attempts.length,1);
  });
 }
});
test('invalid nested model types are classified and repaired with exact structural paths',async()=>{
 const broken=generationPlan();broken.games.memory.pairs='bad-type';const fixed=generationPlan();
 await engine([broken,fixed,passingCritique(fixed)],async calls=>{
  await generateLesson(req);const prompts=await calls();assert.equal(prompts.length,3);assert.ok(prompts[1].includes('games.memory.pairs'));
 });
});

test('fresh library preparation privately persists passing and exhausted reports without changing customer material',async()=>{
 const {prepareSkill}=await import('../../src/lib/server/library/prepare.ts');
 const {latestGenerationQualityReport}=await import('../../src/lib/server/lesson/quality-store.ts');
 const {latestPublished,addMaterial}=await import('../../src/lib/server/materials.ts');
 const {candidateHash}=await import('../../src/lib/server/lesson/quality.ts');
 const plan=generationPlan();
 await engine([plan,passingCritique(plan)],async()=>{
  const item=await prepareSkill('math-8','alg.eq.word');assert.equal(item.status,'ready');
  const report=latestGenerationQualityReport(item.slug);assert.equal(report.status,'passed');assert.equal(report.attempts[0].checks.length,passingCritique(plan).checks.length);
  const material=latestPublished(item.slug,'plan');assert.ok(!material.content.includes('candidateHash'));assert.equal(report.attempts.at(-1).candidateHash,candidateHash(JSON.parse(material.content)));
  const edited=JSON.parse(material.content);edited.homework[0].answer='tutor edit';
  addMaterial({slug:item.slug,kind:'plan',content:JSON.stringify(edited),origin:'edited',publish:true});
  assert.notEqual(report.attempts.at(-1).candidateHash,candidateHash(edited));assert.deepEqual(latestGenerationQualityReport(item.slug),report,'an edit never rewrites the generation assessment');
 });
 const bad=passingCritique(plan);bad.checks[0].math='fail';bad.checks[0].explanation='PRIVATE_FAILURE_EXPLANATION';
 await engine([plan,bad,plan,bad],async()=>{
  const item=await prepareSkill('math-8','alg.eq.ineq');assert.equal(item.status,'failed');assert.ok(!JSON.stringify(item).includes('PRIVATE_FAILURE_EXPLANATION'));assert.equal(latestPublished(item.slug,'plan'),null);
  const report=latestGenerationQualityReport(item.slug);assert.equal(report.status,'failed');assert.equal(report.attempts.length,2);assert.equal(report.attempts[1].issues[0].message,'PRIVATE_FAILURE_EXPLANATION');
 });
});

test('a critique timeout is not retried or published',async()=>{
 const saved=process.env.LESSON_TIMEOUT_MINUTES;
 // Allow stub startup under parallel CI; only the five-second critic hang exceeds this budget.
 process.env.LESSON_TIMEOUT_MINUTES='0.05';
 try {
  const plan=generationPlan();
  await engine([plan,{hang:true}],async calls=>{
   await assert.rejects(generateLesson(req),error=>{assert.equal(error.kind,'engine-timeout');assert.equal(getGenerationQualityReport(error).attempts[0].critique,'engine-failed');return true;});
   assert.equal((await calls()).length,2);
  });
 }finally{if(saved===undefined)delete process.env.LESSON_TIMEOUT_MINUTES;else process.env.LESSON_TIMEOUT_MINUTES=saved;}
});
