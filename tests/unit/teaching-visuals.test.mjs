import {test} from 'node:test';import assert from 'node:assert/strict';
import {PARABOLAS} from '../../src/lib/learning/parabolas.ts';
import {learningProblems} from '../../src/lib/learning/model.ts';
import {formulaForVisual,learningFrameAt} from '../../src/lib/learning/visual.ts';
import {mathFormula}from'../../src/lib/learning/math.ts';
function fixture(kind,values){const p=structuredClone(PARABOLAS);Object.assign(p.scenes[0],{visual:kind,frames:[{values,caption:'המחשה',tex:'1'}]});return p;}
test('fractions retain equal parts and discrete repartition while seeking',()=>{
 const p=fixture('fraction',[1,2,3]);assert.deepEqual(learningProblems(p),[]);
 assert.match(formulaForVisual('fraction',[1,2,3]),/frac\{3\}\{6\}/);
 const s=p.scenes[0];s.frames.push({...s.frames[0],values:[1,2,4]});for(const t of [0,1.3,2,2.5,3,5])assert.ok(learningFrameAt(s,t).values.every(Number.isInteger));
 for(const v of [[1,0,1],[3,2,1],[1,2,1.5],[1,13,4]])assert.ok(learningProblems(fixture('fraction',v)).length);
});
test('geometry uses perpendicular height and separate plane/solid formulas',()=>{
 for(const v of [[1,6,4,0],[2,6,4,0],[3,3,0,0],[4,3,4,5],[5,3,0,5],[6,3,0,5],[7,3,4,5],[8,3,4,0]]){
  assert.deepEqual(learningProblems(fixture('geometry',v)),[]);assert.doesNotThrow(()=>mathFormula(formulaForVisual('geometry',v)));
 }
 assert.match(formulaForVisual('geometry',[1,6,4,0]),/=12$/);assert.match(formulaForVisual('geometry',[6,3,0,5]),/15\\pi/);
 assert.match(formulaForVisual('geometry',[8,3,4,0]),/c=\\sqrt\{25\}=5/);
 assert.match(formulaForVisual('geometry',[6,1,0,1]),/frac\{1\}\{3\}/);
 assert.match(formulaForVisual('geometry',[4,1.11,1.12,1.13]),/1\.404816/);
 for(const v of [[1,6,0,0],[6,3,4,5],[9,3,4,5]])assert.ok(learningProblems(fixture('geometry',v)).length);
});
test('distributions distinguish normal CDF and school bands, with bounded values',()=>{
 for(const kind of ['data-bars','normal','normal-school'])assert.deepEqual(learningProblems(fixture(kind,kind==='data-bars'?[2,4,6,8]:[70,10,60,80])),[]);
 assert.match(formulaForVisual('normal',[70,10,60,80]),/68\.27/);assert.match(formulaForVisual('normal-school',[70,10,60,80]),/68/);
 assert.match(formulaForVisual('normal-school',[70,10,70,75]),/19/);
 for(const [kind,v]of [['data-bars',[0,0,0,0]],['data-bars',[1.5,2,3,4]],['normal',[70,0,60,80]],['normal-school',[70,10,71,80]],['normal',[70,10,80,60]]])assert.ok(learningProblems(fixture(kind,v)).length);
});
test('normal visuals reject unsupported precision rather than displaying zero spread',()=>{
 assert.ok(learningProblems(fixture('normal',[0,.001,-.001,.001])).length);
 assert.deepEqual(learningProblems(fixture('normal',[0,.1,-.1,.1])),[]);
 const s=fixture('normal',[0,.1,-.1,.1]).scenes[0];s.frames.push({...s.frames[0],values:[0,.2,-.2,.2]});
 for(const t of [1.31,2.15,2.63,3.42])assert.ok(learningFrameAt(s,t).values.every(n=>Math.abs(n*100-Math.round(n*100))<1e-7));
});
