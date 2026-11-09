import '../isolate-lesson-data.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';
test('only the verified catalogue can grant an official source identity',async()=>{
 const m=await import('../../src/lib/server/lesson/official-questions.ts').catch(()=>null);assert.ok(m,'catalogue exists');
 const context={request:'שטח אינטגרל פולינום',skill:'אינטגרלים',grade:'כיתה יב',track:'5 יח״ל',curriculum:'math-5u',questionnaire:'35571',durationMin:90,history:[]};
 const found=m.resolveOfficialQuestions(context);assert.equal(found.status,'verified');assert.equal(found.questions.length,1);
 const q=found.questions[0];assert.match(q.transcript,/x\^4/);assert.equal(q.kind,'adapted');assert.equal(q.answer,'1/30');
 assert.equal(m.resolveOfficialQuestions({...context,track:'4 יח״ל',questionnaire:'35471'}).status,'authored-fallback');
 assert.equal(m.resolveOfficialQuestions(context,{requiredQuestionId:'forged'}).status,'unresolved');
 assert.equal(m.resolveOfficialQuestions(context,{usedQuestionIds:[q.id]}).status,'authored-fallback');
 assert.equal(m.officialQuestion('../x'),null);assert.equal(m.officialQuestion('https://evil.test'),null);
 const forged={...q,id:'forged',verified:true};assert.throws(()=>m.verifyImport(forged,Buffer.from('%PDF-changed')),/hash|verification/i);
 assert.throws(()=>m.verifyImport({...q,crop:[-1,0,100,100]},Buffer.from('%PDF-changed')),/crop/i);
 assert.throws(()=>m.verifyImport(q,Buffer.from('%PDF-changed')),/hash/i);
 // Exact antiderivative, computed independently of catalogue answer text.
 assert.ok(Math.abs((0-((-1)**6/6+(-1)**5/5))-1/30)<1e-14);
});
test('a mandatory unresolved source stops before consuming any model call',async()=>{
 const {generateLesson}=await import('../../src/lib/server/lesson/prep.ts');const saved=process.env.LESSON_GENERATION_VERSION;
 try{process.env.LESSON_GENERATION_VERSION='2';await assert.rejects(generateLesson({subject:'מתמטיקה',level:'כיתה יב',teachingContext:{request:'שאלה נתונה',skill:'אינטגרלים',durationMin:45,history:[],requiredQuestionId:'unknown'}}),e=>e.kind==='source-unresolved');}
 finally{if(saved===undefined)delete process.env.LESSON_GENERATION_VERSION;else process.env.LESSON_GENERATION_VERSION=saved;}
});
