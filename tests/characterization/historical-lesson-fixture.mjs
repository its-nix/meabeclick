import {DatabaseSync} from 'node:sqlite';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';

/** Historical readers do not depend on new bookings invoking retired authoring. */
export function seedHistoricalLesson(server,code,{slug='historical-editor-lesson',title='שיעור היסטורי'}={}){
 const db=new DatabaseSync(server.dbPath);db.exec('PRAGMA busy_timeout=5000');
 try{
  const student=db.prepare('SELECT id,name FROM students_v2 WHERE code=?').get(code);
  const booking=db.prepare('SELECT start FROM bookings_v2 WHERE student_id=? ORDER BY id DESC LIMIT 1').get(student.id);
  db.prepare("INSERT INTO lessons(slug,student,subject,level,title,status,at,lesson_at) VALUES(?,?,'מתמטיקה','כיתה ט',?,'ready',?,?)").run(slug,student.name,title,new Date().toISOString(),booking.start);
  db.prepare('INSERT INTO learning_assignments(lesson_slug,student_id) VALUES(?,?)').run(slug,student.id);
  return slug;
 }finally{db.close();}
}

/** Exercise historical copy compatibility explicitly, outside the booking hook. No real engine is reachable. */
export function copyHistoricalLibraryLesson(server,code){
 const script=`
  import {handle} from './src/lib/server/db.ts';
  import {triggerForBooking} from './src/lib/server/lesson/queue.ts';
  const db=handle(),student=db.prepare('SELECT id,name FROM students_v2 WHERE code=?').get(process.argv[1]);
  const booking=db.prepare('SELECT b.*,e.subject,e.level FROM bookings_v2 b JOIN enrollments e ON e.id=b.enrollment_id WHERE b.student_id=? ORDER BY b.id DESC LIMIT 1').get(student.id);
  const result=triggerForBooking({name:student.name,subject:booking.subject,level:booking.level,start:booking.start,end:booking.end,durationMin:booking.duration},{enrolledCode:process.argv[1],bookingId:booking.id,notify:()=>{}});
  if(!result.started)throw Error('historical fixture did not start a library copy: '+result.skipped);
  const deadline=Date.now()+5000;
  for(;;){const row=db.prepare('SELECT status FROM lessons WHERE slug=?').get(result.slug);if(row?.status==='ready')break;if(row?.status==='failed'||Date.now()>deadline)throw Error('historical library fixture did not become ready');await new Promise(resolve=>setTimeout(resolve,20));}
  process.stdout.write(result.slug);
 `;
 return execFileSync(process.execPath,['--input-type=module','-e',script,code],{cwd:process.cwd(),timeout:10_000,encoding:'utf8',env:{PATH:process.env.PATH,LANG:process.env.LANG,DB_PATH:server.dbPath,DATA_DIR:server.dataDir,PORTAL_DIR:join(server.dataDir,'portal'),SITE_URL:server.baseUrl,SESSION_SECRET:'test-secret-not-a-real-one',CODEX_HOME:join(server.dataDir,'codex-home-empty'),CODEX_BIN:join(server.dataDir,'no-such-agent'),LESSON_GENERATION_VERSION:'1',NATIVE_LESSON_AUTHORING_ENABLED:'false',OPENAI_API_KEY:'',GOOGLE_OAUTH_REFRESH_TOKEN:'',GOOGLE_OAUTH_CLIENT_ID:'',GOOGLE_OAUTH_CLIENT_SECRET:'',GMAIL_USER:'',GMAIL_APP_PASSWORD:'',CALLMEBOT_API_KEY:''}}).trim();
}
