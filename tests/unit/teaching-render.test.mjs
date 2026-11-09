import '../isolate-lesson-data.mjs';import{test}from'node:test';import assert from'node:assert/strict';import{teachingFixture}from'../teaching-fixture.mjs';
import{renderLearningDocument,learningFingerprint}from'../../src/lib/server/learning-render.ts';
import{mathFormula}from'../../src/lib/learning/math.ts';import{formulaForVisual}from'../../src/lib/learning/visual.ts';
test('full lesson agenda shows all assets without private teaching context or keys',async()=>{
 const {teachingDisplay,homeworkExperience}=await import('../../src/lib/server/teaching-display.ts').catch(()=>({}));assert.ok(teachingDisplay);
 const p=teachingFixture();const html=renderLearningDocument(p.learning,{slug:'example',teaching:teachingDisplay(p,'example',{gameUrls:{quiz:'/app/play/quiz?synthetic=1',memory:'/app/play/memory?synthetic=1'}})});
 assert.match(html,/data-agenda/);assert.match(html,/45 דקות/);assert.match(html,/\/homework/);assert.match(html,/\/app\/play\//);
 for(const secret of ['PrivateSolution','PrivatePreference','"answer":','"context":','presenterNotes'])assert.ok(!html.includes(secret));
 const hw=homeworkExperience(p);const doc=renderLearningDocument(hw,{slug:'example',variant:'homework'});assert.match(doc,/לבדיקת מורה/);assert.match(doc,/data-reasoning/);assert.ok(!doc.includes('PrivateSolution'));
 const revised=structuredClone(p.learning);revised.scenes[0].presenterNotes.explanation='new guide';assert.equal(learningFingerprint(revised),learningFingerprint(p.learning));
});
test('independent visual questions show their givens without computing the answer on screen or paper',async()=>{
 const{teachingDisplay}=await import('../../src/lib/server/teaching-display.ts');
 for(const [visual,values,tex,answer]of [['geometry',[4,3,4,5],'V=?',60],['fraction',[1,2,3],'\\frac{1}{2}=\\frac{?}{?}',3],['data-bars',[1,2,3,4],'N=?',10],['normal',[70,10,60,80],'P=?',68.27],['normal-school',[70,10,60,80],'P=?',68]]){
  const p=teachingFixture(),s=p.learning.scenes.find(s=>s.id==='independent');Object.assign(s,{visual,frames:[{values,tex,caption:'השתמשו בנתונים ונסו לחשב.'}]});s.check.answer=answer;s.check.question='חשבו את הערך המבוקש מן הנתונים.';
  const html=renderLearningDocument(p.learning,{slug:'example',teaching:teachingDisplay(p,'example')});const section=html.split('data-scene="independent"')[1].split('</section>')[0];
  assert.ok(section.includes(mathFormula(tex)),visual);assert.ok(!section.includes(mathFormula(formulaForVisual(visual,values))),`${visual} must not precompute the answer`);
  const printed=html.split('<div class="print-pages">')[1];assert.ok(!printed.includes(mathFormula(formulaForVisual(visual,values))),`${visual} paper must not precompute the answer`);assert.match(printed,/data-print-plot="independent"/);
  const config=JSON.parse(html.match(/id="learning-data" type="application\/json">(.*?)<\/script>/s)[1]);assert.ok(config.independentSceneIds.includes('independent'));
 }
});
