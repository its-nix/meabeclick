import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
process.env.DB_PATH=join(await mkdtemp(join(tmpdir(),'report-topics-')),'test.db');
const E=await import('../../src/lib/server/entities.ts');
const P=await import('../../src/lib/server/plans/store.ts');
const R=await import('../../src/lib/server/reports/store.ts');
const T=await import('../../src/lib/server/reports/topics.ts');
const M=await import('../../src/lib/server/materials.ts');
const {handle}=await import('../../src/lib/server/db.ts');
let seq=0;
export function fixture(){
 const n=++seq; const a=E.createAccount({name:'synthetic',phone:null,credential:'x'});
 const s=E.createStudent({code:`topic-${n}`,name:'סינתטי',accountId:a.id,credential:'x'});
 E.upsertEnrollment({studentId:s.id,subject:'מתמטיקה',level:'יא',teacherId:null}); const e=E.enrollmentsForStudent(s.id)[0];
 const template={id:'topic-test',version:1,subject:'מתמטיקה',track:'test',reviewed:null,topics:[{key:'t',title:'נושא',branches:[{key:'b',title:'ענף',skills:[{key:'s',title:'הזזות',requires:[]}]}]}]};
 const p=P.createPlan({studentId:s.id,enrollmentId:e.id,template,goal:'test'}); const skill=P.planData(p).nodes.find(n=>n.kind==='skill');
 const b=Number(handle().prepare(`INSERT INTO bookings_v2(student_id,enrollment_id,start,"end",duration,at,status) VALUES(?,?,'2026-01-01T10:00:00Z','2026-01-01T11:00:00Z',60,'2026-01-01','confirmed')`).run(s.id,e.id).lastInsertRowid);
 const slug=`topic-material-${n}`; handle().prepare(`INSERT INTO lessons(slug,student,at,status) VALUES(?,'synthetic','2026-01-01','ready')`).run(slug); handle().prepare(`INSERT INTO learning_assignments(lesson_slug,student_id,booking_id,node_id,held_until,practice_state) VALUES(?,?,?,?,?,'held')`).run(slug,s.id,b,skill.id,'2099-01-01');
 const topic={id:'horizontal',title:'הזזה אופקית',sceneIds:['scene-a'],skillKeys:['s']};
 const plan={title:'מצגת',learning:{scenes:[{id:'scene-a'},{id:'scene-b'}],topics:[topic,{id:'vertical',title:'הזזה אנכית',sceneIds:['scene-b'],skillKeys:['s']}]}};
 M.addMaterial({slug,kind:'plan',content:JSON.stringify(plan),origin:'generated',publish:true});
 return {student:s,bookingId:b,skill,slug,topic,plan};
}
const coverage=s=>({source:'material',materialSlug:s.slug,topics:s.plan.learning.topics.map((t,i)=>({...t,covered:i===0,comment:i===0?'רק ימינה':null}))});
test('explicit partial coverage pins source independently of understanding and legacy unknown',()=>{
 const s=fixture();R.fileReport({bookingId:s.bookingId,note:null,entries:[],expectedRevision:0,coverage:coverage(s)});
 const r=T.latestTopicReport(s.bookingId);assert.equal(r.revision,1);assert.equal(r.topics[0].covered,true);assert.equal(r.topics[1].covered,false);assert.equal(r.snapshot.slug,s.slug);
 assert.equal(P.planData(P.planForEnrollment(E.enrollmentsForStudent(s.student.id)[0].id).id).events.filter(e=>['status','covered'].includes(e.type)).length,0);
 const legacy=fixture();R.fileReport({bookingId:legacy.bookingId,note:null,entries:[]});assert.equal(T.latestTopicReport(legacy.bookingId),null);
});
test('explicit empty manual coverage is a filed zero, not unknown',()=>{
 const s=fixture();R.fileReport({bookingId:s.bookingId,note:null,entries:[],expectedRevision:0,coverage:{source:'manual',topics:[]}});assert.deepEqual(T.latestTopicReport(s.bookingId).topics,[]);
});
test('correction pins original material and stale writes leave history untouched',()=>{
 const s=fixture();R.fileReport({bookingId:s.bookingId,note:'one',entries:[],expectedRevision:0,coverage:coverage(s)});
 const first=T.latestTopicReport(s.bookingId);M.addMaterial({slug:s.slug,kind:'plan',content:JSON.stringify({...s.plan,title:'edited'}),origin:'edited',publish:true});
 R.fileReport({bookingId:s.bookingId,note:'two',entries:[],expectedRevision:1,coverage:coverage(s)});assert.deepEqual(T.latestTopicReport(s.bookingId).snapshot,first.snapshot);
 assert.throws(()=>R.fileReport({bookingId:s.bookingId,note:'stale',entries:[],expectedRevision:1,coverage:coverage(s)}),/revision conflict/);assert.equal(R.reportForBooking(s.bookingId).note,'two');assert.equal(T.topicReportHistory(s.bookingId).length,2);
});
test('foreign material, topics, scenes, skills and incomplete checklists are rejected atomically',()=>{
 for(const mutate of [c=>c.materialSlug='foreign',c=>c.topics[0].id='alien',c=>c.topics[0].sceneIds=['foreign'],c=>c.topics[0].skillKeys=['foreign'],c=>c.topics.pop(),c=>c.topics[0].covered='yes']){
 const s=fixture(),c=coverage(s);mutate(c);assert.throws(()=>R.fileReport({bookingId:s.bookingId,note:null,entries:[],expectedRevision:0,coverage:c}));assert.equal(R.reportForBooking(s.bookingId),null);
 }
});

test('explicit filing durably withholds prepared work but preserves released rows through expiry and failure release',async()=>{
 const s=fixture(); const L=await import('../../src/lib/server/lessons.ts');
 L.addHomework({studentId:s.student.id,bookingId:s.bookingId,task:'prepared',heldUntil:'2099-01-01'});
 L.addHomework({studentId:s.student.id,bookingId:s.bookingId,task:'already visible'});
 R.fileReport({bookingId:s.bookingId,note:null,entries:[],expectedRevision:0,coverage:{source:'manual',topics:[]}});
 L.releaseHeld(s.bookingId);
 assert.deepEqual(L.homeworkForStudent(s.student.id,{now:'2100-01-01'}).map(h=>h.task),['already visible']);
 assert.equal(handle().prepare('SELECT practice_state FROM learning_assignments WHERE lesson_slug=?').get(s.slug).practice_state,'withdrawn');
});

test('explicit understanding remains separate from topic coverage on corrections',()=>{
 const s=fixture(); const c=coverage(s);R.fileReport({bookingId:s.bookingId,note:null,entries:[{nodeId:s.skill.id,status:'independent'}],expectedRevision:0,coverage:c});
 assert.equal(P.planData(P.planForEnrollment(E.enrollmentsForStudent(s.student.id)[0].id).id).events.filter(e=>e.type==='covered').length,0);
 c.topics[0].covered=false;R.fileReport({bookingId:s.bookingId,note:null,entries:[],expectedRevision:1,coverage:c});assert.equal(T.latestTopicReport(s.bookingId).topics.filter(t=>t.covered).length,0);
});

const passedAssessment={passed:true,mathematics:true,answerKeys:true,coveredScope:true,exclusions:true,reason:'verified synthetic'};
test('explicit homework requires independent assessment and no broad failure fallback',async()=>{
 const {afterReport}=await import('../../src/lib/server/reports/after.ts'),L=await import('../../src/lib/server/lessons.ts');
 const s=fixture();L.addHomework({studentId:s.student.id,bookingId:s.bookingId,task:'broad prepared',heldUntil:'2099-01-01'});R.fileReport({bookingId:s.bookingId,note:null,entries:[],expectedRevision:0,coverage:coverage(s)});
 let assessed=0;const outcome=await afterReport({bookingId:s.bookingId,note:null,nodeIds:[],reportRevision:1},{generateTopics:async()=>[{task:'horizontal only',answer:'2',nodeId:s.skill.id,topicIds:['horizontal']}],assessTopics:async()=>{assessed++;return {...passedAssessment,passed:false,mathematics:false};}});
 assert.equal(assessed,1);assert.equal(outcome,'withheld');assert.equal(L.homeworkForStudent(s.student.id,{now:'2100-01-01'}).length,0);assert.equal(handle().prepare('SELECT passed FROM lesson_report_assessments ORDER BY id DESC LIMIT 1').get().passed,0);
});
test('approved scoped homework publishes private keys with exact revision provenance',async()=>{
 const {afterReport}=await import('../../src/lib/server/reports/after.ts'),L=await import('../../src/lib/server/lessons.ts');
 const s=fixture();L.addHomework({studentId:s.student.id,bookingId:s.bookingId,task:'broad prepared',heldUntil:'2099-01-01'});R.fileReport({bookingId:s.bookingId,note:null,entries:[],expectedRevision:0,coverage:coverage(s)});
 const outcome=await afterReport({bookingId:s.bookingId,note:null,nodeIds:[],reportRevision:1},{generateTopics:async ctx=>{assert.equal(ctx.topics.filter(t=>!t.covered).length,1);return [{task:'horizontal only',answer:'2',nodeId:s.skill.id,topicIds:['horizontal']}];},assessTopics:async()=>passedAssessment});
 assert.equal(outcome,'replaced');assert.deepEqual(L.homeworkForStudent(s.student.id).map(h=>[h.task,h.answer]),[['horizontal only','2']]);
 assert.equal(JSON.parse(handle().prepare('SELECT topic_provenance FROM homework WHERE task=?').get('horizontal only').topic_provenance).revision,1);
});
test('slow completion after correction cannot publish stale practice',async()=>{
 const {afterReport}=await import('../../src/lib/server/reports/after.ts'),L=await import('../../src/lib/server/lessons.ts');
 const s=fixture();L.addHomework({studentId:s.student.id,bookingId:s.bookingId,task:'prepared',heldUntil:'2099-01-01'});R.fileReport({bookingId:s.bookingId,note:null,entries:[],expectedRevision:0,coverage:coverage(s)});
 let complete;const delayed=new Promise(resolve=>complete=resolve);let started;const begun=new Promise(resolve=>started=resolve);
 const pending=afterReport({bookingId:s.bookingId,note:null,nodeIds:[],reportRevision:1},{generateTopics:async()=>{started();return delayed;},assessTopics:async()=>passedAssessment});await begun;
 R.fileReport({bookingId:s.bookingId,note:null,entries:[],expectedRevision:1,coverage:{source:'manual',topics:[]}});complete([{task:'stale',answer:'2',nodeId:s.skill.id,topicIds:['horizontal']}]);
 assert.equal(await pending,'none');assert.deepEqual(L.homeworkForStudent(s.student.id),[]);
});

test('a legacy whole-skill covered event remains history but stops claiming coverage after explicit correction',()=>{
 const s=fixture();R.fileReport({bookingId:s.bookingId,note:'legacy',entries:[{nodeId:s.skill.id,status:'guided'}]});
 const p=P.planForEnrollment(E.enrollmentsForStudent(s.student.id)[0].id);
 R.fileReport({bookingId:s.bookingId,note:null,entries:[],expectedRevision:1,coverage:{source:'manual',topics:[]}});
 const event=P.planData(p.id).events.find(e=>e.type==='covered');assert.ok(event);assert.equal(event.coverage_superseded,1);
});
test('prepared work arriving after filing is also durably withheld',async()=>{
 const s=fixture();const L=await import('../../src/lib/server/lessons.ts');R.fileReport({bookingId:s.bookingId,note:null,entries:[],expectedRevision:0,coverage:{source:'manual',topics:[]}});
 L.addHomework({studentId:s.student.id,bookingId:s.bookingId,task:'late broad',heldUntil:'2099-01-01'});assert.equal(L.homeworkForStudent(s.student.id,{now:'2100-01-01'}).length,0);
});

test('published legacy material without a manifest remains eligible through an unambiguous booking association',()=>{
 const s=fixture();handle().prepare('DELETE FROM learning_assignments WHERE lesson_slug=?').run(s.slug);
 // Fixtures intentionally share their booked times; this one has a unique time.
 const start=`2026-02-${String(seq).padStart(2,'0')}T10:00:00Z`;
 handle().prepare('UPDATE bookings_v2 SET start=? WHERE id=?').run(start,s.bookingId);handle().prepare('UPDATE lessons SET lesson_at=? WHERE slug=?').run(start,s.slug);
 M.addMaterial({slug:s.slug,kind:'plan',content:JSON.stringify({title:'legacy',slides:[]}),origin:'generated',publish:true});
 const materials=T.eligibleReportMaterials(s.bookingId);assert.equal(materials.length,1);assert.deepEqual(materials[0].topics,[]);
 R.fileReport({bookingId:s.bookingId,note:null,entries:[],expectedRevision:0,coverage:{source:'material',materialSlug:s.slug,topics:[{id:'manual-local',title:'נושא מקומי',sceneIds:[],skillKeys:['s'],covered:true,comment:null}]}});assert.equal(T.latestTopicReport(s.bookingId).topics[0].title,'נושא מקומי');
});

test('source preview reads the filed immutable version and refuses foreign material',()=>{
 const s=fixture();R.fileReport({bookingId:s.bookingId,note:null,entries:[],expectedRevision:0,coverage:coverage(s)});const pinned=T.latestTopicReport(s.bookingId).snapshot;
 M.addMaterial({slug:s.slug,kind:'plan',content:JSON.stringify({...s.plan,title:'REPLACED'}),origin:'edited',publish:true});
 const row=T.reportSourceMaterial(s.bookingId,pinned.materialId);assert.equal(JSON.parse(row.content).title,'מצגת');
 const foreign=fixture();assert.equal(T.reportSourceMaterial(s.bookingId,M.latestPublished(foreign.slug,'plan').id),null);
});

test('new legacy windows also conflict rather than overwriting a newer filing',()=>{
 const s=fixture();R.fileReport({bookingId:s.bookingId,note:'first',entries:[],expectedRevision:0});
 assert.equal(R.reportForBooking(s.bookingId).filing_revision,1);
 assert.throws(()=>R.fileReport({bookingId:s.bookingId,note:'stale',entries:[],expectedRevision:0}),/revision conflict/);
 assert.equal(R.reportForBooking(s.bookingId).note,'first');
});

test('a slow legacy completion cannot publish after a newer legacy revision',async()=>{
 const {afterReport}=await import('../../src/lib/server/reports/after.ts'),L=await import('../../src/lib/server/lessons.ts');
 const s=fixture();L.addHomework({studentId:s.student.id,bookingId:s.bookingId,task:'prepared',heldUntil:'2099-01-01'});R.fileReport({bookingId:s.bookingId,note:null,entries:[],expectedRevision:0});
 let complete,started;const delayed=new Promise(resolve=>complete=resolve),begun=new Promise(resolve=>started=resolve);
 const pending=afterReport({bookingId:s.bookingId,note:null,nodeIds:[s.skill.id],reportRevision:1},{generate:async()=>{started();return delayed;}});await begun;
 R.fileReport({bookingId:s.bookingId,note:'correction',entries:[],expectedRevision:1});complete([{task:'stale legacy',answer:'2',nodeId:s.skill.id}]);assert.equal(await pending,'none');assert.equal(L.homeworkForStudent(s.student.id).length,0);
});

test('future preparation receives only the effective material-scoped correction with private comments',async()=>{
 const s=fixture(),prep=await import('../../src/lib/server/reports/preparation.ts');const c=coverage(s);
 R.fileReport({bookingId:s.bookingId,note:null,entries:[],expectedRevision:0,coverage:c});c.topics[0].covered=false;c.topics[1].covered=true;c.topics[1].comment='להתחיל לאט';
 R.fileReport({bookingId:s.bookingId,note:null,entries:[],expectedRevision:1,coverage:c});
 const context=prep.preparationCoverageFor(s.student.code,'מתמטיקה');assert.equal(context.revision,2);assert.equal(context.snapshot.slug,s.slug);assert.deepEqual(context.topics.filter(t=>t.covered).map(t=>t.id),['vertical']);assert.equal(context.topics[1].comment,'להתחיל לאט');assert.equal(prep.preparationCoverageFor(s.student.code,'פיזיקה'),null);
});
