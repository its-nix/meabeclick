import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PARABOLAS} from '../../src/lib/learning/parabolas.ts';
import{teachingFixture}from'../teaching-fixture.mjs';
process.env.DATA_DIR=mkdtempSync(join(tmpdir(),'learning-lifecycle-'));
process.env.DB_PATH=join(process.env.DATA_DIR,'results.db');
const E=await import('../../src/lib/server/entities.ts');
const P=await import('../../src/lib/server/plans/store.ts');
const {handle,createLesson}=await import('../../src/lib/server/db.ts');
const {recordGenerated,latestPublished}=await import('../../src/lib/server/materials.ts');
const {assignLearning,learningForStudent,assignedExperience,learningMaterialSlug}=await import('../../src/lib/server/learning-store.ts');
const {afterReport}=await import('../../src/lib/server/reports/after.ts');
const{addHomework}=await import('../../src/lib/server/lessons.ts');
const template={id:'learning-test',version:1,subject:'מתמטיקה',track:'',reviewed:null,topics:[{key:'t',title:'נושא',branches:[{key:'t.b',title:'ענף',skills:[
  {key:'t.b.a',title:'הזזת פרבולה',requires:[]},{key:'t.b.b',title:'פרבולה נוספת',requires:[]},
]}]}]};
let serial=0;
function setup() {
  const suffix=++serial;
  const account=E.createAccount({name:`משפחת בדיקה ${suffix}`,credential:'x',phone:null});
  const student=E.createStudent({name:`תלמיד בדיקה ${suffix}`,code:`learning-life-${suffix}`,accountId:account.id,credential:'x'});
  E.upsertEnrollment({studentId:student.id,subject:'מתמטיקה',level:'כיתה ט',teacherId:null});
  const enrollment=E.enrollmentsForStudent(student.id)[0];
  const planId=P.createPlan({studentId:student.id,enrollmentId:enrollment.id,template,goal:'תרגול'});
  const skills=P.planData(planId).nodes.filter(n=>n.kind==='skill');
  const bookingId=Number(handle().prepare(`INSERT INTO bookings_v2 (student_id,enrollment_id,start,"end",duration,at,status)
    VALUES (?,?,'2098-01-01T10:00:00.000Z','2098-01-01T10:45:00.000Z',45,?,'confirmed')`).run(student.id,enrollment.id,new Date().toISOString()).lastInsertRowid);
  const slug=`learning-life-${suffix}`;
  createLesson({slug,student:student.name,subject:'מתמטיקה',level:'כיתה ט',topic:'הזזות',lessonAt:'2098-01-01T10:00:00.000Z'});
  recordGenerated(slug,{plan:JSON.stringify({learning:PARABOLAS})});
  assignLearning(slug,student.id,{bookingId,nodeId:skills[0].id,heldUntil:'2099-01-01T00:00:00.000Z'});
  return {student,bookingId,skills,slug};
}
test('v2 reports reuse only covered activities and keep preparation history and released work',async()=>{
 const {student,bookingId,skills,slug}=setup(),p=teachingFixture();
 p.teaching.objectives.push({id:'untaught',title:'לא נלמד',evidence:'בדיקה חדשה'});p.teaching.practice.find(a=>a.ref==='homework-2').objectiveId='untaught';
 recordGenerated(slug,{plan:JSON.stringify(p)});
 addHomework({studentId:student.id,task:'הכנה מוחזקת',bookingId,nodeId:skills[0].id,assignedAt:new Date().toISOString(),heldUntil:'2099-01-01T00:00:00.000Z'});
 let calls=0;const result=await afterReport({bookingId,nodeIds:[skills[0].id],note:null,coveredObjectiveIds:['o1']},{generate:async()=>{calls++;throw Error('should reuse');}});
 assert.equal(result,'replaced');assert.equal(calls,0);
 assert.equal(assignedExperience(slug),null);assert.equal(assignedExperience(slug,'homework').experience.scenes.length,1);
 assert.match(learningForStudent(student.id)[0].url,/\/homework$/);
 assert.equal(JSON.parse(latestPublished(slug,'plan').content).homework.length,2,'original preparation is retained');
 const target=learningMaterialSlug(slug);assert.notEqual(target,slug);
 assert.equal(await afterReport({bookingId,nodeIds:[],note:null,coveredObjectiveIds:['untaught']}),'none');assert.equal(learningMaterialSlug(slug),target);
});
test('a slow v2 report cannot replace a tutor revision made while homework was generating',async()=>{
 const {student,bookingId,skills,slug}=setup(),p=teachingFixture();recordGenerated(slug,{plan:JSON.stringify(p)});
 addHomework({studentId:student.id,task:'הכנה מוחזקת',bookingId,nodeId:skills[0].id,assignedAt:new Date().toISOString(),heldUntil:'2099-01-01T00:00:00.000Z'});
 let finish;const wait=new Promise(resolve=>finish=resolve);
 const running=afterReport({bookingId,nodeIds:[skills[0].id],note:'צריך לתרגל לאט',coveredObjectiveIds:['o1']},{generate:async ctx=>{assert.deepEqual(ctx.coveredObjectiveIds,['o1']);await wait;return[{task:'נמקו את הדרך',why:'הבנה',answer:'תשובה פרטית',nodeId:skills[0].id,objectiveId:'o1',check:null}];}});
 p.homework[0].task='גרסה חדשה של המורה';recordGenerated(slug,{plan:JSON.stringify(p)});finish();
 assert.equal(await running,'obsolete');assert.equal(learningMaterialSlug(slug),slug);assert.equal(JSON.parse(latestPublished(slug,'plan').content).homework[0].task,'גרסה חדשה של המורה');
});
test('booking preparation is available before class without appearing as released homework',async()=>{
  const {student,bookingId,skills}=setup();
  assert.equal(learningForStudent(student.id).length,0);
  assert.equal(learningForStudent(student.id,'preparation').length,1);
  await afterReport({bookingId,note:null,nodeIds:[skills[0].id]});
  assert.equal(learningForStudent(student.id).length,1);
  assert.equal(learningForStudent(student.id,'preparation').length,0);
});
test('a changed taught skill gets its published library experience and a distinct editable history',async()=>{
  const {student,bookingId,skills,slug}=setup();
  const replacement={...structuredClone(PARABOLAS),title:'תרגול לפי השיעור שהתקיים'};
  const master=`library-life-${serial}`;
  handle().prepare("INSERT INTO library_items (template_id,skill_key,slug,status,updated_at) VALUES ('learning-test','t.b.b',?,'ready',?)").run(master,new Date().toISOString());
  recordGenerated(master,{plan:JSON.stringify({learning:replacement})});
  await afterReport({bookingId,note:null,nodeIds:[skills[1].id]});
  assert.equal(learningForStudent(student.id)[0].title,replacement.title);
  assert.equal(assignedExperience(slug).experience.title,replacement.title);
  assert.equal(learningMaterialSlug(slug),`${slug}--practice`);
  assert.equal(JSON.parse(latestPublished(slug,'plan').content).learning.title,PARABOLAS.title,'preparation history is preserved');
  await afterReport({bookingId,note:null,nodeIds:[skills[0].id]});
  assert.equal(assignedExperience(slug).experience.title,replacement.title,'repeated reports do not retract released work');
});
test('untaught material with no ready replacement stays out of homework',async()=>{
  const {student,bookingId,skills}=setup();
  handle().prepare("DELETE FROM library_items WHERE template_id='learning-test'").run();
  await afterReport({bookingId,note:null,nodeIds:[skills[1].id]});
  assert.equal(learningForStudent(student.id).length,0);
});
test('no-report fallback releases after 24h; cancellation does not release preparation',()=>{
  const one=setup(),two=setup();
  handle().prepare("UPDATE bookings_v2 SET status='cancelled' WHERE id=?").run(two.bookingId);
  assert.equal(learningForStudent(one.student.id,'practice','2100-01-01T00:00:00.000Z').length,1);
  assert.equal(learningForStudent(two.student.id,'practice','2100-01-01T00:00:00.000Z').length,0);
  assert.equal(learningForStudent(two.student.id,'preparation').length,0);
});
test('booking and skill identity cannot be borrowed from another student',()=>{
  const one=setup(),two=setup();
  assert.throws(()=>assignLearning(one.slug,one.student.id,{bookingId:two.bookingId,nodeId:null,heldUntil:null}),/booking does not belong/);
  assert.throws(()=>assignLearning(one.slug,one.student.id,{bookingId:one.bookingId,nodeId:two.skills[0].id,heldUntil:null}),/skill does not belong/);
});
