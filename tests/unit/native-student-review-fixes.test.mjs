import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
process.env.DB_PATH=join(mkdtempSync(join(tmpdir(),'native-student-review-')),'db.sqlite');
const E=await import('../../src/lib/server/entities.ts');
const {handle}=await import('../../src/lib/server/db.ts');
const J=await import('../../src/lib/server/native-learning/jobs.ts');
const G=await import('../../src/lib/server/native-learning/games.ts');
const SG=await import('../../src/lib/server/native-learning/student-games.ts');
const SS=await import('../../src/lib/server/native-learning/student-session.ts');
const RES=await import('../../src/lib/server/native-learning/results.ts');
const GL=await import('../../src/lib/server/google-login.ts');
const {visualDeckFixture}=await import('../visual-deck-fixture.mjs');
const family=E.createAccount({name:'F',credential:'f'});
const student=E.createStudent({code:'rv-1',name:'S',accountId:family.id,credential:'f1'});
let day=0;
async function approved(forStudent=student,materialId){
 day++;const d=String(day).padStart(2,'0'),bookingId=E.reserveBooking({studentId:forStudent.id,start:`2028-10-${d}T10:00:00.000Z`,end:`2028-10-${d}T11:30:00.000Z`,durationMin:90});
 J.enqueueNativeLesson({bookingId,studentId:forStudent.id});
 const text=G.gamesFileText(G.exportGamesFile(visualDeckFixture(),`booking-${bookingId}`));
 await G.approveNativeLesson({bookingId,sheetRevision:'r',materialId:materialId??`m-${bookingId}`,releaseId:'rel',fileId:'fileAAAAAAAAAA',drive:{read:async()=>({revisionId:'v',text})}});
 return {bookingId,version:createHash('sha256').update(text).digest('hex')};
}
const act=(id,b,body)=>SG.studentGameAction({studentId:id,bookingId:b.bookingId},{version:b.version,eventId:crypto.randomUUID(),...body});
const rows=(id,b,round)=>RES.nativeResultsForStudent(id).filter(x=>x.bookingId===b.bookingId&&x.roundId===round);

// ---- finding 1: self-learners ----
test('a self-learner account session resolves its single student; parents and multi-student accounts stay refused',async()=>{
 const me=E.createAccount({name:'Adult',credential:'a',isSelf:true,email:'adult@example.test'});
 const mine=E.createStudent({code:'rv-self',name:'Adult',accountId:me.id,credential:'a1'});
 assert.deepEqual(SS.sessionStudent({kind:'account',id:me.id}),{id:mine.id,code:'rv-self',name:'Adult'});
 assert.equal(SS.sessionStudent({kind:'account',id:family.id}),null,'a parent account is never a student');
 assert.equal(SS.sessionStudent({kind:'student',id:student.id})?.id,student.id);
 const two=E.createAccount({name:'Odd',credential:'o',isSelf:true});
 E.createStudent({code:'rv-o1',name:'A',accountId:two.id,credential:'o1'});E.createStudent({code:'rv-o2',name:'B',accountId:two.id,credential:'o2'});
 assert.equal(SS.sessionStudent({kind:'account',id:two.id}),null,'ambiguous self account is not guessed');
 const b=await approved(mine);
 assert.equal(SG.studentGameAction({studentId:SS.sessionStudent({kind:'account',id:me.id}).id,bookingId:b.bookingId},{version:b.version,eventId:'e1',taskId:'axis-1',action:'attempt',input:'38'}).correct,true);
});
test('a self-learner whose Google identity is account-scoped still has a share email; a parent identity never does',()=>{
 const me=E.createAccount({name:'Adult2',credential:'a2',isSelf:true});
 const mine=E.createStudent({code:'rv-self2',name:'Adult2',accountId:me.id,credential:'a2s'});
 assert.equal(GL.studentGoogleEmail(mine.id),null);
 handle().prepare(`INSERT INTO google_identities (subject,scope_kind,scope_id,email,created_at) VALUES ('sub-self','account',?,?,'2028-01-01')`).run(me.id,'adult2@example.test');
 assert.equal(GL.studentGoogleEmail(mine.id),'adult2@example.test');
 handle().prepare(`INSERT INTO google_identities (subject,scope_kind,scope_id,email,created_at) VALUES ('sub-parent','account',?,?,'2028-01-01')`).run(family.id,'parent@example.test');
 assert.equal(GL.studentGoogleEmail(student.id),null,'a parent account email is not the child email');
});

// ---- finding 4: help is persisted, evidence rule ----
test('a revealed solution survives a restart: the later correct answer is assisted, never independent',async()=>{
 const b=await approved();
 act(student.id,b,{taskId:'axis-1',action:'attempt',input:'1'});
 act(student.id,b,{taskId:'axis-1',action:'solution'});
 SG.resetStudentGameSessions();
 const r=act(student.id,b,{taskId:'axis-1',action:'attempt',input:'38'});assert.equal(r.correct,true);assert.equal(r.independent,false);
 assert.deepEqual(rows(student.id,b,'axis-1').map(x=>x.outcome),['incorrect','assisted']);
});
test('a hint persists across restart and attempt counts come from the stored rows',async()=>{
 const b=await approved();
 act(student.id,b,{taskId:'axis-2',action:'attempt',input:'1'});act(student.id,b,{taskId:'axis-2',action:'hint'});
 SG.resetStudentGameSessions();
 act(student.id,b,{taskId:'axis-2',action:'attempt',input:'2'});
 SG.resetStudentGameSessions();
 const r=act(student.id,b,{taskId:'axis-2',action:'attempt',input:'38'});assert.equal(r.attempts,3);
 assert.equal(rows(student.id,b,'axis-2').at(-1).outcome,'assisted');
 SG.resetStudentGameSessions();
 assert.throws(()=>act(student.id,b,{taskId:'axis-3',action:'hint'}),e=>e.status===409,'help still needs a first attempt after a restart');
});
test('a first correct attempt without help stays demonstrated; later retries record nothing and never downgrade',async()=>{
 const b=await approved();
 assert.equal(act(student.id,b,{taskId:'axis-1',action:'attempt',input:'38'}).independent,true);
 act(student.id,b,{taskId:'axis-1',action:'attempt',input:'7'});act(student.id,b,{taskId:'axis-1',action:'hint'});act(student.id,b,{taskId:'axis-1',action:'attempt',input:'38'});
 const r=rows(student.id,b,'axis-1');assert.deepEqual(r.map(x=>[x.outcome,x.attempts]),[['correct',1]]);
 const decisive=RES.decisiveResults(RES.nativeResultsForStudent(student.id).filter(x=>x.bookingId===b.bookingId));
 assert.deepEqual(decisive.map(x=>x.outcome),['correct']);
});
test('later wrong retries do not override an earlier correct in parent evidence',()=>{
 const rowsIn=[{id:1,bookingId:1,gameId:'g',roundId:'r',outcome:'incorrect',at:'1'},{id:2,bookingId:1,gameId:'g',roundId:'r',outcome:'assisted',at:'2'},{id:3,bookingId:1,gameId:'g',roundId:'r',outcome:'incorrect',at:'3'}];
 assert.deepEqual(RES.decisiveResults(rowsIn).map(x=>x.id),[2]);
 assert.deepEqual(RES.decisiveResults(rowsIn.filter(x=>x.outcome==='incorrect')).map(x=>x.id),[3]);
});

// ---- finding 3: cap and one Progress row per round ----
test('attempts per round are capped server-side and a decided round stops recording',async()=>{
 const b=await approved();
 for(let i=0;i<RES.ATTEMPT_CAP;i++)act(student.id,b,{taskId:'axis-3',action:'attempt',input:String(i)});
 assert.equal(rows(student.id,b,'axis-3').length,RES.ATTEMPT_CAP);
 assert.throws(()=>act(student.id,b,{taskId:'axis-3',action:'attempt',input:'38'}),e=>e.status===409);
 assert.equal(rows(student.id,b,'axis-3').length,RES.ATTEMPT_CAP);
});
test('Progress receives one row per student, booking and round, settled by its decisive result; failures surface',async()=>{
 const S=await import('../../src/lib/server/plans/store.ts');
 const acct=E.createAccount({name:'P',credential:'p'}),st=E.createStudent({code:'rv-p',name:'P',accountId:acct.id,credential:'p1'});
 E.upsertEnrollment({studentId:st.id,subject:'מתמטיקה',level:'כיתה יא',teacherId:null});
 const en=E.enrollmentsForStudent(st.id)[0];
 S.createPlan({studentId:st.id,enrollmentId:en.id,goal:'ב',template:{id:'t',version:1,subject:'מתמטיקה',track:'3',reviewed:null,topics:[{key:'tp',title:'נושא',branches:[{key:'tp.b',title:'ענף',skills:[{key:'area',title:'קוראים שטח כהסתברות',requires:[]}]}]}]}});
 const b=await approved(st);
 for(let i=0;i<3;i++)act(st.id,b,{taskId:'axis-1',action:'attempt',input:'1'});
 act(st.id,b,{taskId:'axis-1',action:'attempt',input:'38'});
 act(st.id,b,{taskId:'axis-2',action:'attempt',input:'1'});
 act(st.id,b,{taskId:'axis-3',action:'attempt',input:'38'});
 const store=[],sheet={progressIds:async()=>new Set(store.map(r=>r.evidence_id)),appendProgress:async r=>{store.push(...r);}};
 const context=()=>({studentRef:`student-${st.id}`,lessonId:`booking-${b.bookingId}`,assignmentId:'a'});
 const out=await RES.appendNativeResultsToProgress({sheet,studentId:st.id,context});
 assert.equal(out.appended,2,'axis-2 is still being attempted, so it is not appended yet');
 assert.deepEqual(store.map(r=>[r.outcome,r.support]).sort(),[['demonstrated','independent'],['practising','guided']]);
 assert.equal((await RES.appendNativeResultsToProgress({sheet,studentId:st.id,context})).appended,0);
 handle().prepare("UPDATE native_results SET at='2000-01-01T00:00:00.000Z' WHERE round_id='axis-2' AND booking_id=?").run(b.bookingId);
 assert.equal((await RES.appendNativeResultsToProgress({sheet,studentId:st.id,context})).appended,1,'a round given up settles as needs_review');
 assert.equal(store.length,3);
 const failing={progressIds:async()=>new Set(),appendProgress:async()=>{throw new Error('source_limit');}};
 const AG=await import('../../src/lib/server/native-learning/approval-google.ts');
 const result=await AG.syncNativeProgress(failing);
 assert.match(String(result.error),/source_limit/);
});
