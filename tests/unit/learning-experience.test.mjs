import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PARABOLAS } from '../../src/lib/learning/parabolas.ts';
import { gradeLearningCheck, numericAnswer, publicExperience, learningProblems } from '../../src/lib/learning/model.ts';
import { learningFrameAt, formulaForVisual } from '../../src/lib/learning/visual.ts';
import { mathText, mathFormula } from '../../src/lib/learning/math.ts';
import { experienceProblems, renderLearningDocument, learningFingerprint } from '../../src/lib/server/learning-render.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'learning-unit-'));
const { renderSlides } = await import('../../src/lib/server/lesson/prep.ts');

test('the reference lesson has valid math and an independent challenge', () => {
  assert.deepEqual(experienceProblems(PARABOLAS), []);
  assert.ok(PARABOLAS.scenes.some(s => s.phase === 'challenge' && s.check));
});
test('numeric answers accept equivalent fractions and decimal notation without evaluating code', () => {
  for (const input of ['1/2', '0.5', '0,5', '١/٢']) assert.equal(numericAnswer(input), .5);
  for (const input of ['1/0', 'Infinity', 'NaN', 'alert(1)', '2**3', '1/2/3', {}, '']) assert.equal(numericAnswer(input), null);
});
test('the plotted target checks every parameter and rejects extra or nonnumeric values', () => {
  const check = PARABOLAS.scenes.find(s => s.id === 'target').check;
  assert.equal(gradeLearningCheck(check, [1,2,1]), true);
  for (const value of [[1,2,0], [1,2,1,4], ['1',2,1], [1,Infinity,1]]) assert.equal(gradeLearningCheck(check, value), false);
});
test('answer keys stay out of assigned documents and the public lesson payload', () => {
  assert.equal(JSON.stringify(publicExperience(PARABOLAS)).includes('"answer":'), false);
  const html = renderLearningDocument(PARABOLAS, { slug:'synthetic' });
  const payload = JSON.parse(html.match(/<script id="learning-data" type="application\/json">(.*?)<\/script>/s)[1]);
  assert.equal(payload.demoChecks, undefined);
  assert.equal(payload.experience.scenes.find(s => s.id === 'independent').check.answer, undefined);
  assert.equal(payload.experience.scenes.find(s => s.id === 'independent').check.success, '');
  assert.equal(html.includes('תשובה: <bdi'), false);
});
test('math rendering escapes prose, supports real TeX, and exposes compilation failures', () => {
  assert.match(mathText('חשבו \\(\\frac{1}{2}\\) <img src=x onerror=alert(1)>'), /class="katex"/);
  assert.ok(!mathText('<script>alert(1)</script>').includes('<script>'));
  assert.match(mathText('\\(\\unknowncommand{x}\\)'), /data-math-error/);
});
test('invalid generation is rejected before reaching the student', () => {
  const wrong = structuredClone(PARABOLAS);
  wrong.scenes[0].frames[0].tex = '\\badcommand{x}';
  assert.ok(experienceProblems(wrong).some(p => p.includes('נוסחה')));
  assert.throws(() => renderLearningDocument(wrong), /Invalid learning experience/);
  wrong.scenes[0].visual = 'arbitrary-javascript';
  assert.ok(learningProblems(wrong).some(p => p.includes('לא נתמך')));
});
test('animation is seekable, bounded and reaches the same mathematical state', () => {
  const scene = PARABOLAS.scenes[0];
  assert.deepEqual(learningFrameAt(scene, 0).values, [1,0,0]);
  assert.deepEqual(learningFrameAt(scene, 10).values, [1,2,1]);
  assert.deepEqual(learningFrameAt(scene, 100).values, [1,2,1]);
  assert.deepEqual(learningFrameAt(scene, 2), learningFrameAt(scene, 2));
});
test('a balance never draws a fractional number of unknown tiles during a transition', () => {
  const scene={...PARABOLAS.scenes[0],visual:'balance',frames:[
    {values:[2,0,8],caption:'מחלקים בשתיים',tex:'2x=8'},
    {values:[1,0,4],caption:'מקבלים את ערך x',tex:'x=4'},
  ]};
  for(const t of [0,1,1.5,2,2.5,3,4,5]) {
    const {values}=learningFrameAt(scene,t);
    assert.ok(Number.isInteger(values[0]));
    assert.equal(values[0]*4+values[1],values[2]);
  }
});
test('new lesson decks use the interactive experience; legacy decks continue rendering', () => {
  const plan = {title:'test',slides:[],examples:[],homework:[],games:{},learning:PARABOLAS};
  assert.match(renderSlides(plan,{subject:'מתמטיקה',level:'כיתה ט'}), /data-scene="notice"/);
  assert.match(renderSlides({...plan,learning:undefined},{subject:'מתמטיקה',level:'כיתה ט'}), /class="deck"/);
});
test('every graph target exposes all parameters, including a non-unit opening coefficient', () => {
  const lesson=structuredClone(PARABOLAS), target=lesson.scenes.find(s=>s.id==='target');
  target.frames[0].values=[2,0,0];target.check.answer=[2,2,1];
  assert.deepEqual(experienceProblems(lesson),[]);
  const section=renderLearningDocument(lesson).split('data-scene="target"')[1].split('</section>')[0];
  for(const index of [0,1,2]) assert.ok(section.includes(`data-param="${index}"`));
});
test('printed formulas derive from edited engine values instead of stale authored TeX', () => {
  const lesson=structuredClone(PARABOLAS), question=lesson.scenes.find(s=>s.id==='independent');
  question.frames[0].values[1]=3;question.check.answer=3;
  const worksheet=renderLearningDocument(lesson).split('<div class="print-pages">')[1];
  assert.ok(worksheet.includes(mathFormula(formulaForVisual(question.visual,question.frames[0].values))));
  assert.ok(!worksheet.includes(mathFormula(question.frames[0].tex)));
});
test('renaming material preserves progress while changing a question creates a new scope', () => {
  const revised=structuredClone(PARABOLAS);
  revised.title='שם חדש';revised.objective='אותה למידה';revised.scenes[0].title='כותרת חדשה';
  assert.equal(learningFingerprint(revised),learningFingerprint(PARABOLAS));
  revised.scenes.find(s=>s.check).check.answer=0;
  assert.notEqual(learningFingerprint(revised),learningFingerprint(PARABOLAS));
});
