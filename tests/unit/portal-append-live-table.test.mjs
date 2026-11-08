/**
 * Whether a generated lesson ever reaches the student's page.
 *
 * appendToPortal() is the last step of generation: the plan is written to
 * slides.html, the game data files land, the lessons row goes `ready`, and
 * then this adds the lesson, its homework and its games to the student's
 * portal file — which is the ONLY thing /api/portal/[code] serves those
 * three from.
 *
 * It looked the student up with db.ts's getStudent(), which reads `FROM
 * students` — the table the students_v2 migration retired. Production on
 * 2026-09-21 held three rows in the legacy table (noga, nikol, nikol2) and
 * seven in students_v2, so every student enrolled since the migration
 * resolved to null here, the function returned false, and the caller
 * discarded that false.
 *
 * The result was silent and expensive. Four lessons had been generated —
 * minutes of billed agent time each — with slides.html on disk, game data
 * on disk, and `status: ready` in the database, while every portal file on
 * the box held `lessons: [], homework: [], games: []`. Tutor and student
 * both saw an empty page, and nothing anywhere reported a failure.
 *
 * The lookup belongs to entities.ts, which is the module that owns
 * students_v2. db.ts's same-named getStudent is the legacy reader, and
 * db.ts already carries a comment about exactly this hazard for getBest,
 * where two same-named functions over the old and new tables were conflated
 * once before.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = await mkdtemp(join(tmpdir(), 'portal-append-'));
process.env.DATA_DIR = dataDir;
process.env.DB_PATH = join(dataDir, 'results.db');
process.env.PORTAL_DIR = join(dataDir, 'portal');
await mkdir(process.env.PORTAL_DIR, { recursive: true });

const E = await import('../../src/lib/server/entities.ts');
const { appendToPortal } = await import('../../src/lib/server/lesson/queue.ts');
const HW = await import('../../src/lib/server/lessons.ts');

const account = E.createAccount({ name: 'משפחה', credential: 'fam' });

/** Exactly production's shape: present in students_v2, absent from the
 *  retired `students` table. */
function liveOnlyStudent(code) {
  return E.createStudent({ code, name: 'תלמידה', accountId: account.id, credential: 'p' });
}

async function portalFileFor(code, seed = {}) {
  const path = join(process.env.PORTAL_DIR, `${code}.json`);
  await writeFile(path, JSON.stringify({
    name: 'תלמידה', emoji: '🎓', subject: 'מתמטיקה',
    lessons: [], homework: [], games: [], ...seed,
  }, null, 2));
  return path;
}

const plan = {
  title: 'שברים',
  gradeContext: 'כיתה י',
  slides: [{ heading: 'a', bullets: ['b'] }],
  examples: [{ problem: 'p', steps: ['s'], answer: 'a' }],
  homework: [{ task: 'צמצמו 18/24', why: 'גורמים משותפים' }],
  games: {},
};
const published = { slug: 'lesson-slug', games: [{ title: 'זיכרון', template: 'memory', dataId: 'lesson-slug-memory' }] };

test('a student who exists only in students_v2 gets the lesson on their page', async () => {
  const code = 'liveonly';
  const studentId = liveOnlyStudent(code).id;
  const path = await portalFileFor(code);

  const ok = await appendToPortal(code, plan, published);
  assert.equal(ok, true, 'the legacy-table lookup returned false here for every post-migration student');

  const data = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(data.lessons.length, 1, 'the lesson must reach the file /api/portal serves');
  assert.equal(data.lessons[0].topic, 'שברים');
  assert.equal(data.lessons[0].slug, 'lesson-slug');
  assert.equal(data.games.length, 1);

  /* Homework is deliberately NOT here any more. It goes to the homework
     table, which is the single store both sides read — the file version was
     invisible to the tutor and could not derive `done` from the student's
     own game results. See tests/characterization/homework-one-store.test.mjs. */
  assert.deepEqual(data.homework ?? [], [],
    'homework belongs in the table, not in this file');
  assert.equal(HW.homeworkForStudent(studentId).length, 1,
    'and it must actually be in the table');
});

test('existing entries are kept, newest first', async () => {
  const code = 'hashistory';
  liveOnlyStudent(code);
  const path = await portalFileFor(code, {
    lessons: [{ date: '2020-01-01', topic: 'ישן' }],
    games: [{ title: 'ישן', url: '/app/play/quiz?d=old' }],
  });

  assert.equal(await appendToPortal(code, plan, published), true);
  const data = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(data.lessons.length, 2);
  assert.equal(data.lessons[0].topic, 'שברים', 'the new lesson goes on top');
  assert.equal(data.lessons[1].topic, 'ישן', 'and the old one survives');
  // The old {title,url} game shape must not be rewritten — /api/portal
  // tolerates both shapes precisely because publish() only ever prepends.
  assert.equal(data.games[1].url, '/app/play/quiz?d=old');
});

test('an unknown code is still refused, rather than writing a stray file', async () => {
  assert.equal(await appendToPortal('no-such-student', plan, published), false);
  assert.equal(await appendToPortal(null, plan, published), false);
});

test("a generated lesson's homework keeps its written order, however long writing it takes", async () => {
  const code = 'manytasks';
  const studentId = liveOnlyStudent(code).id;
  await portalFileFor(code);
  const homework = Array.from({ length: 300 }, (_, i) => ({ task: `תרגיל ${i + 1}`, why: 'w' }));
  assert.equal(await appendToPortal(code, { ...plan, homework }, published), true);
  assert.deepEqual(HW.homeworkForStudent(studentId).map(h => h.task), homework.map(h => h.task));
});

async function reportedBooking(code) {
  const student=liveOnlyStudent(code),path=await portalFileFor(code,{games:[{title:'already delivered',template:'memory',dataId:'old-delivered'}]});
  E.upsertEnrollment({studentId:student.id,subject:'מתמטיקה',level:'ט',teacherId:null});
  const enrollment=E.enrollmentsForStudent(student.id)[0],P=await import('../../src/lib/server/plans/store.ts');
  const template={id:'late-games',version:1,subject:'מתמטיקה',track:'test',reviewed:null,topics:[{key:'t',title:'t',branches:[{key:'b',title:'b',skills:[{key:'s',title:'s',requires:[]}]}]}]};
  const planId=P.createPlan({studentId:student.id,enrollmentId:enrollment.id,template,goal:'test'}),skill=P.planData(planId).nodes.find(n=>n.kind==='skill');
  const {handle}=await import('../../src/lib/server/db.ts');
  const bookingId=Number(handle().prepare(`INSERT INTO bookings_v2(student_id,enrollment_id,start,"end",duration,at,status) VALUES(?,?,'2026-01-01T10:00:00Z','2026-01-01T11:00:00Z',60,'2026-01-01','confirmed')`).run(student.id,enrollment.id).lastInsertRowid);
  return {student,path,bookingId,skill,handle};
}
const explicit=(covered=false)=>({source:'manual',topics:covered?[{id:'one-part',title:'רק חלק אחד',sceneIds:[],skillKeys:['s'],covered:true,comment:null}]:[]});

test('late generated games after explicit zero or partial coverage stay preparation without evidence links',async()=>{
 const R=await import('../../src/lib/server/reports/store.ts');
 for(const partial of [false,true]){
  const s=await reportedBooking(`late-explicit-${partial}`);
  R.fileReport({bookingId:s.bookingId,note:null,entries:[],expectedRevision:0,coverage:explicit(partial)});
  await appendToPortal(s.student.code,plan,published,{id:s.skill.id,key:'s',title:'s',templateId:'late-games'},{bookingId:s.bookingId,heldUntil:'2099-01-01'});
  const data=JSON.parse(await readFile(s.path,'utf8'));assert.deepEqual(data.games.map(g=>g.dataId),['old-delivered']);
  assert.equal(s.handle().prepare('SELECT count(*) n FROM game_skills WHERE student_id=?').get(s.student.id).n,0);
 }
});

test('a report correction during the async portal read cannot publish stale generated games',async()=>{
 const R=await import('../../src/lib/server/reports/store.ts'),s=await reportedBooking('late-correction');
 R.fileReport({bookingId:s.bookingId,note:null,entries:[],expectedRevision:0});
 const pending=appendToPortal(s.student.code,plan,published,{id:s.skill.id,key:'s',title:'s',templateId:'late-games'},{bookingId:s.bookingId,heldUntil:'2099-01-01',reportRevision:1});
 R.fileReport({bookingId:s.bookingId,note:null,entries:[],expectedRevision:1,coverage:explicit()});
 assert.equal(await pending,true);assert.deepEqual(JSON.parse(await readFile(s.path,'utf8')).games.map(g=>g.dataId),['old-delivered']);
 assert.equal(s.handle().prepare('SELECT count(*) n FROM game_skills WHERE student_id=?').get(s.student.id).n,0);
});
