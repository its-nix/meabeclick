import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generationPlan} from '../helpers/generation-plan.mjs';
import * as M from '../../src/lib/learning/model.ts';
import {LEARNING_SCHEMA} from '../../src/lib/learning/schema.ts';
import {structuredProblems} from '../../src/lib/server/lesson/structured-validation.ts';
import '../isolate-lesson-data.mjs';
import {generatedPlanStub} from '../generated-plan-stub.mjs';
test('optional material topic manifest validates scene membership and known skill keys without inferring mappings',()=>{
 const learning=generationPlan().learning;learning.topics=[{id:'topic-1',title:'הצבה בלבד',sceneIds:[learning.scenes[0].id],skillKeys:['known']}];
 assert.deepEqual(M.learningTopicProblems(learning,['known']),[]);
 for(const mutate of [t=>t.id=' ',t=>t.title='',t=>t.sceneIds=['foreign'],t=>t.skillKeys=['guessed'],t=>t.sceneIds.push(t.sceneIds[0]),t=>t.skillKeys.push(t.skillKeys[0])]){const changed=structuredClone(learning);mutate(changed.topics[0]);assert.ok(M.learningTopicProblems(changed,['known']).length);}
 assert.deepEqual(M.learningTopicProblems({...learning,topics:undefined},[]),[]);
 assert.deepEqual(M.learningTopicProblems({...learning,topics:null},[]),[]);
 assert.deepEqual(structuredProblems(learning,LEARNING_SCHEMA),[]);
 const duplicate=structuredClone(learning);duplicate.topics.push(duplicate.topics[0]);assert.ok(M.learningTopicProblems(duplicate,['known']).length);
});
test('material reporting metadata stays out of student-rendered experience JSON',()=>{
 const learning=generationPlan().learning;learning.topics=[{id:'private-local',title:'מורה',sceneIds:[learning.scenes[0].id],skillKeys:['curriculum-private']}];
 assert.equal(Object.hasOwn(M.publicExperience(learning),'topics'),false);
});

test('fresh generation repairs a malformed topic manifest without replacing teaching content',async()=>{
 const plan=generationPlan();plan.learning.topics=[{id:'topic',title:'נושא',sceneIds:['foreign-scene'],skillKeys:[]}];
 const topics=[{...plan.learning.topics[0],sceneIds:[plan.learning.scenes[0].id]}];
 const {result,runs,critiques}=await generatedPlanStub(plan,{repairOutput:{'learning.topics':topics}});
 assert.deepEqual(result,{...plan,learning:{...plan.learning,topics}});
 assert.equal(runs,2);assert.equal(critiques,1);
});
