import {test} from 'node:test';import assert from 'node:assert/strict';
import {teachingFixture} from '../teaching-fixture.mjs';
import * as prep from '../../src/lib/server/lesson/prep.ts';
import {publicExperience} from '../../src/lib/learning/model.ts';
test('a coherent full lesson validates at every booking duration',async()=>{
 const m=await import('../../src/lib/learning/teaching.ts').catch(()=>null);
 assert.ok(m,'shared teaching validator exists');
 for(const duration of [45,90,135]){const p=teachingFixture(duration);assert.deepEqual(m.teachingProblems(p.teaching,p,p.teaching.context),[]);}
});
test('invalid timings and missing activities are held rather than treated as complete',async()=>{
 const {teachingProblems}=await import('../../src/lib/learning/teaching.ts');
 const p=teachingFixture(90);p.teaching.agenda[0].minutes--;
 assert.ok(teachingProblems(p.teaching,p).some(e=>e.includes('זמן')));
 p.teaching.agenda[0].ref='missing';assert.ok(teachingProblems(p.teaching,p).some(e=>e.includes('הפניה')));
});
test('written reasoning cannot be claimed as automatically graded',async()=>{
 const {teachingProblems}=await import('../../src/lib/learning/teaching.ts');const p=teachingFixture();
 p.teaching.practice.find(a=>a.ref==='homework-2').grading='checked';
 assert.ok(teachingProblems(p.teaching,p).some(e=>e.includes('בדיקה')));
});
test('public projection contains only the agenda and excludes private history and solutions',async()=>{
 const {publicTeaching}=await import('../../src/lib/learning/teaching.ts');const p=teachingFixture();p.teaching.context.history=[{kind:'taught',topic:'PrivateHistory',summary:'פרטי',at:'2026-01-01',independent:false}];
 const json=JSON.stringify(publicTeaching(p.teaching));assert.ok(!json.includes('PrivateHistory'));assert.ok(!json.includes('context'));assert.equal(publicTeaching(p.teaching).durationMin,45);
 assert.ok(!JSON.stringify(publicExperience(p.learning)).includes('PrivateSolution'));
});
test('the real generation boundary attaches authoritative context and requires the full candidate contract',async()=>{
 const {generatedPlanStub}=await import('../generated-plan-stub.mjs');const saved=process.env.LESSON_GENERATION_VERSION;process.env.LESSON_GENERATION_VERSION='2';
 try{
  const p=teachingFixture();const context={...p.teaching.context,request:'הבקשה האמיתית',history:[]};
  const {result}=await generatedPlanStub(p,{request:{teachingContext:context,durationMin:45}});
  assert.deepEqual(result.teaching.context,context);
  delete p.teaching;await assert.rejects(generatedPlanStub(p),e=>e.kind==='bad-output');
 }finally{if(saved===undefined)delete process.env.LESSON_GENERATION_VERSION;else process.env.LESSON_GENERATION_VERSION=saved;}
});
test('malformed nested content returns validation errors instead of crashing',async()=>{
 const {teachingProblems}=await import('../../src/lib/learning/teaching.ts');
 for(const field of ['objectives','agenda','practice','branches','sources']){const p=teachingFixture();p.teaching[field]=[null];assert.doesNotThrow(()=>teachingProblems(p.teaching,p));assert.ok(teachingProblems(p.teaching,p).length);}
});
test('the teaching guide includes the pacing, misconception and transition',async()=>{
 const {renderPresenterNotes}=await import('../../src/lib/server/presenter-notes.ts');const p=teachingFixture();
 const html=renderPresenterNotes(p.learning,'test');assert.ok(html.includes('בלבול בין הזזה לפתיחה'));assert.ok(html.includes('נעבור לבדוק דוגמה חדשה'));assert.match(html,/4 דקות/);
});
test('malformed optional extended notes and incomplete bundles are rejected safely',async()=>{
 const {learningProblems}=await import('../../src/lib/learning/model.ts');
 const {teachingProblems}=await import('../../src/lib/learning/teaching.ts');
 const p=teachingFixture();p.learning.scenes[0].presenterNotes.sources='not-an-array';
 assert.ok(learningProblems(p.learning).length);
 assert.doesNotThrow(()=>teachingProblems(p.teaching,{learning:p.learning,games:{}}));
 assert.ok(teachingProblems(p.teaching,{learning:p.learning,games:{}}).length);
});
