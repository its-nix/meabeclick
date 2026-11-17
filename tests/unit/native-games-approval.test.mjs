import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
process.env.DB_PATH=join(mkdtempSync(join(tmpdir(),'native-games-')),'db.sqlite');
const E=await import('../../src/lib/server/entities.ts');
const {handle}=await import('../../src/lib/server/db.ts');
const J=await import('../../src/lib/server/native-learning/jobs.ts');
const G=await import('../../src/lib/server/native-learning/games.ts');
const S=await import('../../src/lib/server/native-learning/approval-sync.ts');
const W=await import('../../src/lib/learning/workspace.ts');
const {visualDeckFixture}=await import('../visual-deck-fixture.mjs');
const account=E.createAccount({name:'Synthetic',credential:'test'});
const student=E.createStudent({code:'games-test',name:'Student',accountId:account.id,credential:'test'});
let day=0;
function lesson(){day++;const d=String(day).padStart(2,'0'),bookingId=E.reserveBooking({studentId:student.id,start:`2028-07-${d}T10:00:00.000Z`,end:`2028-07-${d}T11:30:00.000Z`,durationMin:90});J.enqueueNativeLesson({bookingId,studentId:student.id});return bookingId;}
const sha=t=>createHash('sha256').update(t).digest('hex');
const fileFor=(bookingId,mutate)=>{const f=G.exportGamesFile(visualDeckFixture(),`booking-${bookingId}`);mutate?.(f);return G.gamesFileText(f);};
const drive=(files)=>({read:async id=>{if(!files[id])throw new Error('missing');return files[id];}});
const FID='fileAAAAAAAAAA';

test('export carries the games, objectives and lesson reference and validates on approval',async()=>{
 const b=lesson(),text=fileFor(b),f=JSON.parse(text);
 assert.equal(f.version,1);assert.equal(f.lessonRef,`booking-${b}`);assert.equal(f.games.length,2);assert.ok(f.objectives.length);
 const out=await G.approveNativeLesson({bookingId:b,sheetRevision:'r1',materialId:'m1',releaseId:'rel1',fileId:FID,drive:drive({[FID]:{revisionId:'rev9',text}})});
 assert.equal(out.length,2);assert.equal(out[0].sourceRevision,'rev9');assert.equal(out[0].contentSha256,sha(text));
 const job=handle().prepare('SELECT approved_release_id,approved_sheet_revision,approved_at FROM native_lesson_jobs WHERE booking_id=?').get(b);
 assert.equal(job.approved_release_id,'rel1');assert.equal(job.approved_sheet_revision,'r1');assert.ok(job.approved_at);
});
test('student copy never contains answers, solutions or hints',async()=>{
 const b=lesson();await G.approveNativeLesson({bookingId:b,sheetRevision:'r',materialId:'m2',releaseId:'rel',fileId:FID,drive:drive({[FID]:{revisionId:'v',text:fileFor(b)}})});
 const games=G.approvedGamesForStudent(student.id,b);assert.equal(games.length,2);
 const json=JSON.stringify(games);for(const r of games.flatMap(g=>g.rounds)){assert.ok(!('solution' in r));assert.ok(!('hints' in r));assert.ok(!('answer' in (r.check??{})));}
 assert.ok(!json.includes('"solution"')&&!json.includes('"answer"'));
 assert.deepEqual(G.approvedGamesForStudent(student.id,b+999),[]);
});
test('invalid, tampered or mismatched files fail closed and keep the earlier approved copy',async()=>{
 const b=lesson(),good=fileFor(b);
 await G.approveNativeLesson({bookingId:b,sheetRevision:'r',materialId:'m3',releaseId:'rel1',fileId:FID,drive:drive({[FID]:{revisionId:'v1',text:good}})});
 const bad=[fileFor(b,f=>{f.games[0].rounds[0].prompt='כתוב e^{4x} כאן';}),fileFor(b,f=>{f.games[0].rounds[0].objectiveId='nope';}),fileFor(b,f=>{f.games[0].kind='memory';}),fileFor(b,f=>{f.lessonRef='booking-1234';}),'{not json','[]'];
 for(const text of bad)await assert.rejects(G.approveNativeLesson({bookingId:b,sheetRevision:'r2',materialId:'m3',releaseId:'rel2',fileId:FID,drive:drive({[FID]:{revisionId:'v2',text}})}),/games_file_invalid/);
 await assert.rejects(G.approveNativeLesson({bookingId:b,sheetRevision:'r2',materialId:'m3',releaseId:'rel2',fileId:FID,expectedSha256:'0'.repeat(64),drive:drive({[FID]:{revisionId:'v2',text:good}})}),/fingerprint/);
 await assert.rejects(G.approveNativeLesson({bookingId:999999,sheetRevision:'r',materialId:'mx',releaseId:'r',fileId:FID,drive:drive({[FID]:{revisionId:'v',text:good}})}),/no_lesson/);
 assert.equal(G.approvedRelease('m3').releaseId,'rel1');assert.equal(G.approvedGamesForStudent(student.id,b).length,2);
});
test('a new release replaces the old copy; withdrawal removes access but keeps recorded results',async()=>{
 const b=lesson();const d=drive({[FID]:{revisionId:'v',text:fileFor(b)}});
 await G.approveNativeLesson({bookingId:b,sheetRevision:'r',materialId:'m4',releaseId:'rel1',fileId:FID,drive:d});
 await G.approveNativeLesson({bookingId:b,sheetRevision:'r2',materialId:'m4',releaseId:'rel2',fileId:FID,drive:d});
 assert.equal(handle().prepare("SELECT count(*) n FROM native_games WHERE material_id='m4'").get().n,2);
 assert.equal(G.approvedRelease('m4').releaseId,'rel2');
 handle().prepare("INSERT INTO native_results (student_id,booking_id,game_id,round_id,outcome,at) VALUES (?,?,?,?,?,?)").run(student.id,b,'g','r','correct','2028-07-01T00:00:00Z');
 assert.equal(G.withdrawNativeGames('m4'),2);assert.deepEqual(G.approvedGamesForStudent(student.id,b),[]);
 assert.equal(handle().prepare('SELECT count(*) n FROM native_results WHERE booking_id=?').get(b).n,1);
 assert.equal(handle().prepare('SELECT approved_release_id r FROM native_lesson_jobs WHERE booking_id=?').get(b).r,null);
});

// ---- Sheet side ----
function sheetDouble(snapshot,siteColumn=true){
 const grids={};
 for(const [name,columns] of Object.entries(W.workspaceTables)){const cols=name==='Materials'&&siteColumn?[...columns,...W.workspaceSiteColumns.Materials]:columns;grids[name]=[cols.map(c=>W.workspaceHeader(c)),...snapshot[name].map(r=>cols.map(c=>r[c.key]??''))];}
 const sheet={grids,revision:'rev-1',writes:[],read:async()=>({revision:sheet.revision,grids:structuredClone(sheet.grids)}),update:async(cells)=>{for(const c of cells){sheet.writes.push(c);sheet.grids[c.table][c.row][c.column]=c.value;}}};
 return sheet;
}
function snapshotFor(bookingId,{review='approved',pub='published',assignment='assigned',sha256}={}){
 const sid=`student-${student.id}`,hash=sha256??sha(fileFor(bookingId));
 return {version:1,
  Students:[{student_id:sid,display_name:'S',subject:'מתמטיקה',education_level:'תיכון',track:'3',goals:'',profile_url:'',folder_url:'',status:'active',is_demo:false}],
  Lessons:[{lesson_id:`booking-${bookingId}`,student_id:sid,date:'2028-07-01',goals:'g',status:'planned',tutor_note:'',is_demo:false}],
  Materials:[{material_id:'native-1-game-abc',title:'game',kind:'game',provider:'website',url:`https://drive.google.com/file/d/${FID}/view`,review_status:review,publication_status:pub,audience:'student',student_id:sid,topic:'t',education_level:'',release_id:pub==='published'?'rel-A':'',content_sha256:pub==='published'?hash:'',is_demo:false}],
  Assignments:[{assignment_id:'a1',student_id:sid,lesson_id:`booking-${bookingId}`,material_id:'native-1-game-abc',due_date:'',status:assignment,is_demo:false}],Progress:[]};
}
test('readReleaseTicks only returns approved, published, assigned student games',async()=>{
 const b=lesson();
 const ok=await S.readReleaseTicks(sheetDouble(snapshotFor(b)));assert.equal(ok.ticks.length,1);assert.equal(ok.ticks[0].fileId,FID);assert.equal(ok.ticks[0].bookingId,b);assert.equal(ok.revision,'rev-1');
 for(const o of [{assignment:'cancelled'},{assignment:'draft'}])assert.equal((await S.readReleaseTicks(sheetDouble(snapshotFor(b,o)))).ticks.length,0);
 assert.equal((await S.readReleaseTicks(sheetDouble(snapshotFor(b,{review:'review',pub:'draft'})))).ticks.length,0);
 assert.equal((await S.readReleaseTicks(sheetDouble(snapshotFor(b,{review:'review'})))).ticks.length,0,'published but not approved earns no tick');
 const noRelease=snapshotFor(b);noRelease.Materials[0].release_id='';assert.equal((await S.readReleaseTicks(sheetDouble(noRelease))).ticks.length,0);
});
test('writeSiteStatus writes only the site column and refuses a sheet without it',async()=>{
 const b=lesson(),sh=sheetDouble(snapshotFor(b));
 const before=structuredClone(sh.grids);
 assert.equal(await S.writeSiteStatus(sh,[{materialId:'native-1-game-abc',status:'rejected',code:'games_file_invalid: json'}]),1);
 const col=sh.grids.Materials[0].findIndex(h=>h.endsWith('[site_status]'));
 assert.ok(sh.writes.every(w=>w.table==='Materials'&&w.column===col));assert.equal(sh.grids.Materials[1][col],'rejected: games_file_invalid: json');
 for(const t of Object.keys(before))for(const [r,row] of before[t].entries())for(const [c,v] of row.entries())if(!(t==='Materials'&&c===col))assert.equal(sh.grids[t][r][c],v);
 assert.equal(await S.writeSiteStatus(sh,[{materialId:'native-1-game-abc',status:'rejected',code:'games_file_invalid: json'}]),0,'idempotent');
 await assert.rejects(S.writeSiteStatus(sheetDouble(snapshotFor(b),false),[{materialId:'native-1-game-abc',status:'approved'}]),/site_status_unavailable/);
});
test('sync copies on approval, reports rejection, and withdraws on revoke or cancellation',async()=>{
 handle().exec('DELETE FROM native_games');
 const b=lesson(),text=fileFor(b),d=drive({[FID]:{revisionId:'v1',text}});
 let sh=sheetDouble(snapshotFor(b));const col=sh.grids.Materials[0].findIndex(h=>h.endsWith('[site_status]'));
 let r=await S.syncNativeGameApprovals({sheet:sh,drive:d});assert.equal(r.approved,1);assert.equal(sh.grids.Materials[1][col],'approved');
 assert.equal(G.approvedGamesForStudent(student.id,b).length,2);
 r=await S.syncNativeGameApprovals({sheet:sh,drive:d});assert.equal(r.approved,1,'idempotent resync');
 // tutor edits Drive after approval: sha no longer matches the Sheet fingerprint -> rejected, old copy stays
 const edited=fileFor(b,f=>{f.games[0].title='שונה';});
 r=await S.syncNativeGameApprovals({sheet:sh,drive:drive({[FID]:{revisionId:'v2',text:edited}})});
 assert.equal(r.approved,1);// unchanged release+sha: nothing re-read
 sh=sheetDouble(snapshotFor(b,{sha256:sha(edited)}));sh.grids.Materials[1][col]='';
 sh.grids.Materials[1][sh.grids.Materials[0].findIndex(h=>h.endsWith('[release_id]'))]='rel-B';
 r=await S.syncNativeGameApprovals({sheet:sh,drive:drive({[FID]:{revisionId:'v2',text:edited}})});assert.equal(r.approved,1);assert.equal(G.approvedRelease('native-1-game-abc').releaseId,'rel-B');
 const broken=fileFor(b,f=>{f.games[1].rounds=[];});
 sh=sheetDouble(snapshotFor(b,{sha256:sha(broken)}));sh.grids.Materials[1][sh.grids.Materials[0].findIndex(h=>h.endsWith('[release_id]'))]='rel-C';
 r=await S.syncNativeGameApprovals({sheet:sh,drive:drive({[FID]:{revisionId:'v3',text:broken}})});assert.equal(r.rejected,1);assert.match(sh.grids.Materials[1][col],/^rejected: games_file_invalid/);
 assert.equal(G.approvedRelease('native-1-game-abc').releaseId,'rel-B','fail closed keeps the earlier approved copy');
 handle().prepare("INSERT INTO native_results (student_id,booking_id,game_id,round_id,outcome,at) VALUES (?,?,?,?,?,?)").run(student.id,b,'g','r','correct','2028-07-01T00:00:00Z');
 sh=sheetDouble(snapshotFor(b,{pub:'draft'}));
 r=await S.syncNativeGameApprovals({sheet:sh,drive:d});assert.deepEqual(r.withdrawn,['native-1-game-abc']);assert.deepEqual(G.approvedGamesForStudent(student.id,b),[]);
 assert.equal(sh.grids.Materials[1][col],'withdrawn');
 assert.equal(handle().prepare('SELECT count(*) n FROM native_results WHERE booking_id=?').get(b).n,1);
 await S.syncNativeGameApprovals({sheet:sheetDouble(snapshotFor(b),true),drive:d});assert.equal(G.approvedGamesForStudent(student.id,b).length,2);
 r=await S.syncNativeGameApprovals({sheet:sheetDouble(snapshotFor(b,{assignment:'cancelled'})),drive:d});assert.equal(r.withdrawn.length,1);assert.deepEqual(G.approvedGamesForStudent(student.id,b),[]);
});
