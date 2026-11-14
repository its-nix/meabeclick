import {test,expect} from './fixtures.mjs';
import {DatabaseSync} from 'node:sqlite';
import {seedRetired} from '../learning-archive-fixture.mjs';
const NORMAL_REVIEW_CONTEXT={kind:'normal-distribution35372',purpose:'review',subject:'mathematics',educationLevel:'high-school',topic:'normal-distribution',track:'3',questionnaire:'35372',notation:'school-normal-s',durationMin:90,readiness:'percentages-and-mean-ready-normal-new',sourceId:'moe-2025a-35372-3'};

async function book(qa,level='כיתה יא · 3 יחידות'){
 const response=await qa.request('/api/book',{method:'POST',cookie:'',json:{name:'כיול נורמלית',subject:'מתמטיקה',level,phone:'0505551212',email:'native-calibration@example.test',durationMin:90,start:'2028-08-10T10:00:00+03:00',end:'2028-08-10T11:30:00+03:00'}});
 expect(response.status,await response.clone().text()).toBe(200);
 const result=await response.json(),student=qa.row('SELECT id FROM students_v2 WHERE code=?',result.portal.code),booking=qa.row('SELECT id FROM bookings_v2 WHERE student_id=?',student.id);
 return{bookingId:booking.id,studentId:student.id,code:result.portal.code};
}
function mutate(qa,callback){const db=new DatabaseSync(qa.dbPath);try{db.exec('PRAGMA busy_timeout=5000');return callback(db);}finally{db.close();}}
async function bind(qa,booking){return qa.request(`/api/native-lessons/${booking.bookingId}`,{method:'POST',json:{studentId:booking.studentId,context:NORMAL_REVIEW_CONTEXT}});}

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
 test('native-lessons: tutor confirms supported brief while unsupported bookings cannot be forced into it',async({qa})=>{
  mutate(qa,db=>seedRetired(db));const booking=await book(qa);
  const page=await qa.page('tutor');await page.goto(`/app/students/${booking.code}`);
  const panel=page.getByRole('region',{name:'הכנת שיעורים במרחב ההוראה'});await panel.locator('summary').click();
  const button=panel.getByRole('button',{name:'הכנת טיוטה לבדיקה',exact:true});await expect(button).toBeDisabled();
  await panel.getByRole('checkbox').check();const binding=page.waitForResponse(r=>r.url().endsWith(`/api/native-lessons/${booking.bookingId}`)&&r.request().method()==='POST');await button.click();expect((await binding).status()).toBe(200);
  await expect(panel.getByRole('status')).toContainText('בקשת ההכנה נשמרה');
  expect(JSON.parse(qa.row('SELECT snapshot FROM native_lesson_jobs WHERE booking_id=?',booking.bookingId).snapshot).context).toEqual(NORMAL_REVIEW_CONTEXT);
  // This isolated server has no personal OAuth token: the honest outcome is a private failure, never fake readiness.
  await expect.poll(()=>qa.row('SELECT state FROM native_lesson_jobs WHERE booking_id=?',booking.bookingId).state).toBe('failed');
  expect(qa.row('SELECT bundle FROM native_lesson_jobs WHERE booking_id=?',booking.bookingId).bundle).toBeNull();await qa.evidence(page,'native-explicit-context');
  const unsupported=qa.row('SELECT booking_id FROM native_lesson_jobs WHERE student_id=?',qa.learner.studentId);
  await expect.poll(()=>qa.row('SELECT reason FROM native_lesson_jobs WHERE booking_id=?',unsupported.booking_id).reason).toBe('unsupported_context');
  expect((await qa.request(`/api/native-lessons/${unsupported.booking_id}`,{method:'POST',json:{studentId:qa.learner.studentId,context:NORMAL_REVIEW_CONTEXT}})).status).toBe(409);
  expect((await bind(qa,{...booking,studentId:qa.learner.studentId})).status).toBe(409);
 });
});

test('native-lessons: protected interactive review writes no customer scores and private notes remain tutor-only',async({qa})=>{
 mutate(qa,db=>seedRetired(db));const booking=await book(qa);
 const privateUrl='https://docs.google.com/document/d/synthetic-private-notes/edit';
 mutate(qa,db=>db.prepare("UPDATE native_lesson_jobs SET state='review',bundle=? WHERE booking_id=?").run(JSON.stringify({state:'draft',tutorNotes:{url:privateUrl},studentDelivery:'blocked-owner-review-required'}),booking.bookingId));
 const before={results:qa.row('SELECT count(*) n FROM results_v2').n,events:qa.row('SELECT count(*) n FROM learning_events').n,homework:qa.row('SELECT count(*) n FROM homework').n};
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
 expect({results:qa.row('SELECT count(*) n FROM results_v2').n,events:qa.row('SELECT count(*) n FROM learning_events').n,homework:qa.row('SELECT count(*) n FROM homework').n}).toEqual(before);
});
