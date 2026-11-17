import{test,after}from'node:test';import assert from'node:assert/strict';import{mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';
const root=mkdtempSync(join(tmpdir(),'native-brief-'));process.env.DB_PATH=join(root,'db.sqlite');
const E=await import('../../src/lib/server/entities.ts');const{handle}=await import('../../src/lib/server/db.ts');
const{preparationBriefForBooking}=await import('../../src/lib/server/native-learning/preparation-brief.ts');
after(()=>{handle().close();rmSync(root,{recursive:true,force:true});});
let serial=0;
function fixture(code){const day=String(++serial).padStart(2,'0');const a=E.createAccount({name:'Synthetic',credential:code});const s=E.createStudent({code,name:'PRIVATE_NAME',accountId:a.id,credential:code});const e=E.upsertEnrollment({studentId:s.id,subject:'מתמטיקה',level:'כיתה יא · 3 יחידות',teacherId:null});const b=E.reserveBooking({studentId:s.id,enrollmentId:e.id,start:`2028-08-${day}T10:00:00Z`,end:`2028-08-${day}T11:30:00Z`,durationMin:90});return{s,e,b};}
test('brief uses exact booking enrollment and leaves topic and readiness unknown',()=>{const f=fixture('brief-1');const brief=preparationBriefForBooking({bookingId:f.b,studentId:f.s.id});assert.equal(brief.level,'כיתה יא · 3 יחידות');assert.equal(brief.durationMin,90);assert.equal(brief.readiness,'unknown');assert.ok(brief.missing.includes('topic'));assert.doesNotMatch(JSON.stringify(brief),/PRIVATE_NAME|credential|accountId/);assert.throws(()=>preparationBriefForBooking({bookingId:f.b,studentId:f.s.id+999}),/ownership/);});
test('foreign enrollment never supplies another student level or subject',()=>{const a=fixture('brief-2'),b=fixture('brief-3');handle().prepare('UPDATE bookings_v2 SET enrollment_id=? WHERE id=?').run(b.e.id,a.b);const brief=preparationBriefForBooking({bookingId:a.b,studentId:a.s.id});assert.equal(brief.level,null);assert.equal(brief.subject,null);assert.ok(brief.missing.includes('enrollment'));assert.deepEqual(brief.observations,[]);});
test('replayed enqueue preserves the original preparation brief',async()=>{const{enqueueNativeLesson}=await import('../../src/lib/server/native-learning/jobs.ts');const f=fixture('brief-4');const first=enqueueNativeLesson({bookingId:f.b,studentId:f.s.id});assert.equal(first.snapshot.brief.version,1);handle().prepare("UPDATE enrollments SET level='כיתה יב · 5 יחידות' WHERE id=?").run(f.e.id);assert.deepEqual(enqueueNativeLesson({bookingId:f.b,studentId:f.s.id}).snapshot.brief,first.snapshot.brief);});

test('observations are scoped to the selected enrollment and coverage is not mastery',async()=>{
 const P=await import('../../src/lib/server/plans/store.ts');const a=fixture('brief-5'),b=fixture('brief-6');
 const template={id:'synthetic',version:1,topics:[{key:'topic',title:'Topic',branches:[{key:'branch',title:'Branch',skills:[{key:'skill',title:'Synthetic skill'}]}]}],prerequisites:[]};
 for(const f of[a,b]){const plan=P.createPlan({studentId:f.s.id,enrollmentId:f.e.id,template,goal:'Synthetic'});const node=P.planData(plan).nodes.find(n=>n.kind==='skill');P.addStatusEvent(plan,node.id,'with_help');P.addCoveredEvent(plan,node.id);}
 const brief=preparationBriefForBooking({bookingId:a.b,studentId:a.s.id});assert.equal(brief.observations.length,2);assert.equal(brief.observations[0].kind,'covered');assert.equal(brief.observations[0].status,null);assert.equal(brief.observations[1].status,'with_help');assert.equal(brief.readiness,'unknown');
});

test('practice preserves reveal and version identity; assigned sources never claim actual use',()=>{
 const f=fixture('brief-practice'),db=handle(),slug='brief-practice-source';
 db.prepare("INSERT INTO lessons(slug,student,subject,at,status,title) VALUES(?,?,?,'2028-01-01','ready','Practice')").run(slug,f.s.code,'מתמטיקה');
 db.prepare("INSERT INTO learning_assignments(lesson_slug,student_id,booking_id,practice_state) VALUES(?,?,?,'held')").run(slug,f.s.id,f.b);
 db.prepare("INSERT INTO lesson_materials(lesson_slug,kind,version,content,origin,published_at,created_at) VALUES(?,'plan',1,?,'generated','2028-01-01','2028-01-01')").run(slug,JSON.stringify({teaching:{sources:[{questionId:'moe-2025a-35372-3'}]}}));
 db.prepare("INSERT INTO native_results(student_id,booking_id,game_id,round_id,outcome,attempts,at) VALUES(?,?,'quiz','r1','assisted',2,'2028-01-01')").run(f.s.id,f.b);
 let b=preparationBriefForBooking({bookingId:f.b,studentId:f.s.id});assert.equal(b.practice[0].outcome,'assisted');assert.equal(b.practice[0].attempts,2);assert.equal(b.practice[0].gameId,'quiz');assert.equal(b.readiness,'unknown');assert.deepEqual(b.previousAssignedSourceIds,[]);
 db.prepare("UPDATE learning_assignments SET practice_state='assigned' WHERE lesson_slug=?").run(slug);b=preparationBriefForBooking({bookingId:f.b,studentId:f.s.id});assert.deepEqual(b.previousAssignedSourceIds,['moe-2025a-35372-3']);
 E.cancelBooking(f.b);assert.deepEqual(preparationBriefForBooking({bookingId:f.b,studentId:f.s.id}).previousAssignedSourceIds,[]);
});

test('authoring identity covers full runtime policy sources',async()=>{
 const{readFile}=await import('node:fs/promises');const{createHash}=await import('node:crypto');const m=JSON.parse(await readFile('src/lib/server/native-learning/authoring-manifest.json','utf8'));
 for(const [file,digest]of Object.entries(m.files))assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'),digest,file+' authoring manifest stale');
 assert.equal(createHash('sha256').update(JSON.stringify(m.files)).digest('hex'),m.fingerprint);
});
