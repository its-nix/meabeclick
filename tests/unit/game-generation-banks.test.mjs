import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameGenerationSchema, validateGeneratedGameBank } from '../../src/lib/server/lesson/game-generation.ts';
const questions = () => Array.from({length:15},(_,i)=>({id:`q${i}`,difficulty:i%3+1,q:`${i}+1?`,why:'why'}));
test('fresh banks require10unique questions with3levels; legacy and board shape validation remains separate',()=>{
 assert.deepEqual(validateGeneratedGameBank('quiz',{questions:questions()}),[]);
 assert.ok(validateGeneratedGameBank('quiz',{questions:questions().slice(0,9)}).some(s=>s.includes('10–40')));
 assert.ok(validateGeneratedGameBank('quiz',{questions:questions().map(q=>({...q,difficulty:2}))}).some(s=>s.includes('three')));
 assert.deepEqual(validateGeneratedGameBank('memory',{pairs:[]}),[]);
 const duplicate=questions();duplicate[14]={...duplicate[0],id:'new',difficulty:3,why:'new explanation'};
 assert.ok(validateGeneratedGameBank('quiz',{questions:duplicate}).some(s=>s.includes('duplicate')));
});
test('graph identity includes numeric graph shape; number line identity follows target, not label',()=>{
 const rounds=questions().map((q,i)=>({...q,prompt:'Choose the derivative',q:undefined,main:[i,i*i]}));
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
