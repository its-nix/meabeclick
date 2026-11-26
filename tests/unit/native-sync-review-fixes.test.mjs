import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
process.env.DB_PATH=join(mkdtempSync(join(tmpdir(),'native-sync-review-')),'db.sqlite');
const E=await import('../../src/lib/server/entities.ts');
const {handle}=await import('../../src/lib/server/db.ts');
const J=await import('../../src/lib/server/native-learning/jobs.ts');
const G=await import('../../src/lib/server/native-learning/games.ts');
const S=await import('../../src/lib/server/native-learning/approval-sync.ts');
const SG=await import('../../src/lib/server/native-learning/student-games.ts');
const H=await import('../../src/lib/server/native-learning/homework-share.ts');
const W=await import('../../src/lib/learning/workspace.ts');
const {visualDeckFixture}=await import('../visual-deck-fixture.mjs');
const account=E.createAccount({name:'S',credential:'s'});
const student=E.createStudent({code:'sy-1',name:'S',accountId:account.id,credential:'s1'});
const other=E.createStudent({code:'sy-2',name:'O',accountId:account.id,credential:'s2'});
const sha=t=>createHash('sha256').update(t).digest('hex');
let day=0;
function lesson(forStudent=student){day++;const d=String(day).padStart(2,'0'),bookingId=E.reserveBooking({studentId:forStudent.id,start:`2028-11-${d}T10:00:00.000Z`,end:`2028-11-${d}T11:30:00.000Z`,durationMin:90});J.enqueueNativeLesson({bookingId,studentId:forStudent.id});return bookingId;}
const fileFor=(bookingId,mutate)=>{const f=G.exportGamesFile(visualDeckFixture(),`booking-${bookingId}`);mutate?.(f);return G.gamesFileText(f);};
const drive=files=>({read:async id=>{if(!files[id])throw new Error('missing');return files[id];}});
const FID='fileAAAAAAAAAA',FID2='fileBBBBBBBBBB';
function gridsFor(rows){
 const grids={};
 for(const [name,columns] of Object.entries(W.workspaceTables)){const cols=name==='Materials'?[...columns,...W.workspaceSiteColumns.Materials]:columns;grids[name]=[cols.map(c=>W.workspaceHeader(c)),...(rows[name]??[]).map(r=>cols.map(c=>r[c.key]??''))];}
 return grids;
}
const mat=(id,bookingId,fid,text,sid=student.id,extra={})=>({material_id:id,title:id,kind:'game',provider:'website',url:`https://drive.google.com/file/d/${fid}/view`,review_status:'approved',publication_status:'published',audience:'student',student_id:`student-${sid}`,topic:'t',education_level:'',release_id:'rel-'+id,content_sha256:sha(text),is_demo:false,...extra});
const asg=(id,bookingId,sid=student.id)=>({assignment_id:'a-'+id,student_id:`student-${sid}`,lesson_id:`booking-${bookingId}`,material_id:id,due_date:'',status:'assigned',is_demo:false});
const sheetOf=grids=>({grids,revision:'r1',writes:[],read:async()=>({revision:'r1',grids:structuredClone(grids)}),update:async cells=>{for(const c of cells)grids[c.table][c.row][c.column]=c.value;}});

test('a bad row, an extra column or a broken unrelated tab no longer blocks withdrawal of a revoked game',async()=>{
 const b=lesson(),text=fileFor(b);
 const rows={Materials:[mat('mg-1',b,FID,text)],Assignments:[asg('mg-1',b)]};
 let r=await S.syncNativeGameApprovals({sheet:sheetOf(gridsFor(rows)),drive:drive({[FID]:{revisionId:'v',text}})});
 assert.equal(r.approved,1);assert.equal(G.approvedGamesForStudent(student.id,b).length,2);
 // tutor revokes the game, blanks is_demo on another row, adds a column, and mangles Lessons
 const text2=fileFor(b),rows2={Materials:[mat('mg-1',b,FID,text,student.id,{publication_status:'draft',release_id:'',content_sha256:''}),mat('mg-2',b,FID,text2)],Assignments:[asg('mg-1',b),asg('mg-2',b)]};
 const grids=gridsFor(rows2);
 const demoCol=grids.Materials[0].findIndex(h=>h.endsWith('[is_demo]'));grids.Materials[2][demoCol]='';
 grids.Materials[0].push('הערת מורה');grids.Materials.slice(1).forEach(row=>row.push('x'));
 grids.Lessons=[['not a header']];
 r=await S.syncNativeGameApprovals({sheet:sheetOf(grids),drive:drive({[FID]:{revisionId:'v',text}})});
 assert.deepEqual(r.withdrawn,['mg-1']);assert.deepEqual(G.approvedGamesForStudent(student.id,b),[]);
 assert.ok(r.problems.length>=1,'the unreadable row is reported, not swallowed');
});
test('a Materials tab that cannot be read at all is surfaced as an error status instead of throwing',async()=>{
 const b=lesson(),text=fileFor(b),rows={Materials:[mat('mg-3',b,FID,text)],Assignments:[asg('mg-3',b)]};
 await S.syncNativeGameApprovals({sheet:sheetOf(gridsFor(rows)),drive:drive({[FID]:{revisionId:'v',text}})});
 const grids=gridsFor(rows);grids.Materials=[['x']];
 const r=await S.syncNativeGameApprovals({sheet:sheetOf(grids),drive:drive({})});
 assert.match(String(r.error),/Materials/);assert.equal(G.approvedGamesForStudent(student.id,b).length,2,'nothing is withdrawn on a header we cannot trust');
});

test('approval refuses a Sheet material whose student is not the job student',async()=>{
 const b=lesson(),text=fileFor(b);
 const r=await S.syncNativeGameApprovals({sheet:sheetOf(gridsFor({Materials:[mat('mg-x',b,FID,text,other.id)],Assignments:[asg('mg-x',b,other.id)]})),drive:drive({[FID]:{revisionId:'v',text}})});
 assert.equal(r.approved,0);assert.equal(r.rejected,1);assert.deepEqual(G.approvedGamesForStudent(student.id,b),[]);assert.deepEqual(G.approvedGamesForStudent(other.id,b),[]);
});
test('two approved materials on one booking: each game plays at its own version, and withdrawing one keeps the other',async()=>{
 const b=lesson(),t1=fileFor(b,f=>{f.games=[f.games[0]];}),t2=fileFor(b,f=>{f.games=[f.games[1]];});
 const files={[FID]:{revisionId:'v',text:t1},[FID2]:{revisionId:'v',text:t2}};
 const rows={Materials:[mat('mg-a',b,FID,t1),mat('mg-b',b,FID2,t2)],Assignments:[asg('mg-a',b),asg('mg-b',b)]};
 let r=await S.syncNativeGameApprovals({sheet:sheetOf(gridsFor(rows)),drive:drive(files)});assert.equal(r.approved,2);
 const act=(task,version)=>SG.studentGameAction({studentId:student.id,bookingId:b},{version,eventId:crypto.randomUUID(),taskId:task,action:'attempt',input:task.startsWith('region')?[-.5,.5]:'38'});
 assert.equal(act('region-1',sha(t1)).correct,true);
 assert.equal(act('axis-1',sha(t2)).correct,true,'a game from the second material is not a 409');
 assert.throws(()=>act('axis-1',sha(t1)),e=>e.status===409);
 const rows2={Materials:[mat('mg-a',b,FID,t1)],Assignments:[asg('mg-a',b)]};
 r=await S.syncNativeGameApprovals({sheet:sheetOf(gridsFor(rows2)),drive:drive(files)});assert.deepEqual(r.withdrawn,['mg-b']);
 assert.equal(G.approvedGamesForStudent(student.id,b).length,1);
 assert.equal(handle().prepare('SELECT approved_release_id FROM native_lesson_jobs WHERE booking_id=?').get(b).approved_release_id,'rel-mg-a','the booking stays approved while a material remains');
 r=await S.syncNativeGameApprovals({sheet:sheetOf(gridsFor({Materials:[],Assignments:[]})),drive:drive(files)});
 assert.equal(handle().prepare('SELECT approved_release_id FROM native_lesson_jobs WHERE booking_id=?').get(b).approved_release_id,null);
});

// ---- homework shares ----
function hwRows(bookingId,docId){
 const job=J.getNativeLessonJob(bookingId),id=`native-${job.id}-homework`,hash='b'.repeat(64);
 handle().prepare("UPDATE bookings_v2 SET status='confirmed' WHERE id=?").run(bookingId);
 handle().prepare("UPDATE native_lesson_jobs SET state='review',bundle=? WHERE id=?")
  .run(JSON.stringify({homework:{id:docId},sourceHash:hash,reviewFolderId:'reviewFolderAA'}),job.id);
 return {Materials:[{material_id:id,title:'h',kind:'homework',provider:'google_docs',url:`https://docs.google.com/document/d/${docId}/edit`,review_status:'approved',publication_status:'published',audience:'student',student_id:`student-${job.studentId}`,topic:'t',education_level:'',release_id:'rel',content_sha256:hash,is_demo:false}],
  Assignments:[{...asg(id,bookingId,job.studentId),assignment_id:`${id}-assignment`}],id};
}
function homeworkApi(calls,failRevoke=()=>false){
 const grants=new Set();
 return {
  async place(){return 'studentFolderAA';},
  async restrictSharing(){},
  async verifyDelivery(){return null;},
  async ensure(doc,_folder,email,_role,_managed,checkCurrent,beforeWrite){
   if(grants.has(email))return {created:false,permissionId:email};
   await checkCurrent();beforeWrite();calls.push(['share',email,doc]);grants.add(email);return {created:true,permissionId:email};
  },
  async revoke(doc,email){
   calls.push(['revoke',email,doc]);if(failRevoke())throw Error('quota');return grants.delete(email);
  },
 };
}
test('the prior named grant is retried and revoked before granting the new email',async()=>{
 const b=lesson(),doc='homeworkDocAAAA',rows=hwRows(b,doc),calls=[];
 let fail=true;
 const api=homeworkApi(calls,()=>fail);
 const sheet=sheetOf(gridsFor(rows));
 await H.syncHomeworkShares({sheet,api,emailFor:()=>'old@example.test'});
 let r=await H.syncHomeworkShares({sheet,api,emailFor:()=>'new@example.test'});
 assert.equal(r.failed,1);assert.equal(r.shared,0);
 fail=false;calls.length=0;
 r=await H.syncHomeworkShares({sheet,api,emailFor:()=>'new@example.test'});
 assert.deepEqual(calls,[['revoke','old@example.test',doc],['share','new@example.test',doc]]);
 assert.equal(r.revoked,1);
 const n=calls.length;await H.syncHomeworkShares({sheet,api,emailFor:()=>'new@example.test'});assert.equal(calls.length,n,'and only once');
});
test('homework revocation still runs when other rows are unreadable, and a read failure is surfaced',async()=>{
 const b=lesson(),doc='homeworkDocFFFF',rows=hwRows(b,doc),calls=[];
 const api=homeworkApi(calls);
 await H.syncHomeworkShares({sheet:sheetOf(gridsFor(rows)),api,emailFor:()=>'kid@example.test'});
 const grids=gridsFor({...rows,Materials:[{...rows.Materials[0],publication_status:'draft'}]});
 grids.Lessons=[['junk']];grids.Materials.push(grids.Materials[1].map((v,i)=>i===0?'broken-row':''));
 const r=await H.syncHomeworkShares({sheet:sheetOf(grids),api,emailFor:()=>'kid@example.test'});
 assert.equal(r.revoked,1);assert.deepEqual(calls.at(-1),['revoke','kid@example.test',doc]);
 const bad=gridsFor(rows);bad.Materials=[['x']];
 const r2=await H.syncHomeworkShares({sheet:sheetOf(bad),api,emailFor:()=>'kid@example.test'});assert.match(String(r2.error),/Materials/);
});
