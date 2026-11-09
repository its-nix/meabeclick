import{test}from'node:test';import assert from'node:assert/strict';import{DatabaseSync}from'node:sqlite';import{startServer,login}from'./harness.mjs';import{seedLearning}from'./learning-fixture.mjs';import{teachingFixture}from'../teaching-fixture.mjs';
test('the live report records objective coverage and releases only the selected homework',async()=>{
 const server=await startServer();try{
  const pupil=await seedLearning(server),teacher=await login(server.baseUrl),db=new DatabaseSync(server.dbPath),p=teachingFixture();
  p.teaching.objectives.push({id:'untaught',title:'יעד נוסף שלא נלמד',evidence:'נימוק עצמאי'});p.teaching.practice.find(x=>x.ref==='homework-2').objectiveId='untaught';
  const booking=db.prepare('SELECT id FROM bookings_v2 WHERE student_id=?').get(pupil.studentId),start=new Date(Date.now()-120*60000).toISOString(),end=new Date(Date.now()-75*60000).toISOString(),deadline=new Date(Date.now()+22*3600000).toISOString();
  db.prepare('UPDATE bookings_v2 SET start=?,"end"=? WHERE id=?').run(start,end,booking.id);db.prepare('UPDATE lessons SET lesson_at=? WHERE slug=?').run(start,pupil.slug);
  db.prepare("UPDATE lesson_materials SET content=? WHERE lesson_slug=? AND kind='plan'").run(JSON.stringify(p),pupil.slug);
  db.prepare("UPDATE learning_assignments SET booking_id=?,practice_state='held',held_until=? WHERE lesson_slug=?").run(booking.id,deadline,pupil.slug);
  db.prepare('INSERT INTO homework(student_id,task,assigned_at,booking_id,held_until) VALUES(?,?,?,?,?)').run(pupil.studentId,'הכנה מוחזקת',start,booking.id,deadline);
  const coverage={lessonSlug:pupil.slug,materialVersion:1,objectiveIds:['o1']},post=body=>fetch(server.baseUrl+'/api/reports',{method:'POST',headers:{Cookie:teacher,'Content-Type':'application/json'},body:JSON.stringify({bookingId:booking.id,note:null,entries:[],...body})});
  const response=await post({coverage});assert.equal(response.status,200,await response.clone().text());
  const target=db.prepare('SELECT practice_material_slug FROM learning_assignments WHERE lesson_slug=?').get(pupil.slug).practice_material_slug;
  const released=JSON.parse(db.prepare("SELECT content FROM lesson_materials WHERE lesson_slug=? AND kind='plan' AND published_at IS NOT NULL ORDER BY version DESC LIMIT 1").get(target).content);
  assert.equal(released.homework.length,1,'untaught objective must not be released through the real API');
  const saved=JSON.parse(db.prepare('SELECT teaching_coverage FROM lesson_report_notes ORDER BY id DESC LIMIT 1').get().teaching_coverage);assert.deepEqual(saved.objectiveIds,['o1']);
  const form=await fetch(`${server.baseUrl}/app/report/${booking.id}`,{headers:{Cookie:teacher}});assert.match(await form.text(),/יעד נוסף שלא נלמד/);
  assert.equal((await post({coverage:{...coverage,objectiveIds:['forged']}})).status,400);
  assert.equal((await post({coverage:{...coverage,materialVersion:99}})).status,409);
  assert.equal((await post({})).status,409);db.close();
 }finally{await server.stop();}
});
