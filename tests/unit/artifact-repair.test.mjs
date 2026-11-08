import '../isolate-lesson-data.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generationPlan} from '../helpers/generation-plan.mjs';
import {LESSON_SCHEMA} from '../../src/lib/server/lesson/prep.ts';
import {artifactRepair} from '../../src/lib/server/lesson/artifact-repair.ts';
import {qualityPaths} from '../../src/lib/server/lesson/quality.ts';

test('a failed scene field repairs only its scene and never mutates the candidate',()=>{
  const plan=generationPlan(),before=structuredClone(plan);
  const repair=artifactRepair(plan,[{path:'learning.scenes[2].frames[0].caption',code:'structure',message:'caption too long'}],LESSON_SCHEMA);
  assert.deepEqual(repair.paths,['learning.scenes[2]']);
  const scene={...structuredClone(plan.learning.scenes[2]),questionVisual:null};
  scene.frames[0].caption='מציבים ומחשבים צעד אחד.';
  const fixed=repair.apply({'learning.scenes[2]':scene});
  const expected=structuredClone(before);expected.learning.scenes[2].frames[0].caption=scene.frames[0].caption;
  assert.deepEqual(fixed,expected);
  assert.deepEqual(plan,before);
});

const bankPlan=()=>{
  const plan=generationPlan();
  plan.games.quiz={title:'חידון',subject:'מתמטיקה',questions:Array.from({length:30},(_,i)=>({
    id:`q-${i}`,difficulty:i%3+1,q:`שאלה ${i}`,options:[String(i),'אחר'],answer:0,why:'הסבר',hint:'בדקו את הנתונים',
  }))};
  return plan;
};
test('bank item repair distinguishes index2 from20 and preserves all other questions',()=>{
  const plan=bankPlan(),before=structuredClone(plan),path='games.quiz.questions[20]';
  const repair=artifactRepair(plan,[{path:path+'.why',code:'critique.answerKey',message:'explain the answer'}],LESSON_SCHEMA);
  assert.ok(repair,'a bank question is a repairable unit');
  assert.deepEqual(repair.paths,[path]);
  const question={...plan.games.quiz.questions[20],why:'הסבר מתוקן'};
  const expected=structuredClone(plan);expected.games.quiz.questions[20]=question;
  assert.deepEqual(repair.apply({[path]:question}),expected);
  const dotted=artifactRepair(plan,[{path:'games.quiz.questions.2.why',code:'structure',message:'validator field path'}],LESSON_SCHEMA);
  assert.deepEqual(dotted.paths,['games.quiz.questions[2]']);
  assert.deepEqual(plan,before);
});

test('slides, worked examples and homework are independent repair units',()=>{
  const plan=generationPlan(),paths=['slides[1]','examples[0]','homework[1]'];
  const repair=artifactRepair(plan,paths.map(path=>({path,code:'critique.teaching',message:'improve this artifact'})),LESSON_SCHEMA);
  assert.ok(repair);
  assert.deepEqual(repair.paths,paths);
  const expected=structuredClone(plan);
  expected.slides[1].heading='ניסוי מתוקן';expected.examples[0].answer='4 בדיוק';expected.homework[1].answer='16 בדיוק';
  const fixed=repair.apply({'slides[1]':{...expected.slides[1],note:null},'examples[0]':expected.examples[0],'homework[1]':expected.homework[1]});
  assert.deepEqual(fixed,expected);
});

test('a container failure subsumes its item repairs and duplicate findings',()=>{
  const plan=bankPlan();
  const repair=artifactRepair(plan,['games.quiz.questions[2].why','games.quiz.questions','games.quiz.questions[2].why'].map(path=>({path,code:'structure',message:'invalid bank'})),LESSON_SCHEMA);
  assert.deepEqual(repair.paths,['games.quiz']);
  assert.deepEqual(repair.apply({'games.quiz':plan.games.quiz}),plan);
});

test('unlocatable and foreign paths use full fallback rather than guessing an artifact',()=>{
  for(const path of ['lesson','unknownMetadata','slides[99].heading','games.foreign.questions[0]','games.quiz.questions[200].why','games.__proto__.polluted']) {
    assert.equal(artifactRepair(bankPlan(),[{path,code:'structure',message:'bad'}],LESSON_SCHEMA),null,path);
  }
  for(const candidate of [null,[], 'bad JSON']) assert.equal(artifactRepair(candidate,[{path:'lesson',code:'structure',message:'bad'}],LESSON_SCHEMA),null);
});

test('malformed, missing and foreign replacements fail closed without changing input',()=>{
  const plan=generationPlan(),before=structuredClone(plan),path='homework[0]';
  const repair=artifactRepair(plan,[{path,code:'critique.math',message:'fix the key'}],LESSON_SCHEMA);
  const valid={[path]:plan.homework[0]};
  for(const reply of [null,[],{}, {[path]:null}, {[path]:{...plan.homework[0],answer:7}}, {...valid,'slides[0]':{}}, {...valid,unexpected:true}, JSON.parse('{"__proto__":{"polluted":true}}')]) {
    assert.throws(()=>repair.apply(reply));
    assert.deepEqual(plan,before);
    assert.equal(Object.prototype.polluted,undefined);
  }
});

test('public metadata can be assessed and repaired without replacing passing questions',()=>{
  const plan=bankPlan(),path='games.quiz.title',paths=qualityPaths(plan);
  assert.ok(paths.includes(path),'bank metadata must have an assessable path');
  assert.ok(paths.includes('games.quiz.questions[0]'));
  assert.ok(paths.includes('title'));assert.ok(paths.includes('learning.objective'));
  assert.equal(new Set(paths).size,paths.length);
  const repair=artifactRepair(plan,[{path,code:'critique.math',message:'wrong equation in title'}],LESSON_SCHEMA);
  assert.deepEqual(repair.paths,[path]);
  const expected=structuredClone(plan);expected.games.quiz.title='כותרת נכונה';
  assert.deepEqual(repair.apply({[path]:'כותרת נכונה'}),expected);
});

test('numeric bank bounds have assessment paths and trusted replacements',()=>{
  const plan=generationPlan();plan.games.numberLine={title:'ציר',subject:'מתמטיקה',min:0,max:10,rounds:Array.from({length:10},(_,i)=>({id:`point-${i}`,difficulty:i%3+1,target:i,tolerance:.2,label:String(i),why:'השוו למיקום על הציר',hint:'השוו לאפס'}))};
  assert.ok(qualityPaths(plan).includes('games.numberLine.min'));
  assert.ok(qualityPaths(plan).includes('games.numberLine.max'));
  const repair=artifactRepair(plan,[{path:'games.numberLine.min',code:'critique.context',message:'negative interval needed'}],LESSON_SCHEMA);
  assert.deepEqual(repair.paths,['games.numberLine.min']);
  const expected=structuredClone(plan);expected.games.numberLine.min=-10;
  assert.deepEqual(repair.apply({'games.numberLine.min':-10}),expected);
});
