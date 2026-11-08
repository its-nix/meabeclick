import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAdaptiveBank, selectQuestion, sanitizeQuestionEvidence, shuffleQuestionOptions } from '../../src/lib/games/adaptive.ts';
const bank = Array.from({length:15}, (_,i)=>({id:`q${i}`,difficulty:i%3+1,q:`Q${i}`}));
test('starts at middle, rises after two unaided successes and drops after error or help',()=>{
 const first = selectQuestion(bank, []); assert.equal(first.difficulty,2);
 const evidence=[{questionId:first.id,difficulty:2,correct:true,hints:0}];
 const second=selectQuestion(bank,evidence); assert.equal(second.difficulty,2);
 evidence.push({questionId:second.id,difficulty:2,correct:true,hints:0});
 assert.equal(selectQuestion(bank,evidence).difficulty,3);
 assert.equal(selectQuestion(bank,[{questionId:'q2',difficulty:3,correct:true,hints:1}]).difficulty,2);
 assert.equal(selectQuestion(bank,[{questionId:'q0',difficulty:1,correct:false,hints:null}]).difficulty,1);
});
test('finite sessions select ten unseen questions and stop; timed mode exhausts all before repeating',()=>{
 const evidence=[];
 for(let i=0;i<10;i++){const q=selectQuestion(bank,evidence);assert.ok(q);assert.ok(!evidence.some(e=>e.questionId===q.id));evidence.push({questionId:q.id,difficulty:q.difficulty,correct:true,hints:null});}
 assert.equal(selectQuestion(bank,evidence),null);
 for(let i=10;i<15;i++){const q=selectQuestion(bank,evidence,{timed:true});assert.ok(!evidence.some(e=>e.questionId===q.id));evidence.push({questionId:q.id,difficulty:q.difficulty,correct:false,hints:null});}
 assert.ok(selectQuestion(bank,evidence,{timed:true}));
});
test('legacy arrays do not opt into adaptation, evidence stays bounded and nullable',()=>{
 assert.equal(isAdaptiveBank(bank),true);assert.equal(isAdaptiveBank(bank.map(({q})=>({q}))),false);
 assert.equal(isAdaptiveBank([...bank.slice(1),bank[1]]),false);
 assert.deepEqual(sanitizeQuestionEvidence([{questionId:'a',difficulty:2,correct:true,hints:null},{questionId:'x',difficulty:7,correct:false,hints:0}]),[{questionId:'a',difficulty:2,correct:true,hints:null}]);
 assert.equal(sanitizeQuestionEvidence(undefined),null);
 assert.equal(sanitizeQuestionEvidence(Array(250).fill({questionId:'a',difficulty:1,correct:false,hints:0})).length,200);
});
test('no-hint questions preserve null evidence and still adapt to unaided performance',()=>{
 const e=[{questionId:'q1',difficulty:2,correct:true,hints:null},{questionId:'q4',difficulty:2,correct:true,hints:null}];
 assert.equal(selectQuestion(bank,e).difficulty,3);
});

test('adaptive option labels and answer handlers use the same immutable order on server and client',()=>{
 const choices=[{text:'A',right:true},{text:'B',right:false},{text:'C',right:false}];
 const original=structuredClone(choices);
 for(const q of bank){
  const server=shuffleQuestionOptions(choices,q.id);
  const client=shuffleQuestionOptions(structuredClone(choices),q.id);
  assert.deepEqual(server,client);assert.deepEqual(choices,original);
  assert.equal(server.find(c=>c.text==='A').right,true);
 }
});
