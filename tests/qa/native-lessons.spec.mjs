import {test,expect} from './fixtures.mjs';
import {DatabaseSync} from 'node:sqlite';
import {seedRetired} from '../learning-archive-fixture.mjs';
const PREPARATION={request:'להבין שטחים בעקומה',priorKnowledge:'מבין ממוצע ומתקשה באחוזים'};

async function book(qa,level='כיתה יא · 3 יחידות'){
 const response=await qa.request('/api/book',{method:'POST',cookie:'',json:{name:'כיול נורמלית',subject:'מתמטיקה',level,phone:'0505551212',email:'native-calibration@example.test',durationMin:90,start:'2028-08-10T10:00:00+03:00',end:'2028-08-10T11:30:00+03:00'}});
 expect(response.status,await response.clone().text()).toBe(200);
 const result=await response.json(),student=qa.row('SELECT id FROM students_v2 WHERE code=?',result.portal.code),booking=qa.row('SELECT id FROM bookings_v2 WHERE student_id=?',student.id);
 return{bookingId:booking.id,studentId:student.id,code:result.portal.code};
}
function mutate(qa,callback){const db=new DatabaseSync(qa.dbPath);try{db.exec('PRAGMA busy_timeout=5000');return callback(db);}finally{db.close();}}
async function bind(qa,booking){return qa.request(`/api/native-lessons/${booking.bookingId}`,{method:'POST',json:{studentId:booking.studentId,preparation:PREPARATION}});}

test('native-lessons: a real booking is durable and flag-off authoring stays tutor-visible and private',async({qa})=>{
 mutate(qa,db=>seedRetired(db));const booking=await book(qa);
 expect(qa.row('SELECT count(*) n FROM native_lesson_jobs WHERE booking_id=?',booking.bookingId).n).toBe(1);
 expect((await bind(qa,booking)).status).toBe(200);
 expect((await qa.request(`/api/native-lessons/${booking.bookingId}`,{method:'POST',json:null})).status).toBe(400);
 await expect.poll(()=>qa.row('SELECT state FROM native_lesson_jobs WHERE booking_id=?',booking.bookingId).state).toBe('needs-preparation');
 const job=await(await qa.request(`/api/native-lessons/${booking.bookingId}`)).json();expect(job.job.reason).toBe('authoring_disabled');expect(job.job.bundle).toBeNull();
 const page=await qa.page('tutor');await page.goto('/app/dashboard');
 await expect(page.getByRole('heading',{name:'הכנת שיעורים',exact:true})).toBeVisible();await expect(page.getByText('היצירה החדשה ממתינה לבדיקת איכות של חבילת הניסוי. נדרשת הכנת מורה.')).toBeVisible();
 await expect(page.getByRole('button',{name:'הכנת טיוטה לבדיקה',exact:true})).toHaveCount(0);await qa.evidence(page,'native-authoring-disabled');
 for(const role of ['anonymous','student','parent']){
  const response=await qa.request(`/api/native-lessons/${booking.bookingId}`,{cookie:qa.cookies[role]});expect(response.status).toBe(401);expect(await response.text()).not.toContain('tutorNotes');
 }
});

test.describe('explicit tutor context',()=>{
 test.use({nativeAuthoring:true});
 test('native-lessons: tutor confirms the brief for any booking and a booking of another student cannot be bound',async({qa})=>{
  mutate(qa,db=>seedRetired(db));const booking=await book(qa);
  const page=await qa.page('tutor');await page.goto(`/app/students/${booking.code}`);
  const panel=page.getByRole('region',{name:'הכנת שיעורים במרחב ההוראה'});await panel.locator('summary').click();
  await expect(panel).toContainText('10/08/2028 10:00');
  const button=panel.getByRole('button',{name:'הכנת טיוטה לבדיקה',exact:true});await expect(button).toBeDisabled();
  await panel.getByLabel('מה מטרת השיעור?').fill('להבין שטחים בעקומה');await panel.getByLabel('מה התלמיד/ה כבר יודע/ת ואיפה נתקע/ת?').fill('מבין ממוצע ומתקשה באחוזים');
  await panel.getByRole('checkbox').check();const binding=page.waitForResponse(r=>r.url().endsWith(`/api/native-lessons/${booking.bookingId}`)&&r.request().method()==='POST');await button.click();expect((await binding).status()).toBe(200);
  await expect(panel.getByRole('status')).toContainText('בקשת ההכנה נשמרה');
  expect(JSON.parse(qa.row('SELECT snapshot FROM native_lesson_jobs WHERE booking_id=?',booking.bookingId).snapshot).brief).toMatchObject({request:PREPARATION.request,priorKnowledge:PREPARATION.priorKnowledge,readiness:'tutor-reported',missing:[]});
  // This isolated server has no personal OAuth token: the honest outcome is a private failure, never fake readiness.
  await expect.poll(()=>qa.row('SELECT state FROM native_lesson_jobs WHERE booking_id=?',booking.bookingId).state).toBe('failed');
  expect(qa.row('SELECT bundle FROM native_lesson_jobs WHERE booking_id=?',booking.bookingId).bundle).toBeNull();await qa.evidence(page,'native-explicit-context');
  expect((await bind(qa,{...booking,studentId:qa.learner.studentId})).status).toBe(409);
  await page.reload();await panel.locator('summary').click();await panel.getByLabel('מה מטרת השיעור?').fill('להבין שטחים בעקומה');await panel.getByLabel('מה התלמיד/ה כבר יודע/ת ואיפה נתקע/ת?').fill('עדיין לא נבדק');await panel.getByRole('checkbox').check();
  await page.route(`**/api/native-lessons/${booking.bookingId}`,route=>route.fulfill({status:401,json:{error:'unauthorized'}}));
  await button.click();await expect(page.getByText('ההתחברות הסתיימה, והשינוי האחרון לא נשמר. צריך להתחבר מחדש.')).toBeVisible();
  await expect(page.getByRole('link',{name:'להתחברות',exact:true})).toHaveAttribute('href','/login?next=/app/dashboard');
 });
});

test('native-lessons: protected interactive review writes no customer scores and private notes remain tutor-only',async({qa})=>{
 mutate(qa,db=>seedRetired(db));const booking=await book(qa);
 const privateUrl='https://docs.google.com/document/d/synthetic-private-notes/edit';
 mutate(qa,db=>db.prepare("UPDATE native_lesson_jobs SET state='review',bundle=? WHERE booking_id=?").run(JSON.stringify({state:'draft',tutorNotes:{url:privateUrl},studentDelivery:'blocked-owner-review-required'}),booking.bookingId));
 const before={results:qa.row('SELECT count(*) n FROM native_results').n,events:qa.row('SELECT count(*) n FROM native_results').n,homework:qa.row('SELECT count(*) n FROM homework').n};
 const anon=await qa.page('anonymous');await anon.goto('/app/native-review-activities?view=homework');await expect(anon).toHaveURL(/\/login/);
 for(const role of ['parent','student']){expect((await qa.request('/app/native-review-activities?view=homework',{cookie:qa.cookies[role]})).status).toBe(302);expect((await qa.request(`/api/native-lessons/${booking.bookingId}`,{cookie:qa.cookies[role]})).status).toBe(401);}
 const tutorJob=await(await qa.request(`/api/native-lessons/${booking.bookingId}`)).json();expect(tutorJob.job.bundle.tutorNotes.url).toBe(privateUrl);
 const page=await qa.page('tutor');const response=await page.goto('/app/native-review-activities?view=homework');expect(response.status()).toBe(200);expect(response.headers()['cache-control']).toContain('no-store');
 await expect(page.getByRole('link',{name:'הערות למורה',exact:true})).toHaveCount(0);await expect(page.getByRole('link',{name:'מצגת',exact:true})).toHaveCount(0);
 const task=page.locator('.task-card').first();await expect(task).toBeVisible();
 if(await task.locator('[data-number]').count())await task.locator('[data-number]').fill('0');
 else if(await task.locator('[data-region]').count()){await task.locator('[data-region="lower"]').selectOption('-1');await task.locator('[data-region="upper"]').selectOption('1');}
 else if(await task.locator('[data-choice]').count())await task.locator('[data-choice]').first().click();
 else await task.locator('textarea').fill('ניסיון בתצוגת בדיקה בלבד');
 const attempt=page.waitForResponse(r=>r.url().endsWith('/api/learning-pilot')&&r.request().method()==='POST');
 await task.locator('[data-task-action="attempt"]').click();expect((await attempt).status()).toBe(200);await expect(task.locator('[data-task-feedback]')).not.toBeEmpty();await qa.evidence(page,'native-private-activity');
 for(const [role,path]of [['student',`/app/student?s=${qa.learner.code}`],['parent',`/app/parent?s=${qa.learner.code}`]]){const family=await qa.page(role);await family.goto(path);expect(await family.content()).not.toContain(privateUrl);}
 expect({results:qa.row('SELECT count(*) n FROM native_results').n,events:qa.row('SELECT count(*) n FROM native_results').n,homework:qa.row('SELECT count(*) n FROM homework').n}).toEqual(before);
});

test('native-lessons: saved booking activities use their own content and grading with no student evidence writes',async({qa})=>{
 const {default:corpus}=await import('../../src/lib/server/learning-pilot-corpus.json',{with:{type:'json'}});
 mutate(qa,db=>seedRetired(db));const booking=await book(qa),bundle=structuredClone(corpus.bundle);
 bundle.homework[0].title='תרגול ייחודי לשיעור זה';
 const version='c'.repeat(64);
 mutate(qa,db=>{const row=db.prepare('SELECT snapshot FROM native_lesson_jobs WHERE booking_id=?').get(booking.bookingId);db.prepare("UPDATE native_lesson_jobs SET state='review',snapshot=? WHERE booking_id=?").run(JSON.stringify({...JSON.parse(row.snapshot),authored:{bundle,version}}),booking.bookingId);});
 const page=await qa.page('tutor');await page.goto(`/app/native-review-activities/${booking.bookingId}?view=homework`);
 await expect(page.getByRole('heading',{name:'תרגול ייחודי לשיעור זה'})).toBeVisible();
 const config=await page.locator('#deck-config').textContent();expect(config).toContain(`/api/native-activities/${booking.bookingId}`);expect(config).not.toContain('presenterNotes');expect(config).not.toContain('expectedAnswer');
 const before=qa.row('SELECT count(*) n FROM native_results').n;
 const task=bundle.homework[0];const result=await page.evaluate(async({id,version,taskId})=>{const r=await fetch(`/api/native-activities/${id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version,taskId,action:'attempt',input:'0',eventId:'booking-attempt'})});return r.status;},{id:booking.bookingId,version,taskId:task.id});expect(result).toBe(200);
 expect(qa.row('SELECT count(*) n FROM native_results').n).toBe(before);
 expect((await qa.request(`/api/native-activities/${booking.bookingId}`,{method:'POST',cookie:'',json:{}})).status).toBe(401);
 mutate(qa,db=>db.prepare("UPDATE bookings_v2 SET status='cancelled' WHERE id=?").run(booking.bookingId));
 expect((await qa.request(`/app/native-review-activities/${booking.bookingId}?view=homework`)).status).toBe(404);
});

test('native-lessons: canonical synthetic review sample opens without creating customer records',async({qa})=>{
 const before=qa.row('SELECT count(*) n FROM bookings_v2').n,events=qa.row('SELECT count(*) n FROM native_results').n;
 const page=await qa.page('tutor');const r=await page.goto('/app/native-review-activities/sample?view=homework');expect(r.status()).toBe(200);await expect(page.locator('.task-card').first()).toBeVisible();expect(await page.locator('#deck-config').textContent()).not.toContain('presenterNotes');
 expect(qa.row('SELECT count(*) n FROM bookings_v2').n).toBe(before);expect(qa.row('SELECT count(*) n FROM native_results').n).toBe(events);
 expect((await qa.request('/api/native-activities/sample',{method:'POST',cookie:'',json:{}})).status).toBe(401);
 await qa.evidence(page,'native-reviewed-sample');
});

test('native-lessons: preparation progress refreshes automatically when a draft becomes ready',async({qa})=>{
 mutate(qa,db=>seedRetired(db));const b=await book(qa);mutate(qa,db=>db.prepare("UPDATE native_lesson_jobs SET state='preparing',attempts=1,lease_until='2099-01-01T00:00:00Z' WHERE booking_id=?").run(b.bookingId));
 const page=await qa.page('tutor');await page.clock.install();await page.goto(`/app/students/${b.code}`);const panel=page.getByRole('region',{name:'הכנת שיעורים במרחב ההוראה'});await expect(panel).toContainText('בהכנה');
 const url='https://docs.google.com/presentation/d/synthetic-ready/edit';mutate(qa,db=>db.prepare("UPDATE native_lesson_jobs SET state='review',lease_until=NULL,bundle=? WHERE booking_id=?").run(JSON.stringify({slides:{url},studentDelivery:'blocked-owner-review-required'}),b.bookingId));
 await page.clock.fastForward(16000);await expect(panel.getByRole('link',{name:'מצגת והערות למורה',exact:true})).toHaveAttribute('href',url);
});

test('native-lessons: feedback queue and controls are tutor-only and disabled by default',async({qa})=>{
 for(const role of ['anonymous','parent','student']){const cookie=role==='anonymous'?'':qa.cookies[role];for(const method of ['GET','POST']){const response=await qa.request('/api/learning-feedback',{method,cookie,...(method==='POST'?{json:{action:'tick'}}:{})});expect(response.status).toBe(401);}}
 const response=await qa.request('/api/learning-feedback');expect(response.status).toBe(200);const body=await response.json();expect(body.enabled).toBe(false);expect(body.artifacts).toEqual([]);expect((await qa.request('/api/learning-feedback',{method:'POST',json:{action:'accept',validation:{status:'pass'}}})).status).toBe(400);
});

test.describe('feedback discovery',()=>{
 test.use({learningFeedback:true});
 test('native-lessons: enabled feedback links the existing teaching index on phone and desktop',async({qa})=>{
  mutate(qa,db=>seedRetired(db));const page=await qa.page('tutor');await page.goto('/app/dashboard');const link=page.getByRole('link',{name:'משוב ובדיקת חומרים',exact:true});await expect(link).toBeVisible();await expect(link).toHaveAttribute('href','https://docs.google.com/spreadsheets/d/sourceindex123/edit');expect((await(await qa.request('/api/learning-feedback')).json()).enabled).toBe(true);await qa.evidence(page,'native-feedback-index-link');
 });
});

test('native-lessons: tutor sees native game results and decides an open answer, nothing leaks to other roles',async({qa})=>{
 mutate(qa,db=>seedRetired(db));const booking=await book(qa);
 const game={id:'g1',title:'משחק בדיקה',kind:'quiz',rounds:[{id:'r1',prompt:'שאלה פתוחה',objectiveId:'o1',grading:'tutor-review',solution:'SECRET-KEY'}]};
 mutate(qa,db=>{
  db.prepare(`INSERT INTO native_games (material_id,release_id,student_id,booking_id,game_id,kind,content_json,source_file_id,source_revision,content_sha256,approved_at) VALUES ('m-qa','rel',?,?,'g1','quiz',?,'f','1','h','2028-08-01T00:00:00Z')`).run(booking.studentId,booking.bookingId,JSON.stringify(game));
  db.prepare(`INSERT INTO native_results (student_id,booking_id,game_id,round_id,skill_node_id,outcome,attempts,seconds,at) VALUES (?,?,'g1','r1',NULL,'awaiting-review',1,30,'2028-08-10T12:00:00.000Z')`).run(booking.studentId,booking.bookingId);
 });
 const page=await qa.page('tutor');await page.setViewportSize({width:390,height:844});await page.goto(`/app/students/${booking.code}`);
 const section=page.getByRole('region',{name:'תוצאות משחקים'});await expect(section).toContainText('משחק בדיקה');await expect(section).toContainText('ממתין לבדיקת המורה');
 expect(await section.textContent()).not.toContain('SECRET-KEY');await qa.evidence(page,'native-results-awaiting');
 const saved=page.waitForResponse(r=>r.url().endsWith(`/api/students/${booking.code}/native-results`)&&r.request().method()==='POST');
 await section.getByRole('button',{name:'נכון בעזרה',exact:true}).click();expect((await saved).status()).toBe(200);
 await expect(section.getByRole('button',{name:'נכון',exact:true})).toHaveCount(0);await expect(section).toContainText('נכון בעזרה');
 expect(qa.row('SELECT outcome FROM native_results WHERE student_id=?',booking.studentId).outcome).toBe('assisted');await qa.evidence(page,'native-results-decided');
 expect((await qa.request(`/api/students/${booking.code}/native-results`,{method:'POST',json:{resultId:1,outcome:'correct'}})).status).toBe(409);
 for(const role of ['anonymous','student','parent']){const r=await qa.request(`/api/students/${booking.code}/native-results`,{cookie:qa.cookies[role]});expect(r.status).toBe(401);}
});
