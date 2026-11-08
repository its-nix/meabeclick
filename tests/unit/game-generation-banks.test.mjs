import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameGenerationSchema, validateGeneratedGameBank } from '../../src/lib/server/lesson/game-generation.ts';
const questions = () => Array.from({length:15},(_,i)=>({id:`q${i}`,difficulty:i%3+1,q:`${i}+1?`,why:'why'}));
const graphRounds = () => questions().map(({id,difficulty},i)=>({
 id,difficulty,prompt:'Choose the graph of f(x)+2',mainLabel:'f(x)',main:[i,i+1,i+2],
 options:[[i+2,i+3,i+4],[i-2,i-1,i],[i,i+2,i+4]],answer:0,why:'Every output increases by two.',hint:'Compare output values.',
}));
test('fresh banks require10unique questions with3levels; legacy and board shape validation remains separate',()=>{
 assert.deepEqual(validateGeneratedGameBank('quiz',{questions:questions()}),[]);
 assert.ok(validateGeneratedGameBank('quiz',{questions:questions().slice(0,9)}).some(s=>s.includes('10–40')));
 assert.ok(validateGeneratedGameBank('quiz',{questions:questions().map(q=>({...q,difficulty:2}))}).some(s=>s.includes('three')));
 assert.deepEqual(validateGeneratedGameBank('memory',{pairs:[]}),[]);
 const duplicate=questions();duplicate[14]={...duplicate[0],id:'new',difficulty:3,why:'new explanation'};
 assert.ok(validateGeneratedGameBank('quiz',{questions:duplicate}).some(s=>s.includes('duplicate')));
});
test('graph identity includes numeric graph shape; number line identity follows target, not label',()=>{
 const rounds=graphRounds();
 assert.deepEqual(validateGeneratedGameBank('graphMatch',{rounds}),[]);
 rounds[14]={...rounds[0],id:'different',why:'another explanation'};
 assert.ok(validateGeneratedGameBank('graph-match',{rounds}).some(s=>s.includes('duplicate')));
 const line=questions().map((q,i)=>({id:q.id,difficulty:q.difficulty,target:i,label:`${i}`}));
 assert.deepEqual(validateGeneratedGameBank('numberLine',{rounds:line}),[]);
 line[14]={...line[0],id:'different',label:'zero'};
 assert.ok(validateGeneratedGameBank('number-line',{rounds:line}).some(s=>s.includes('duplicate')));
});
test('fresh schema adds metadata and bank limits without mutating caller or board schemas',()=>{
 const schema={type:'object',properties:{questions:{type:'array',items:{type:'object',properties:{q:{type:'string'}},required:['q']}}}};
 const next=gameGenerationSchema('quiz',schema);
 assert.equal(next.properties.questions.minItems,10);assert.equal(next.properties.questions.maxItems,40);
 assert.deepEqual(next.properties.questions.items.required,['q','id','difficulty']);
 assert.equal(schema.properties.questions.minItems,undefined);
 assert.deepEqual(gameGenerationSchema('sequence',schema),schema);
});

test('reordering the same three statements cannot pad a new bank',()=>{
 const rounds=questions().map((q,i)=>({id:q.id,difficulty:q.difficulty,statements:[`a${i}`,`b${i}`,`c${i}`]}));
 rounds[14]={...rounds[0],id:'different',statements:[...rounds[0].statements].reverse()};
 assert.ok(validateGeneratedGameBank('twoTruths',{rounds}).some(s=>s.includes('duplicate')));
});

test('fresh graph matching rejects copying the visible reference but leaves historical shape validation intact',async()=>{
 const rounds=graphRounds();rounds[0].options[0]=[...rounds[0].main];
 const body={title:'Synthetic graph task',subject:'Math',rounds};
 const {validateLessonGame}=await import('../../src/lib/server/lesson-games.ts');
 assert.doesNotThrow(()=>validateLessonGame('graph-match',body),'historical material remains readable');
 assert.ok(validateGeneratedGameBank('graphMatch',body).some(s=>s.includes('rounds.0')&&s.includes('reference')));
});
test('fresh graph matching rejects correct curves that collapse onto the visible reference at plot precision',()=>{
 const rounds=graphRounds();rounds[0]={...rounds[0],main:[0,1,2],options:[[0.000001,1.000001,2.000001],[1e9,1e9,1e9],[-1e9,-1e9,-1e9]]};
 assert.notDeepEqual(rounds[0].main,rounds[0].options[0]);
 assert.ok(validateGeneratedGameBank('graph-match',{rounds}).some(s=>s.includes('rounds.0')&&s.includes('reference')));
});
test('fresh graph matching rejects both exact and rendered duplicate answer choices',()=>{
 for(const delta of [0,1e-8]){
  const rounds=graphRounds();rounds[0].options=[[4,5,6],[4+delta,5+delta,6+delta],[-4,-5,-6]];
  assert.ok(validateGeneratedGameBank('graphMatch',{rounds}).some(s=>s.includes('rounds.0')&&s.includes('indistinguishable options')));
 }
});
test('fresh graph matching accepts distinct transformed and derivative curves on the shared scale',()=>{
 assert.deepEqual(validateGeneratedGameBank('graphMatch',{rounds:graphRounds()}),[]);
 const rounds=graphRounds().map((round,i)=>({...round,prompt:'Choose the derivative',main:[4+i,1+i,i,1+i,4+i],options:[[-4,-2,0,2,4],[4,2,0,-2,-4],[2,2,2,2,2]]}));
 assert.deepEqual(validateGeneratedGameBank('graph-match',{rounds}),[]);
});
test('fresh graph matching reports malformed curves and answer indices without calling the plotter with invalid types',()=>{
 for(const invalid of [{main:null},{main:[0,'1',2]},{main:[0,Infinity,2]},{options:'curves'},{options:Array(2)},{options:[[1,2,3],null]},{options:[[1,2],[1,2,3]]},{answer:-1},{answer:0.5},{answer:3}]){
  const rounds=graphRounds();Object.assign(rounds[0],invalid);
  let issues;
  assert.doesNotThrow(()=>{issues=validateGeneratedGameBank('graphMatch',{rounds});});
  assert.ok(issues.some(s=>s.includes('rounds.0')));
 }
});
