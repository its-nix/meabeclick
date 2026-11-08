import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LEARNING_SCHEMA} from '../../src/lib/learning/schema.ts';
import {learningProblems} from '../../src/lib/learning/model.ts';
import {structuredProblems} from '../../src/lib/server/lesson/structured-validation.ts';
import {strictOutputSchema} from '../../src/lib/server/lesson/structured-output.ts';
import {generationPlan} from '../helpers/generation-plan.mjs';

test('generation rejects empty or overlong question-stimulus text before rendering',()=>{
  const learning=generationPlan().learning;
  const scene=learning.scenes.find(scene=>scene.phase==='challenge');
  scene.questionVisual={tex:'x',caption:'התבוננו בנתונים.'};
  assert.deepEqual(learningProblems(learning),[]);
  assert.deepEqual(structuredProblems(learning,LEARNING_SCHEMA,'learning'),[]);
  for(const [field,limit] of [['tex',600],['caption',180]]) {
    const boundary=structuredClone(learning);
    boundary.scenes.find(scene=>scene.phase==='challenge').questionVisual[field]='x'.repeat(limit);
    assert.deepEqual(learningProblems(boundary),[]);
    assert.deepEqual(structuredProblems(boundary,LEARNING_SCHEMA,'learning'),[]);
    for(const invalid of ['', ' \t\n', '\u00a0\ufeff', 'x'.repeat(limit+1)]) {
      const broken=structuredClone(learning);
      broken.scenes.find(scene=>scene.phase==='challenge').questionVisual[field]=invalid;
      assert.ok(learningProblems(broken).length,'the renderer rejects the stimulus');
      assert.ok(structuredProblems(broken,LEARNING_SCHEMA,'learning').length,
        `the generation schema must reject ${field} with length ${invalid.length}`);
    }
  }
});

test('precise union diagnostics still require one fully valid alternative',()=>{
  const schema={anyOf:[{type:'string',minLength:2},{type:'integer',minimum:1}]};
  assert.deepEqual(structuredProblems('ab',schema),[]);
  assert.deepEqual(structuredProblems(1,schema),[]);
  for(const invalid of ['a',0,1.5,null,{}])assert.ok(structuredProblems(invalid,schema).length);
  const ambiguous={anyOf:[{type:'object',required:['left'],properties:{left:{type:'number'}}},{type:'object',required:['right'],properties:{right:{type:'number'}}}]};
  assert.ok(structuredProblems({},ambiguous).length);
});

test('a malformed nullable stimulus identifies the exact field and allowed length for repair',()=>{
  const schema=strictOutputSchema(LEARNING_SCHEMA.properties.scenes.items.properties.questionVisual);
  const issues=structuredProblems({tex:'x',caption:'x'.repeat(181)},schema,'learning.scenes[2].questionVisual');
  assert.equal(issues.length,1);
  assert.equal(issues[0].path,'learning.scenes[2].questionVisual.caption');
  assert.match(issues[0].message,/180/);
  assert.match(issues[0].message,/181/);
});
