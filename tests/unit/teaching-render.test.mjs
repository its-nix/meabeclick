import '../isolate-lesson-data.mjs';import{test}from'node:test';import assert from'node:assert/strict';import{teachingFixture}from'../teaching-fixture.mjs';
import{renderLearningDocument,learningFingerprint}from'../../src/lib/server/learning-render.ts';
test('full lesson agenda shows all assets without private teaching context or keys',async()=>{
 const {teachingDisplay,homeworkExperience}=await import('../../src/lib/server/teaching-display.ts').catch(()=>({}));assert.ok(teachingDisplay);
 const p=teachingFixture();const html=renderLearningDocument(p.learning,{slug:'example',teaching:teachingDisplay(p,'example',{gameUrls:{quiz:'/app/play/quiz?synthetic=1',memory:'/app/play/memory?synthetic=1'}})});
 assert.match(html,/data-agenda/);assert.match(html,/45 דקות/);assert.match(html,/\/homework/);assert.match(html,/\/app\/play\//);
 for(const secret of ['PrivateSolution','PrivatePreference','"answer":','"context":','presenterNotes'])assert.ok(!html.includes(secret));
 const hw=homeworkExperience(p);const doc=renderLearningDocument(hw,{slug:'example',variant:'homework'});assert.match(doc,/לבדיקת מורה/);assert.match(doc,/data-reasoning/);assert.ok(!doc.includes('PrivateSolution'));
 const revised=structuredClone(p.learning);revised.scenes[0].presenterNotes.explanation='new guide';assert.equal(learningFingerprint(revised),learningFingerprint(p.learning));
});
