import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PARABOLAS} from '../../src/lib/learning/parabolas.ts';
import {learningControls,LEARNING_CONTROL_CAPABILITIES} from '../../src/lib/learning/controls.ts';
import {LEARNING_INSTRUCTIONS} from '../../src/lib/learning/schema.ts';
import {renderLearningDocument} from '../../src/lib/server/learning-render.ts';

const controlInputs=html=>[...html.matchAll(/<input aria-label="([^"]+)" data-param="(\d+)" type="range" min="([^"]+)" max="([^"]+)" step="([^"]+)"/g)].map(m=>({label:m[1],index:Number(m[2]),min:Number(m[3]),max:Number(m[4]),step:Number(m[5])}));
function sectionFor(visual,frames=1) {
  const lesson=structuredClone(PARABOLAS),scene=lesson.scenes.find(s=>s.id==='explore');
  scene.visual=visual;scene.check=null;scene.xDomain=[-3,9];
  const values={quadratic:[1,0,0],linear:[1,0],'number-line':[1],balance:[1,0,4],steps:[],'fraction-bar':[1,2],'right-triangle':[3,4],'function-tangent':[1,0,0,1]}[visual];
  scene.frames=Array.from({length:frames},()=>({tex:'x=1',caption:'נתונים לבדיקה',values:values.slice()}));
  return renderLearningDocument(lesson).split('data-scene="explore"')[1].split('</section>')[0];
}

test('single-frame quadratic exploration has h,k and cannot promise an a control',()=>{
  const controls=controlInputs(sectionFor('quadratic'));
  assert.deepEqual(controls.map(c=>c.index),[1,2]);
  assert.deepEqual(controls.map(c=>c.label),['h — ימינה ושמאלה','k — למעלה ולמטה']);
  assert.ok(controls.every(c=>c.min===-5&&c.max===5&&c.step===1));
  const capabilities=LEARNING_INSTRUCTIONS.flatMap(line=>{try{return JSON.parse(line).sceneControls??[];}catch{return [];}});
  const explore=capabilities.find(c=>c.visual==='quadratic'&&c.context==='explore');
  assert.deepEqual(explore?.parameters.map(p=>p.name),['h','k'],'the producer must receive the same limited capabilities as the learner');
});
test('existing control ranges, order and multiframe restrictions are preserved',()=>{
  assert.deepEqual(controlInputs(sectionFor('linear')).map(c=>c.index),[0,1]);
  assert.deepEqual(controlInputs(sectionFor('number-line')),[{label:'x — מיקום על הציר',index:0,min:-3,max:9,step:.25}]);
  for(const visual of ['quadratic','linear','number-line','balance','steps','fraction-bar','right-triangle','function-tangent']) {
    assert.deepEqual(controlInputs(sectionFor(visual,2)),[],`${visual}: guided frames have no free sliders`);
  }
  for(const visual of ['balance','steps','fraction-bar','right-triangle','function-tangent']) assert.deepEqual(controlInputs(sectionFor(visual)),[]);
  const target=renderLearningDocument(PARABOLAS).split('data-scene="target"')[1].split('</section>')[0];
  assert.deepEqual(controlInputs(target).map(c=>c.index),[1,2,0]);
});


test('structured generation capabilities and actual HTML resolve from the same parameter definitions',()=>{
  const guidance=LEARNING_INSTRUCTIONS.flatMap(line=>{try{return JSON.parse(line).sceneControls??[];}catch{return [];}});
  assert.deepEqual(guidance,LEARNING_CONTROL_CAPABILITIES);
  for(const capability of guidance) {
    let html;
    if(capability.context==='explore') html=sectionFor(capability.visual);
    else {
      const lesson=structuredClone(PARABOLAS),target=lesson.scenes.find(s=>s.id==='target');
      target.visual=capability.visual;
      if(capability.visual==='linear') {target.frames[0].values=[1,0];target.check.answer=[2,1];}
      html=renderLearningDocument(lesson).split('data-scene="target"')[1].split('</section>')[0];
    }
    const expected=capability.parameters.map(p=>({label:`${p.name} — ${p.label}`,index:p.index,min:typeof p.min==='number'?p.min:-3,max:typeof p.max==='number'?p.max:9,step:p.step}));
    assert.deepEqual(controlInputs(html),expected,`${capability.visual}/${capability.context}`);
  }
  const scene={visual:'quadratic',phase:'explore',check:{kind:'graph-target'},frames:[{values:[1,0,0]}],xDomain:[-5,5]};
  assert.deepEqual(learningControls(scene).map(p=>p.name),['h','k','a'],'a graph-target retains precedence over explore');
  scene.frames.push(scene.frames[0]);
  assert.deepEqual(learningControls(scene),[],'multiframe explore still suppresses all free controls');
});
