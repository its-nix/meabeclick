import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
process.env.DB_PATH=join(mkdtempSync(join(tmpdir(),'native-student-games-')),'db.sqlite');
const E=await import('../../src/lib/server/entities.ts');
const J=await import('../../src/lib/server/native-learning/jobs.ts');
const G=await import('../../src/lib/server/native-learning/games.ts');
const SG=await import('../../src/lib/server/native-learning/student-games.ts');
const RES=await import('../../src/lib/server/native-learning/results.ts');
const {visualDeckFixture}=await import('../visual-deck-fixture.mjs');
const account=E.createAccount({name:'S',credential:'sg'});
const student=E.createStudent({code:'sg-1',name:'S',accountId:account.id,credential:'sg'});
const other=E.createStudent({code:'sg-2',name:'O',accountId:account.id,credential:'sg2'});
let day=0;
async function approved(forStudent=student){
 day++;const d=String(day).padStart(2,'0'),bookingId=E.reserveBooking({studentId:forStudent.id,start:`2028-10-${d}T10:00:00.000Z`,end:`2028-10-${d}T11:30:00.000Z`,durationMin:90});
 J.enqueueNativeLesson({bookingId,studentId:forStudent.id});
 const text=G.gamesFileText(G.exportGamesFile(visualDeckFixture(),`booking-${bookingId}`));
 await G.approveNativeLesson({bookingId,sheetRevision:'r',materialId:`m-${bookingId}`,releaseId:'rel',fileId:'fileAAAAAAAAAA',drive:{read:async()=>({revisionId:'v',text})}});
 return {bookingId,version:createHash('sha256').update(text).digest('hex')};
}
const act=(id,b,body)=>SG.studentGameAction({studentId:id,bookingId:b.bookingId},{version:b.version,eventId:crypto.randomUUID(),...body});

test('a wrong then right answer is recorded for the session student, hints only after an attempt, and no answer leaks',async()=>{
 const b=await approved();
 assert.throws(()=>act(student.id,b,{taskId:'axis-1',action:'hint'}),e=>e.status===409);
 let r=act(student.id,b,{taskId:'axis-1',action:'attempt',input:'7'});assert.equal(r.correct,false);
 assert.ok(!JSON.stringify(r).includes('38'),'a wrong attempt does not reveal the answer');
 r=act(student.id,b,{taskId:'axis-1',action:'attempt',input:'38'});assert.equal(r.correct,true);
 const rows=RES.nativeResultsForStudent(student.id).filter(x=>x.bookingId===b.bookingId&&x.roundId==='axis-1');
 assert.deepEqual(rows.map(x=>[x.outcome,x.attempts]),[['incorrect',1],['correct',2]]);
});
test('a hint before a correct answer records assisted; a repeated event is not recorded twice',async()=>{
 const b=await approved();
 act(student.id,b,{taskId:'axis-2',action:'attempt',input:'1'});
 const hint=act(student.id,b,{taskId:'axis-2',action:'hint'});assert.equal(hint.assisted,true);
 const body={taskId:'axis-2',action:'attempt',input:'38',eventId:'ev-1'};
 SG.studentGameAction({studentId:student.id,bookingId:b.bookingId},{version:b.version,...body});
 SG.studentGameAction({studentId:student.id,bookingId:b.bookingId},{version:b.version,...body});
 const rows=RES.nativeResultsForStudent(student.id).filter(x=>x.bookingId===b.bookingId&&x.roundId==='axis-2');
 assert.deepEqual(rows.map(x=>x.outcome),['incorrect','assisted']);
});
test('another student cannot play or record against a copy approved for someone else; extra body identity is ignored',async()=>{
 const b=await approved();
 assert.throws(()=>SG.studentGameAction({studentId:other.id,bookingId:b.bookingId},{version:b.version,taskId:'axis-1',action:'attempt',input:'38',eventId:'e'}),e=>e.status===404);
 SG.studentGameAction({studentId:student.id,bookingId:b.bookingId},{version:b.version,taskId:'axis-1',action:'attempt',input:'38',eventId:'e2',studentId:other.id,bookingId:9999});
 assert.equal(RES.nativeResultsForStudent(other.id).length,0);
 assert.ok(RES.nativeResultsForStudent(student.id).some(x=>x.bookingId===b.bookingId));
});
test('stale version, unknown task and malformed bodies are refused without writing',async()=>{
 const b=await approved(),before=RES.nativeResultsForStudent(student.id).length;
 assert.throws(()=>SG.studentGameAction({studentId:student.id,bookingId:b.bookingId},{version:'x'.repeat(64),taskId:'axis-1',action:'attempt',input:'38',eventId:'e'}),e=>e.status===409);
 assert.throws(()=>act(student.id,b,{taskId:'nope',action:'attempt',input:'1'}),e=>e.status===404);
 assert.throws(()=>SG.studentGameAction({studentId:student.id,bookingId:b.bookingId},null),e=>e.status===400);
 assert.throws(()=>act(student.id,b,{taskId:'region-1',action:'attempt',input:[3,-3]}),e=>e.status===400);
 assert.equal(RES.nativeResultsForStudent(student.id).length,before);
});
test('the listing is answer-free and scoped to the student',async()=>{
 const b=await approved();const lessons=G.approvedGameLessonsForStudent(student.id);
 assert.ok(lessons.some(l=>l.bookingId===b.bookingId&&l.games.length===2));
 const json=JSON.stringify(lessons);assert.ok(!json.includes('"solution"')&&!json.includes('"answer"')&&!json.includes('"hints"'));
 assert.deepEqual(G.approvedGameLessonsForStudent(other.id),[]);
});
test('a quiz game plays end to end: choice and number graded, open round waits for the tutor',async()=>{
 day++;const d=String(day).padStart(2,'0'),bookingId=E.reserveBooking({studentId:student.id,start:`2028-10-${d}T10:00:00.000Z`,end:`2028-10-${d}T11:30:00.000Z`,durationMin:90});
 J.enqueueNativeLesson({bookingId,studentId:student.id});
 const base=visualDeckFixture(),hw=base.homework[0],round=(id,patch)=>({...structuredClone(hw),id,model:null,...patch});
 base.games=[{id:'quiz-game',title:'חידון קצר',intro:'שלוש שאלות על מה שלמדנו.',kind:'quiz',rounds:[round('quiz-1',{check:{kind:'choice',answer:1,options:['א','ב','ג']}}),round('quiz-2',{check:{kind:'number',answer:7,options:[]}}),round('quiz-3',{grading:'tutor-review',check:null}),...Array.from({length:7},(_,i)=>round('quiz-'+(i+4),{check:{kind:'number',answer:i,options:[]}}))].map((r,i)=>({...r,difficulty:i<4?1:i<7?2:3}))}];
 const text=G.gamesFileText(G.exportGamesFile(base,`booking-${bookingId}`));
 await G.approveNativeLesson({bookingId,sheetRevision:'r',materialId:`m-${bookingId}`,releaseId:'rel',fileId:'fileAAAAAAAAAA',drive:{read:async()=>({revisionId:'v',text})}});
 const b={bookingId,version:createHash('sha256').update(text).digest('hex')};
 assert.equal(act(student.id,b,{taskId:'quiz-1',action:'attempt',input:'1'}).correct,true);
 assert.equal(act(student.id,b,{taskId:'quiz-2',action:'attempt',input:'7'}).correct,true);
 act(student.id,b,{taskId:'quiz-3',action:'attempt',input:'כי ככה זה עובד'});
 const out=Object.fromEntries(RES.nativeResultsForStudent(student.id).filter(x=>x.bookingId===bookingId).map(x=>[x.roundId,x.outcome]));
 assert.deepEqual(out,{'quiz-1':'correct','quiz-2':'correct','quiz-3':'awaiting-review'});
 const pub=JSON.stringify(G.approvedGamesForStudent(student.id,bookingId));assert.ok(!pub.includes('"answer"'));
});
