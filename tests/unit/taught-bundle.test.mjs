import '../isolate-lesson-data.mjs';import{test}from'node:test';import assert from'node:assert/strict';import{teachingFixture}from'../teaching-fixture.mjs';
test('prepared homework reuses only explicitly covered objectives',async()=>{
 const m=await import('../../src/lib/server/lesson/taught-bundle.ts').catch(()=>null);assert.ok(m);
 const p=teachingFixture();p.teaching.objectives.push({id:'untaught',title:'לא נלמד',evidence:'בדיקה'});p.teaching.practice.find(a=>a.ref==='homework-2').objectiveId='untaught';
 assert.equal(m.preparedHomework(p,['o1']).length,1);assert.deepEqual(m.preparedHomework(p,['missing']),[]);
});
test('report generator rejects unknown objectives and keeps reliable checks private',async()=>{
 const {parseTaughtHomework,buildHomeworkPrompt}=await import('../../src/lib/server/lesson/homework.ts');
 const context={subject:'מתמטיקה',level:'כיתה ח',skills:[{key:'one',title:'שברים',nodeId:11}],note:null,coveredObjectiveIds:['covered']};
 const item={task:'כמה הם חצי ועוד חצי?',why:'חזרה',skillKey:'one',objectiveId:'untaught',answer:'1',check:null};
 assert.throws(()=>parseTaughtHomework(JSON.stringify({homework:[item]}),context.skills,context),/usable|objective/);
 item.objectiveId='covered';item.check={kind:'number',question:item.task,options:[],answer:1,hints:['חברו את החלקים'],success:'שלם אחד',retry:'נסו לצייר',solution:'1/2+1/2=1'};
 const out=parseTaughtHomework(JSON.stringify({homework:[item]}),context.skills,context);assert.equal(out[0].objectiveId,'covered');assert.equal(out[0].check.answer,1);
 assert.match(buildHomeworkPrompt(context),/covered/);
});
