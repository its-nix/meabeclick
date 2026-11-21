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
const {nativeDraftRecords,appendNativeDraftRecords,validateNativeDraftFiles}=await import('../../src/lib/server/native-learning/register.ts');
let serial=0;
const PREPARATION={request:'להבין שטחים בלי לשנן',priorKnowledge:'מבין ממוצע, מתקשה באחוזים'};
function booking({bind=true,student=null,subject='מתמטיקה',level='כיתה יא · 3 יחידות',durationMin=90}={}){
 serial++;
 if(!student){const account=E.createAccount({name:'Synthetic',credential:`worker-${serial}`});student=E.createStudent({code:`worker-${serial}`,name:'Same name',accountId:account.id,credential:`worker-${serial}`});}
 const enrollment=E.upsertEnrollment({studentId:student.id,subject,level,teacherId:null});
 const bookingId=E.reserveBooking({studentId:student.id,enrollmentId:enrollment.id,start:`2028-07-${String(serial).padStart(2,'0')}T10:00:00.000Z`,end:new Date(Date.parse(`2028-07-${String(serial).padStart(2,'0')}T10:00:00.000Z`)+durationMin*60000).toISOString(),durationMin});
 J.enqueueNativeLesson({bookingId,studentId:student.id});
 if(bind)C.bindNativePreparation({bookingId,studentId:student.id,...PREPARATION});
 return{bookingId,student};
}
const receipt={version:1,state:'draft',sourceHash:'a'.repeat(64),reviewFolderId:'review-folder-id',slides:{id:'slides-native-id',url:'https://docs.google.com/presentation/d/slides-native-id/edit',mimeType:'application/vnd.google-apps.presentation'},tutorNotes:{id:'notes-native-id',url:'https://docs.google.com/document/d/notes-native-id/edit',mimeType:'application/vnd.google-apps.document'},homework:{id:'homework-native-id',url:'https://docs.google.com/document/d/homework-native-id/edit',mimeType:'application/vnd.google-apps.document'},activities:[{id:'game-1',title:'משחק',url:'https://example.test/app/native-review-activities?view=game&game=game-1'}]};
function controller(overrides={}){return nativeLessonWorker({enabled:()=>true,workspace:()=>({archiveId:'synthetic-archive',indexId:'native-index-id'}),access:()=>({assertCurrent(){},epoch:'synthetic',config:{},credentials:{}}),generate:async()=>({bundle:{},version:'b'.repeat(64),sources:[]}),publish:async()=>receipt,register:async()=>{},activityBaseUrl:()=> 'https://example.test/app/native-review-activities',...overrides});}
test('unbound and opt-out jobs stay honest and make no Google writes',async()=>{
 const unbound=booking({bind:false}),disabled=booking();let calls=0;
 const worker=controller({enabled:()=>false,publish:async()=>{calls++;return receipt;}});worker.queue();await worker.settled();
 assert.equal(J.getNativeLessonJob(unbound.bookingId).reason,'missing_brief');
 assert.equal(J.getNativeLessonJob(disabled.bookingId).reason,'authoring_disabled');assert.equal(calls,0);
});
test('serial worker binds one review receipt, keeps provenance and prepares every later lesson independently',async()=>{
 const first=booking();let calls=0,registers=0;
 const worker=controller({publish:async()=>{calls++;return receipt;},register:async()=>{registers++;}});
 worker.queue();worker.queue();await worker.settled();
 const complete=J.getNativeLessonJob(first.bookingId);assert.equal(complete.state,'review');assert.equal(complete.bundle.studentDelivery,'blocked-owner-review-required');assert.deepEqual(complete.bundle.provenance.sourceIds,[]);assert.deepEqual(complete.bundle.provenance.context,{subject:'מתמטיקה',level:'כיתה יא · 3 יחידות',durationMin:90,readiness:'tutor-reported'});
 worker.queue();await worker.settled();assert.equal(calls,1);assert.equal(registers,1);
 const next=booking({student:first.student});worker.queue();await worker.settled();assert.equal(J.getNativeLessonJob(next.bookingId).state,'review');assert.equal(calls,2);
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
 const restarted=controller({publish:async input=>{keys.push(input.key);return {...receipt,sourceHash:'renderer-upgraded',slides:{...receipt.slides,id:'wrong-new-id'}};},register:async(_a,_w,_j,saved)=>{assert.equal(saved.slides.id,receipt.slides.id);assert.equal(saved.sourceHash,receipt.sourceHash);attempts++;}});restarted.queue();await restarted.settled();
 assert.equal(J.getNativeLessonJob(bookingId).state,'review');assert.equal(attempts,2);assert.equal(keys.length,1);assert.equal(J.getNativeLessonJob(bookingId).bundle.slides.id,receipt.slides.id);
});
test('preparation rejects other students, empty fields and changes while preparing',()=>{
 const {bookingId,student}=booking({bind:false});
 assert.throws(()=>C.bindNativePreparation({bookingId,studentId:student.id+999,...PREPARATION}),/ownership/);
 assert.throws(()=>C.bindNativePreparation({bookingId,studentId:student.id,request:' ',priorKnowledge:'x'}),/preparation_fields/);
 J.claimNativeLessonJob({bookingId});assert.throws(()=>C.bindNativePreparation({bookingId,studentId:student.id,...PREPARATION}),/state/);
 E.cancelBooking(bookingId);
});
test('every grade, subject and lesson length can be prepared and reaches the generator with its own context',async()=>{
 for(const [subject,level,durationMin] of [['אנגלית','כיתה א–ב',45],['מדעים','כיתה ז',135],['מתמטיקה','תיכון 5 יחידות',90],['עברית','כיתה ד',90]]){
  const f=booking({bind:false,subject,level,durationMin});
  const job=J.getNativeLessonJob(f.bookingId);assert.equal(C.nativePreparationOpen(job),true,level);
  C.bindNativePreparation({bookingId:f.bookingId,studentId:f.student.id,...PREPARATION});
  let seen;const worker=controller({generate:async current=>{seen=current.snapshot.brief;return{bundle:{},version:'c'.repeat(64),sources:[]};}});worker.queue();await worker.settled();
  assert.deepEqual([seen.subject,seen.level,seen.durationMin],[subject,level,durationMin]);assert.equal(J.getNativeLessonJob(f.bookingId).state,'review',level);
 }
});
test('a booking without enrollment details cannot be bound',()=>{
 const account=E.createAccount({name:'Synthetic',credential:'no-enrollment'}),student=E.createStudent({code:'no-enrollment',name:'No enrollment',accountId:account.id,credential:'no-enrollment'});
 const enrollment=E.upsertEnrollment({studentId:student.id,subject:'מתמטיקה',level:'כיתה ג',teacherId:null});
 const bookingId=E.reserveBooking({studentId:student.id,enrollmentId:enrollment.id,start:'2028-09-01T10:00:00.000Z',end:'2028-09-01T10:45:00.000Z',durationMin:45});
 J.enqueueNativeLesson({bookingId,studentId:student.id});
 handle().prepare("UPDATE native_lesson_jobs SET snapshot=json_set(snapshot,'$.brief.missing',json('[\"subject\",\"topic\"]')) WHERE booking_id=?").run(bookingId);
 assert.equal(C.nativePreparationOpen(J.getNativeLessonJob(bookingId)),false);
 assert.throws(()=>C.bindNativePreparation({bookingId,studentId:student.id,...PREPARATION}),/incomplete_booking/);
 E.cancelBooking(bookingId);
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

function registerDouble(){
 const sheets=[],batches=[];
 const api={scope:'synthetic-scope',async json(url,init){
  if(url.includes(':batchUpdate')){const requests=JSON.parse(init.body).requests;batches.push(requests);for(const request of requests){
   if(request.addSheet)sheets.push({properties:{...request.addSheet.properties},developerMetadata:[],rows:[]});
   if(request.createDeveloperMetadata){const d=request.createDeveloperMetadata.developerMetadata;sheets.find(s=>s.properties.sheetId===d.location.sheetId).developerMetadata.push(d);}
   if(request.appendDimension){const s=sheets.find(s=>s.properties.sheetId===request.appendDimension.sheetId);assert.equal(request.appendDimension.dimension,'COLUMNS');s.properties.gridProperties.columnCount+=request.appendDimension.length;}
   if(request.updateCells){const u=request.updateCells,s=sheets.find(s=>s.properties.sheetId===u.start.sheetId);u.rows.forEach((r,i)=>r.values.forEach((c,j)=>{s.rows[u.start.rowIndex+i][u.start.columnIndex+j]=c.userEnteredValue.stringValue;}));}
   if(request.appendCells){const u=request.appendCells,s=sheets.find(s=>s.properties.sheetId===u.sheetId);u.rows.forEach(r=>{s.rows.push(r.values.map(c=>c.userEnteredValue.stringValue??c.userEnteredValue.boolValue));});}
  }return{};}
  if(url.includes('/values/')){const title=decodeURIComponent(url.split('/values/')[1].split('?')[0]).match(/^'([^']+)'/)[1];return{values:sheets.find(s=>s.properties.title===title).rows};}
  return{sheets};
 }};
 return{api,sheets,batches,materials:()=>sheets.find(s=>s.properties.title==='Native Materials')};
}
const SITE_HEADER='סטטוס אתר [site_status]';
test('a new Materials register has the optional site_status column from the start',async()=>{
 const {bookingId}=booking();const records=nativeDraftRecords(J.getNativeLessonJob(bookingId),receipt,'Synthetic');
 const d=registerDouble();await appendNativeDraftRecords(d.api,'native-index-id',records);
 assert.equal(d.materials().rows[0].at(-1),SITE_HEADER);
 assert.equal(d.materials().properties.gridProperties.columnCount,d.materials().rows[0].length);
 assert.equal(d.sheets.find(s=>s.properties.title==='Native Lessons').rows[0].includes(SITE_HEADER),false);
});
test('an existing Materials register gains site_status once, without touching tutor cells',async()=>{
 const {bookingId}=booking();const records=nativeDraftRecords(J.getNativeLessonJob(bookingId),receipt,'Synthetic');
 const d=registerDouble();await appendNativeDraftRecords(d.api,'native-index-id',records);
 const m=d.materials();m.rows[0].pop();m.properties.gridProperties.columnCount-=1;m.rows[1][1]='Human corrected title';
 const before=m.rows.slice(1).map(r=>[...r]);
 d.batches.length=0;
 await appendNativeDraftRecords(d.api,'native-index-id',records);
 assert.equal(m.rows[0].at(-1),SITE_HEADER);assert.equal(m.rows[1][1],'Human corrected title');
 assert.deepEqual(m.rows.slice(1),before,'data rows are untouched');
 assert.equal(m.properties.gridProperties.columnCount,m.rows[0].length);
 d.batches.length=0;await appendNativeDraftRecords(d.api,'native-index-id',records);
 assert.equal(d.batches.length,0,'a second run writes nothing');
});
test('site_status is never added over a populated column',async()=>{
 const {bookingId}=booking();const records=nativeDraftRecords(J.getNativeLessonJob(bookingId),receipt,'Synthetic');
 const d=registerDouble();await appendNativeDraftRecords(d.api,'native-index-id',records);
 const m=d.materials();m.rows[0].pop();m.rows[2][14]='tutor typed here';
 await assert.rejects(appendNativeDraftRecords(d.api,'native-index-id',records),/conflict/);
 assert.equal(m.rows[2][14],'tutor typed here');assert.equal(m.rows[0].length,14);
});

test('embedded-note decks are staff material, with no phantom notes Doc or student assignment',()=>{
 const {bookingId}=booking();const combined={...receipt,notesLocation:'slides'};delete combined.tutorNotes;
 const records=nativeDraftRecords(J.getNativeLessonJob(bookingId),combined,'Synthetic');
 const deck=records.Materials.find(m=>m.kind==='presentation');assert.equal(deck.audience,'staff');
 assert.equal(records.Materials.filter(m=>m.kind==='lesson_brief').length,0);
 assert.ok(records.Assignments.every(a=>a.material_id!==deck.material_id));
 const historical=nativeDraftRecords(J.getNativeLessonJob(bookingId),receipt,'Synthetic');assert.ok(historical.Materials.some(m=>m.url===receipt.tutorNotes.url),'existing separate-note receipts remain readable');
});

test('tutor brief drives fresh authoring; a saved generation survives registration retry and activities resolve its own version',async()=>{
 const {authorNativeLesson}=await import('../../src/lib/server/native-learning/authoring.ts');
 const {nativeBookingActivities}=await import('../../src/lib/server/native-learning/activities.ts');
 const {visualDeckFixture}=await import('../visual-deck-fixture.mjs');
 const f=booking({bind:false});
 handle().prepare("UPDATE bookings_v2 SET status='cancelled' WHERE id<>?").run(f.bookingId);
 C.bindNativePreparation({bookingId:f.bookingId,studentId:f.student.id,...PREPARATION});
 let generated=0,registered=0;const worker=controller({generate:job=>authorNativeLesson(job,async input=>{generated++;assert.match(input.context.readiness,/מתקשה באחוזים/);assert.equal(input.context.purpose,'booking');assert.equal(input.context.level,'כיתה יא · 3 יחידות');assert.equal(input.context.durationMin,90);assert.deepEqual(input.sourceIds,[]);assert.doesNotMatch(JSON.stringify(input.context),/Same name/);return structuredClone(visualDeckFixture());},()=>({model:'fixture',cliVersion:'fixture'})),publish:async input=>{assert.ok(input.activityBaseUrl.endsWith('/'+f.bookingId));return receipt;},register:async()=>{if(registered++<2)throw Error('quota');}});
 assert.equal(nativeBookingActivities(f.bookingId),null);
 worker.queue();await worker.settled();assert.equal(J.getNativeLessonJob(f.bookingId).state,'failed');assert.equal(generated,1);
 handle().prepare("UPDATE native_lesson_jobs SET retry_at='2000-01-01T00:00:00Z' WHERE booking_id=?").run(f.bookingId);
 worker.queue();await worker.settled();assert.equal(generated,1);assert.equal(J.getNativeLessonJob(f.bookingId).state,'failed');
 assert.throws(()=>C.bindNativePreparation({bookingId:f.bookingId,studentId:f.student.id,request:'different request',priorKnowledge:'different knowledge'}),/locked/);
 C.bindNativePreparation({bookingId:f.bookingId,studentId:f.student.id,...PREPARATION});worker.queue();await worker.settled();assert.equal(generated,1);
 const done=J.getNativeLessonJob(f.bookingId);assert.equal(done.state,'review');assert.equal(done.bundle.provenance.kind,'fresh-booking-generation');assert.equal(nativeBookingActivities(f.bookingId).version,done.snapshot.authored.version);
 E.cancelBooking(f.bookingId);assert.equal(nativeBookingActivities(f.bookingId),null);
});

test('a booking without tutor fields is never authored',async()=>{
 const f=booking({bind:false});let calls=0;const worker=controller({generate:async()=>{calls++;throw Error('must not author');}});worker.queue();await worker.settled();assert.equal(J.getNativeLessonJob(f.bookingId).reason,'missing_brief');assert.equal(calls,0);
});

test('generation quota errors retain a safe code and do not automatically retry',async()=>{
 const f=booking({bind:false});C.bindNativePreparation({bookingId:f.bookingId,studentId:f.student.id,request:'להבין את הנושא',priorKnowledge:'טרם נבדק באופן עצמאי'});
 const worker=controller({generate:async()=>{throw Object.assign(Error('PRIVATE_PROVIDER_RESPONSE'),{kind:'engine-quota'});}});worker.queue();await worker.settled();
 const failed=J.getNativeLessonJob(f.bookingId);assert.equal(failed.errorCode,'engine-quota');assert.equal(failed.retryAt,null);assert.doesNotMatch(JSON.stringify(failed),/PRIVATE_PROVIDER_RESPONSE/);
});

test('synthetic owner-review sample is validated and never requires a fake booking',async()=>{
 const{nativeActivitySource}=await import('../../src/lib/server/native-learning/activities.ts');const source=nativeActivitySource('sample');assert.equal(source.model,'gpt-5.6-terra');assert.equal(source.bundle.durationMin,90);assert.equal(source.version.length,64);assert.equal(nativeActivitySource('../sample'),null);assert.equal(nativeActivitySource('sample<script>'),null);
});

 test('a sealed publication refuses registration in a different archive',async()=>{
 const f=booking();const first=controller({register:async()=>{throw Error('quota');}});first.queue();await first.settled();
 assert.ok(J.getNativeLessonJob(f.bookingId).bundle.pendingPublication);
 handle().prepare("UPDATE native_lesson_jobs SET retry_at='2000-01-01T00:00:00Z' WHERE booking_id=?").run(f.bookingId);
 let writes=0;const second=controller({workspace:()=>({archiveId:'other-archive',indexId:'other-index'}),publish:async()=>{writes++;return receipt;},register:async()=>{writes++;}});second.queue();await second.settled();
 assert.equal(J.getNativeLessonJob(f.bookingId).errorCode,'conflict');assert.equal(writes,0);
 });

test('temporary disabled authoring retains sealed publication through manual resume',async()=>{
 const f=booking();const first=controller({register:async()=>{throw Error('quota');}});first.queue();await first.settled();
 handle().prepare("UPDATE native_lesson_jobs SET retry_at='2000-01-01T00:00:00Z' WHERE booking_id=?").run(f.bookingId);
 const disabled=controller({enabled:()=>false});disabled.queue();await disabled.settled();
 const paused=J.getNativeLessonJob(f.bookingId);assert.equal(paused.state,'needs-preparation');assert.ok(paused.bundle.pendingPublication);
 C.bindNativePreparation({bookingId:f.bookingId,studentId:f.student.id,...PREPARATION});
 const resumed=controller({publish:async()=>{throw Error('must reuse publication');}});resumed.queue();await resumed.settled();assert.equal(J.getNativeLessonJob(f.bookingId).state,'review');
});

test('sealed file registration revalidates privacy, location and ownership before linking',async()=>{
 let change={};let folders=0;
 const api={scope:'expected',async privateFolder(){folders++;},async json(url){const id=url.match(/files\/([^?]+)/)[1];return {id,mimeType:id===receipt.slides.id?'application/vnd.google-apps.presentation':'application/vnd.google-apps.document',parents:[receipt.reviewFolderId],owners:[{emailAddress:'owner@example.test'}],permissions:[{type:'user'}],appProperties:{meaCentralScope:'expected'},...change};}};
 const run=()=>validateNativeDraftFiles(api,{workspaceId:'workspace123',reviewId:'review12345'},receipt,{learningFolderId:'root123456',ownerEmail:'owner@example.test'});
 await run();assert.equal(folders,3);
 for(const [mutation,reason] of [[{permissions:[{type:'anyone'}]},'privacy'],[{permissions:undefined},'privacy'],[{owners:[{emailAddress:'other@example.test'}]},'ownership'],[{trashed:true},'conflict'],[{parents:['elsewhere']},'conflict'],[{appProperties:{meaCentralScope:'foreign'}},'conflict']]){change=mutation;await assert.rejects(run(),new RegExp(reason));}
 change={};api.privateFolder=async()=>{throw Error('conflict');};await assert.rejects(run(),/conflict/);
});
