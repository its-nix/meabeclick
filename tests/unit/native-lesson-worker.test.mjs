import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
process.env.DB_PATH=join(mkdtempSync(join(tmpdir(),'native-worker-')),'db.sqlite');
const E=await import('../../src/lib/server/entities.ts');
const {handle}=await import('../../src/lib/server/db.ts');
const J=await import('../../src/lib/server/native-learning/jobs.ts');
const C=await import('../../src/lib/server/native-learning/context.ts');
const {nativeLessonWorker}=await import('../../src/lib/server/native-learning/worker.ts');
const {nativeDraftRecords,appendNativeDraftRecords}=await import('../../src/lib/server/native-learning/register.ts');
let serial=0;
function booking({bind=true,student=null}={}){
 serial++;
 if(!student){const account=E.createAccount({name:'Synthetic',credential:`worker-${serial}`});student=E.createStudent({code:`worker-${serial}`,name:'Same name',accountId:account.id,credential:`worker-${serial}`});}
 const enrollment=E.upsertEnrollment({studentId:student.id,subject:'מתמטיקה',level:'כיתה יא · 3 יחידות',teacherId:null});
 const bookingId=E.reserveBooking({studentId:student.id,enrollmentId:enrollment.id,start:`2028-07-${String(serial).padStart(2,'0')}T10:00:00.000Z`,end:`2028-07-${String(serial).padStart(2,'0')}T11:30:00.000Z`,durationMin:90});
 J.enqueueNativeLesson({bookingId,studentId:student.id});
 if(bind)C.bindNativeReviewContext({bookingId,studentId:student.id,context:C.NORMAL_REVIEW_CONTEXT});
 return{bookingId,student};
}
const receipt={version:1,state:'draft',sourceHash:'a'.repeat(64),reviewFolderId:'review-folder-id',slides:{id:'slides-native-id',url:'https://docs.google.com/presentation/d/slides-native-id/edit',mimeType:'application/vnd.google-apps.presentation'},tutorNotes:{id:'notes-native-id',url:'https://docs.google.com/document/d/notes-native-id/edit',mimeType:'application/vnd.google-apps.document'},homework:{id:'homework-native-id',url:'https://docs.google.com/document/d/homework-native-id/edit',mimeType:'application/vnd.google-apps.document'},activities:[{id:'game-1',title:'משחק',url:'https://example.test/app/native-review-activities?view=game&game=game-1'}]};
function controller(overrides={}){return nativeLessonWorker({enabled:()=>true,workspace:()=>({archiveId:'synthetic-archive',indexId:'native-index-id'}),access:()=>({assertCurrent(){},epoch:'synthetic',config:{},credentials:{}}),source:()=>({bundle:{},version:'b'.repeat(64)}),publish:async()=>receipt,register:async()=>{},activityBaseUrl:()=> 'https://example.test/app/native-review-activities',...overrides});}
test('unbound and opt-out jobs stay honest and make no Google writes',async()=>{
 const unbound=booking({bind:false}),disabled=booking();let calls=0;
 const worker=controller({enabled:()=>false,publish:async()=>{calls++;return receipt;}});worker.queue();await worker.settled();
 assert.equal(J.getNativeLessonJob(unbound.bookingId).reason,'unsupported_context');
 assert.equal(J.getNativeLessonJob(disabled.bookingId).reason,'authoring_disabled');assert.equal(calls,0);
});
test('serial worker binds one review receipt, keeps provenance and prevents repeated lesson source',async()=>{
 const first=booking();let calls=0,registers=0;
 const worker=controller({publish:async()=>{calls++;return receipt;},register:async()=>{registers++;}});
 worker.queue();worker.queue();await worker.settled();
 const complete=J.getNativeLessonJob(first.bookingId);assert.equal(complete.state,'review');assert.equal(complete.bundle.studentDelivery,'blocked-owner-review-required');assert.deepEqual(complete.bundle.provenance.sourceIds,['moe-2025a-35372-3']);
 worker.queue();await worker.settled();assert.equal(calls,1);assert.equal(registers,1);
 const next=booking({student:first.student});worker.queue();await worker.settled();assert.equal(J.getNativeLessonJob(next.bookingId).reason,'repeated_source');assert.equal(calls,1);
});
test('cancellation during awaited export suppresses records and review binding',async()=>{
 const {bookingId}=booking();let records=0;
 const worker=controller({publish:async(_,dependencies)=>{E.cancelBooking(bookingId);assert.throws(()=>dependencies.access.assertCurrent(),/paused/);return receipt;},register:async()=>{records++;}});
 worker.queue();await worker.settled();assert.equal(J.getNativeLessonJob(bookingId).state,'cancelled');assert.equal(records,0);
});
test('failed registration can be resumed by a new worker without duplicate final binding',async()=>{
 const {bookingId}=booking();const keys=[];let attempts=0;
 const first=controller({publish:async input=>{keys.push(input.key);return receipt;},register:async()=>{attempts++;throw Error('quota');}});
 first.queue();await first.settled();assert.equal(J.getNativeLessonJob(bookingId).state,'failed');
 handle().prepare("UPDATE native_lesson_jobs SET retry_at='2000-01-01T00:00:00.000Z' WHERE booking_id=?").run(bookingId);
 const restarted=controller({publish:async input=>{keys.push(input.key);return receipt;},register:async()=>{attempts++;}});restarted.queue();await restarted.settled();
 assert.equal(J.getNativeLessonJob(bookingId).state,'review');assert.equal(attempts,2);assert.equal(keys[0],keys[1]);
});
test('context rejects other sources, ownership, and changes while preparing',()=>{
 const {bookingId,student}=booking({bind:false});
 assert.throws(()=>C.bindNativeReviewContext({bookingId,studentId:student.id+999,context:C.NORMAL_REVIEW_CONTEXT}),/ownership/);
 assert.throws(()=>C.bindNativeReviewContext({bookingId,studentId:student.id,context:{...C.NORMAL_REVIEW_CONTEXT,sourceId:'guessed'}}),/unsupported_context/);
 J.claimNativeLessonJob({bookingId});assert.throws(()=>C.bindNativeReviewContext({bookingId,studentId:student.id,context:C.NORMAL_REVIEW_CONTEXT}),/state/);
 E.cancelBooking(bookingId);
});
test('known conflicting four/five-unit booking levels cannot be overwritten by tutor calibration',()=>{
 const snapshot={durationMin:90,subject:'מתמטיקה',context:C.NORMAL_REVIEW_CONTEXT};
 for(const level of ['בגרות 5 יחידות','כיתה יא · 5 יח״ל','תיכון 4 יחידות'])assert.equal(C.supportedNativeContext({...snapshot,level}),false,level);
 for(const level of ['3 יח״ל','3 יחידות','כיתה יא · 3 יח״ל'])assert.equal(C.supportedNativeContext({...snapshot,level}),true,level);
});
test('an expired and reclaimed lease prevents an old exporter from binding or writing records',async()=>{
 const {bookingId}=booking();let records=0;
 const worker=controller({publish:async(_,dependencies)=>{
  handle().prepare("UPDATE native_lesson_jobs SET lease_until='2000-01-01T00:00:00.000Z' WHERE booking_id=?").run(bookingId);
  assert.equal(J.claimNativeLessonJob({bookingId}).attempts,2);
  assert.throws(()=>dependencies.access.assertCurrent(),/paused/);return receipt;
 },register:async()=>{records++;}});
 worker.queue();await worker.settled();assert.equal(records,0);assert.equal(J.getNativeLessonJob(bookingId).attempts,2);assert.equal(J.getNativeLessonJob(bookingId).state,'preparing');E.cancelBooking(bookingId);
});
test('linked draft records append once after lost response and preserve human edits',async()=>{
 const {bookingId}=booking();const job=J.getNativeLessonJob(bookingId),records=nativeDraftRecords(job,receipt,'Synthetic');
 assert.equal(records.Progress.length,0);assert.equal(records.Assignments[0].status,'draft');assert.ok(records.Materials.every(m=>m.publication_status==='draft'));
 const sheets=[];let lost=true;
 const api={scope:'synthetic-scope',async json(url,init){
  if(url.includes(':batchUpdate')){for(const request of JSON.parse(init.body).requests){
   if(request.addSheet)sheets.push({properties:request.addSheet.properties,developerMetadata:[],rows:[]});
   if(request.createDeveloperMetadata){const d=request.createDeveloperMetadata.developerMetadata;sheets.find(s=>s.properties.sheetId===d.location.sheetId).developerMetadata.push(d);}
   if(request.appendCells){const u=request.appendCells,s=sheets.find(s=>s.properties.sheetId===u.sheetId);u.rows.forEach(r=>{s.rows.push(r.values.map(c=>c.userEnteredValue.stringValue??c.userEnteredValue.boolValue));});}
  }if(lost){lost=false;throw Error('lost response');}return{};}
  if(url.includes('/values/')){const title=decodeURIComponent(url.split('/values/')[1].split('?')[0]).match(/^'([^']+)'/)[1];return{values:sheets.find(s=>s.properties.title===title).rows};}
  return{sheets};
 }};
 await assert.rejects(appendNativeDraftRecords(api,'native-index-id',records),/lost response/);
 sheets.find(s=>s.properties.title==='Native Students').rows[1][1]='Human corrected name';
 await appendNativeDraftRecords(api,'native-index-id',records);
 assert.equal(sheets.find(s=>s.properties.title==='Native Students').rows[1][1],'Human corrected name');
 assert.equal(sheets.find(s=>s.properties.title==='Native Lessons').rows.length,2);
 assert.equal(sheets.find(s=>s.properties.title==='Native Materials').rows.length,5);
 sheets.find(s=>s.properties.title==='Native Materials').rows[1][4]='https://docs.google.com/presentation/d/changed-human-id/edit';
 await assert.rejects(appendNativeDraftRecords(api,'native-index-id',records),/conflict/);
});

test('embedded-note decks are staff material, with no phantom notes Doc or student assignment',()=>{
 const {bookingId}=booking();const combined={...receipt,notesLocation:'slides'};delete combined.tutorNotes;
 const records=nativeDraftRecords(J.getNativeLessonJob(bookingId),combined,'Synthetic');
 const deck=records.Materials.find(m=>m.kind==='presentation');assert.equal(deck.audience,'staff');
 assert.equal(records.Materials.filter(m=>m.kind==='lesson_brief').length,0);
 assert.ok(records.Assignments.every(a=>a.material_id!==deck.material_id));
 const historical=nativeDraftRecords(J.getNativeLessonJob(bookingId),receipt,'Synthetic');assert.ok(historical.Materials.some(m=>m.url===receipt.tutorNotes.url),'existing separate-note receipts remain readable');
});
