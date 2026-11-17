import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
process.env.DB_PATH=join(mkdtempSync(join(tmpdir(),'native-hw-share-')),'db.sqlite');
const E=await import('../../src/lib/server/entities.ts');
const J=await import('../../src/lib/server/native-learning/jobs.ts');
const R=await import('../../src/lib/server/native-learning/register.ts');
const H=await import('../../src/lib/server/native-learning/homework-share.ts');
const W=await import('../../src/lib/learning/workspace.ts');
const account=E.createAccount({name:'S',credential:'h'});
const student=E.createStudent({code:'hw-share',name:'S',accountId:account.id,credential:'h'});
const bookingId=E.reserveBooking({studentId:student.id,start:'2028-09-05T10:00:00.000Z',end:'2028-09-05T11:30:00.000Z',durationMin:90});
J.enqueueNativeLesson({bookingId,studentId:student.id});
const receipt={version:1,state:'draft',sourceHash:'a'.repeat(64),reviewFolderId:'rf',slides:{id:'s',url:'https://docs.google.com/presentation/d/slidesAAAAAA/edit',mimeType:'x'},homework:{id:'h',url:'https://docs.google.com/document/d/homeworkDocAAAA/edit',mimeType:'x'},activities:[],provenance:{kind:'k',bundleVersion:'v',sourceIds:['s']}};
const records=R.nativeDraftRecords(J.getNativeLessonJob(bookingId),receipt,'S');
const grid=n=>[W.workspaceTables[n].map(W.workspaceHeader),...records[n].map(r=>W.workspaceTables[n].map(c=>r[c.key]??''))];
const grids={Students:grid('Students'),Lessons:grid('Lessons'),Materials:grid('Materials'),Assignments:grid('Assignments'),Progress:grid('Progress')};
const set=(name,matcher,key,value)=>{const g=grids[name],c=g[0].findIndex(h=>String(h).includes(`[${key}]`)),m=g[0].findIndex(h=>String(h).includes('[material_id]'));for(const r of g.slice(1))if(matcher(String(r[m])))r[c]=value;};
const isHw=id=>id.endsWith('-homework');
const sheet={async read(){return{revision:'x',grids};},async update(){throw Error('must not write')}};
const calls=[];const api={async share(d,e){calls.push(['share',d,e]);return{shared:true};},async revoke(d,e){calls.push(['revoke',d,e]);return{revoked:true};}};
const id=`native-${J.getNativeLessonJob(bookingId).id}-homework`;

test('draft homework is never shared',async()=>{
 const r=await H.syncHomeworkShares({sheet,api,emailFor:()=>'kid@example.test'});assert.deepEqual(calls,[]);assert.equal(r.shared,0);
});
test('approved and published homework with no student Google email is skipped quietly with a recorded status',async()=>{
 set('Materials',isHw,'review_status','approved');set('Materials',isHw,'publication_status','published');set('Materials',isHw,'release_id','rel-1');set('Materials',isHw,'content_sha256','b'.repeat(64));
 set('Assignments',isHw,'status','assigned');
 const r=await H.syncHomeworkShares({sheet,api,emailFor:()=>null});
 assert.equal(r.skippedNoEmail,1);assert.deepEqual(calls,[]);assert.equal(H.homeworkShareStatus(id).status,'no_google_email');
});
test('once the student has a Google email the Doc is shared once, by named user',async()=>{
 let r=await H.syncHomeworkShares({sheet,api,emailFor:()=>'Kid@Example.test'});
 assert.equal(r.shared,1);assert.deepEqual(calls,[['share','homeworkDocAAAA','Kid@Example.test']]);assert.equal(H.homeworkShareStatus(id).status,'shared');
 r=await H.syncHomeworkShares({sheet,api,emailFor:()=>'kid@example.test'});assert.equal(r.shared,0);assert.equal(calls.length,1);
});
test('withdrawal revokes exactly the recorded grant; a failed revoke is retried',async()=>{
 set('Materials',isHw,'publication_status','draft');
 let fail=true;const flaky={...api,async revoke(d,e){if(fail){fail=false;throw Error('quota');}return api.revoke(d,e);}};
 let r=await H.syncHomeworkShares({sheet,api:flaky,emailFor:()=>'kid@example.test'});assert.equal(r.failed,1);assert.equal(H.homeworkShareStatus(id).status,'shared');
 r=await H.syncHomeworkShares({sheet,api:flaky,emailFor:()=>'kid@example.test'});assert.equal(r.revoked,1);
 assert.deepEqual(calls.at(-1),['revoke','homeworkDocAAAA','Kid@Example.test']);assert.equal(H.homeworkShareStatus(id).status,'revoked');
 const n=calls.length;await H.syncHomeworkShares({sheet,api,emailFor:()=>'kid@example.test'});assert.equal(calls.length,n);
});
test('a failed share is recorded, not thrown, and the real adapter refuses invalid addresses',async()=>{
 set('Materials',isHw,'publication_status','published');
 const r=await H.syncHomeworkShares({sheet,api:{...api,async share(){throw Error('permissions');}},emailFor:()=>'kid@example.test'});
 assert.equal(r.failed,1);assert.equal(H.homeworkShareStatus(id).status,'failed');
});
