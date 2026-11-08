import { test } from 'node:test';
import assert from 'node:assert/strict';
import { learningProblems, publicExperience, gradeLearningCheck } from '../../src/lib/learning/model.ts';
import { learningFrameAt, formulaForVisual } from '../../src/lib/learning/visual.ts';
import { experienceProblems, renderLearningDocument } from '../../src/lib/server/learning-render.ts';
import { mathFormula } from '../../src/lib/learning/math.ts';

import { numericLesson } from '../fixtures/learning-numeric-visuals.mjs';

test('bounded numeric visual contracts accept reusable scenes and reject invalid parameters',()=>{
  for(const [kind,valid,invalid] of [
    ['fraction-bar',[2,6],[[2.5,6],[7,6],[1,0],[1,25]]],
    ['right-triangle',[3,4],[[0,4],[-3,4],[101,4]]],
    ['function-tangent',[1,0,0,2],[[0,0,0,2],[11,0,0,2],[1,0,0,6],[1,0,100,2]]],
  ]) {
    assert.deepEqual(experienceProblems(numericLesson(kind,valid)),[],kind);
    for(const values of invalid) assert.ok(learningProblems(numericLesson(kind,values)).length,`${kind}: ${values}`);
  }
});
test('new questions require explicit stimulus text and validate its math',()=>{
  const e=numericLesson();delete e.scenes.find(s=>s.check).questionVisual;
  assert.ok(learningProblems(e).some(p=>p.includes('שאלה')));
  const bad=numericLesson();bad.scenes.find(s=>s.check).questionVisual.tex='\\badcommand';
  assert.ok(experienceProblems(bad).some(p=>p.includes('נוסחה')));
});
test('fraction animation keeps partitions integer and frame/formula at the actual shown ratio',()=>{
  const scene=numericLesson().scenes[0];scene.frames.push({values:[2,4],tex:'2/4',caption:'אותו חלק'});
  for(let t=0;t<7;t+=.1) {
    const state=learningFrameAt(scene,t);
    assert.ok(state.values.every(Number.isInteger));
    assert.deepEqual(state.values,scene.frames[state.frame].values);
    assert.equal(state.values[0]/state.values[1],.5);
  }
  assert.equal(formulaForVisual('fraction-bar',[2,4]),'\\frac{2}{4}');
});
test('independent questions and worksheets use stimulus instead of the worked solution',()=>{
  const e=numericLesson('right-triangle',[3,4]);
  for(const s of e.scenes) s.frames[0].tex='z=987';
  const question=e.scenes.find(s=>s.phase==='challenge');
  const html=renderLearningDocument(e);
  const section=html.split(`data-scene="${question.id}"`)[1].split('</section>')[0];
  assert.ok(section.includes(mathFormula('c=?')));
  assert.ok(section.includes('השתמשו בנתונים המסומנים'));
  const worksheet=html.split('<div class="print-pages">')[1];
  assert.ok(worksheet.includes('data-print-plot'));
  assert.ok(!worksheet.includes(mathFormula('z=987')));
  assert.ok(!JSON.stringify(publicExperience(e)).includes('presenterNotes'));
});

test('question solutions never enter public frames or compiled student templates',()=>{
  for(const kind of ['fraction-bar','right-triangle','function-tangent']) {
    const e=numericLesson(kind), question=e.scenes.find(s=>s.phase==='challenge');
    question.frames[0].tex='z=987654';
    question.frames[0].caption='PrivateWorkedSolutionCaption';
    question.check.success='PrivateCorrectExplanation';
    const raw=JSON.stringify(publicExperience(e));
    assert.ok(!raw.includes('987654'),kind);
    assert.ok(!raw.includes('PrivateWorkedSolutionCaption'),kind);
    assert.ok(!raw.includes('PrivateCorrectExplanation'),kind);
    const publicQuestion=publicExperience(e).scenes.find(s=>s.id===question.id);
    assert.equal(publicQuestion.frames[0].tex,question.questionVisual.tex);
    assert.equal(publicQuestion.frames[0].caption,question.questionVisual.caption);
    const html=renderLearningDocument(e,{slug:'synthetic'});
    assert.ok(!html.includes('987654'),kind);
    assert.ok(!html.includes('PrivateWorkedSolutionCaption'),kind);
    assert.ok(!html.includes('PrivateCorrectExplanation'),kind);
    const solutions=renderLearningDocument(e,{solutions:true});
    assert.ok(solutions.includes('PrivateCorrectExplanation'));
    assert.equal(question.frames[0].tex,'z=987654','teacher source remains intact');
  }
});

test('new numeric formulas preserve small supplied values instead of rounding them to zero',()=>{
  assert.deepEqual(experienceProblems(numericLesson('right-triangle',[.004,4])),[]);
  assert.equal(formulaForVisual('right-triangle',[.004,4]),'c^2=0.004^2+4^2');
  assert.equal(formulaForVisual('function-tangent',[.1,.004,.003,.002]),'f(x)=0.1x^2+0.004x+0.003,\\quad x_0=0.002');
  assert.match(formulaForVisual('right-triangle',[1e-7,4]),/10\^\{-7\}/);
  assert.doesNotThrow(()=>mathFormula(formulaForVisual('right-triangle',[1e-7,4])));
  assert.match(formulaForVisual('right-triangle',[1e-7,4]),/\\left\(.*\\right\)\^2/);
});

test('grading releases the useful explanation only after a correct answer and keeps printed questions clean',async()=>{
  const {mkdtempSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const {randomUUID}=await import('node:crypto');
  process.env.DATA_DIR=mkdtempSync(join(tmpdir(),'numeric-question-grading-'));
  process.env.DB_PATH=join(process.env.DATA_DIR,'results.db');
  const entities=await import('../../src/lib/server/entities.ts');
  const {createLesson}=await import('../../src/lib/server/db.ts');
  const {recordLearning}=await import('../../src/lib/server/learning-store.ts');
  const e=numericLesson('right-triangle'),question=e.scenes.find(s=>s.phase==='challenge');
  question.check.success='מחברים 25 ועוד 144 ומקבלים 169. השורש הוא 13.';
  question.frames[0].caption='PrivateWorkedCaptionForThirteen';
  const account=entities.createAccount({name:'משפחה סינתטית',credential:'x',phone:null});
  const student=entities.createStudent({name:'תלמיד סינתטי',code:'numeric-solution-test',accountId:account.id,credential:'x'});
  const slug='numeric-solution-test';
  createLesson({slug,student:student.name,subject:'מתמטיקה',level:'כיתה ט',topic:'משולש ישר זווית',lessonAt:'2098-01-01T10:00:00.000Z'});
  const {learningFingerprint}=await import('../../src/lib/server/learning-render.ts');
  const input={studentId:student.id,slug,fingerprint:learningFingerprint(e),sceneId:question.id,action:'answer',experience:e};
  const wrong=recordLearning({...input,id:randomUUID(),value:12});
  assert.equal(wrong.correct,false);
  assert.equal(wrong.feedback,question.check.retry);
  assert.ok(!JSON.stringify(wrong).includes(question.check.success));
  assert.ok(!JSON.stringify(wrong).includes(question.frames[0].tex));
  const correct=recordLearning({...input,id:randomUUID(),value:13});
  assert.equal(correct.correct,true);
  assert.equal(correct.feedback,question.check.success);
  assert.equal(correct.progress[question.id].solved,true);
  const tiny=numericLesson('function-tangent',[.1,0,0,2e-7]),tinyQuestion=tiny.scenes.find(s=>s.phase==='challenge');
  tinyQuestion.check.answer=4e-8;
  const tinyInput={...input,experience:tiny,fingerprint:learningFingerprint(tiny),sceneId:tinyQuestion.id};
  assert.equal(recordLearning({...tinyInput,id:randomUUID(),value:'0'}).correct,false);
  assert.equal(recordLearning({...tinyInput,id:randomUUID(),value:'0.00000004'}).correct,true);
  const html=renderLearningDocument(e,{slug});
  assert.ok(!html.includes('PrivateWorkedCaptionForThirteen'));
  assert.ok(!html.includes(question.frames[0].tex));
  assert.ok(!html.includes(question.check.success));
  const worksheet=html.split('<div class="print-pages">')[1];
  assert.ok(worksheet.includes(mathFormula(question.questionVisual.tex)));
  assert.ok(!worksheet.includes(mathFormula(question.frames[0].tex)));
});


test('precise numeric grading distinguishes a tiny nonzero slope from zero without changing legacy grading',()=>{
  const check={kind:'number',answer:4e-8};
  assert.equal(gradeLearningCheck(check,'0',{relativeTolerance:true}),false);
  assert.equal(gradeLearningCheck(check,'0.00000004',{relativeTolerance:true}),true);
  assert.equal(gradeLearningCheck({...check,answer:0},'0',{relativeTolerance:true}),true);
  assert.equal(gradeLearningCheck(check,'0'),true,'legacy absolute tolerance is preserved');
});
