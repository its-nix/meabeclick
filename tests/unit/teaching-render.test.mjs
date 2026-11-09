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
test('contradictory guided metadata cannot expose a protected challenge on paper',async()=>{
 const {teachingDisplay}=await import('../../src/lib/server/teaching-display.ts'),p=teachingFixture(),s=p.learning.scenes.find(s=>s.id==='independent');
 Object.assign(s,{visual:'geometry',frames:[{values:[4,3,4,5],tex:'V=?',caption:'חשבו את נפח התיבה מן הנתונים.'}]});s.check.answer=60;
 p.teaching.practice.find(a=>a.asset==='scene'&&a.ref===s.id).support='guided';
 const html=renderLearningDocument(p.learning,{slug:'example',teaching:teachingDisplay(p,'example')});assert.ok(!html.split('<div class="print-pages">')[1].includes(mathFormula(formulaForVisual('geometry',[4,3,4,5]))));
});
test('v2 generation refuses a false equality between an amount and a percentage',async()=>{
 const {teachingProblems}=await import('../../src/lib/learning/teaching.ts'),p=teachingFixture(),frame=p.learning.scenes[0].frames[0];
 frame.tex='200=100\\%';assert.ok(teachingProblems(p.teaching,p).some(e=>e.includes('אחוז')));
 frame.tex='100\\%=200';assert.ok(teachingProblems(p.teaching,p).some(e=>e.includes('אחוז')));
 frame.tex='1=100\\%';assert.deepEqual(teachingProblems(p.teaching,p),[]);
 frame.tex='15\\%=0.15';assert.deepEqual(teachingProblems(p.teaching,p),[]);
});
test('interactive and printed checked homework retain the shared problem givens',async()=>{
 const {homeworkExperience}=await import('../../src/lib/server/teaching-display.ts'),p=teachingFixture();
 p.homework[0].task='הטמפרטורה התחילה במינוס ארבע מעלות ועלתה בשש מעלות.';p.homework[0].check.question='מהי הטמפרטורה החדשה?';
 const html=renderLearningDocument(homeworkExperience(p),{slug:'example',variant:'homework'});
 assert.match(html,/<p[^>]*data-homework-stimulus[^>]*>הטמפרטורה התחילה/);assert.ok(html.split('<div class="print-pages">')[1].includes(p.homework[0].task));
});
test('normal teaching frames must describe the plotted cumulative boundary',async()=>{
 const{teachingProblems}=await import('../../src/lib/learning/teaching.ts'),p=teachingFixture(),s=p.learning.scenes[0];Object.assign(s,{visual:'normal-school',frames:[{values:[70,10,40,75],tex:'P(X<70)\\approx50\\%',caption:'עד הממוצע'}]});
 assert.ok(teachingProblems(p.teaching,p).some(e=>e.includes('גבול ההסתברות')));s.frames[0].values[3]=70;assert.deepEqual(teachingProblems(p.teaching,p),[]);
});
