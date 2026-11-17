import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
process.env.DB_PATH=join(mkdtempSync(join(tmpdir(),'native-games-publish-')),'db.sqlite');
const E=await import('../../src/lib/server/entities.ts');
const J=await import('../../src/lib/server/native-learning/jobs.ts');
const R=await import('../../src/lib/server/native-learning/register.ts');
const {getPilot}=await import('../../src/lib/server/visual-pilot.ts');
const {handle}=await import('../../src/lib/server/db.ts');
const receipt={version:1,state:'draft',sourceHash:'a'.repeat(64),reviewFolderId:'review-folder-id',slides:{id:'slides-native-id',url:'https://docs.google.com/presentation/d/slides-native-id/edit',mimeType:'x'},homework:{id:'homework-native-id',url:'https://docs.google.com/document/d/homework-native-id/edit',mimeType:'x'},activities:[],provenance:{kind:'fresh-booking-generation',bundleVersion:'v',sourceIds:['s']}};
let n=0;
function job(){n++;
 const account=E.createAccount({name:'S',credential:`pub-${n}`});const student=E.createStudent({code:`pub-${n}`,name:'S',accountId:account.id,credential:`pub-${n}`});
 const enrollment=E.upsertEnrollment({studentId:student.id,subject:'מתמטיקה',level:'כיתה יא · 3 יחידות',teacherId:null});
 const bookingId=E.reserveBooking({studentId:student.id,enrollmentId:enrollment.id,start:`2028-08-0${n}T10:00:00.000Z`,end:`2028-08-0${n}T11:30:00.000Z`,durationMin:90});
 J.enqueueNativeLesson({bookingId,studentId:student.id});return J.getNativeLessonJob(bookingId);
}
test('games file is written to the review folder and registered as a draft game Material with an Assignment',async()=>{
 const j=job(),bundle=getPilot().bundle,seen=[];
 const api={async blob(artifact,parent){seen.push({artifact,parent});return{file:{id:'games-file-id-123',mimeType:artifact.mimeType}};}};
 const written=await R.writeNativeGamesFile(api,'review-folder-id',bundle,j.bookingId);
 assert.equal(seen.length,1);assert.equal(seen[0].parent,'review-folder-id');assert.equal(seen[0].artifact.mimeType,'application/json');
 const text=(await seen[0].artifact.read()).toString('utf8'),file=JSON.parse(text);
 assert.equal(file.lessonRef,`booking-${j.bookingId}`);assert.ok(file.games.length>0);
 assert.equal(written.url,'https://drive.google.com/file/d/games-file-id-123/view');
 const records=R.nativeDraftRecords(j,receipt,'S',undefined,written);
 const m=records.Materials.find(x=>x.kind==='game'&&x.material_id.endsWith('-games-file'));
 assert.ok(m);assert.equal(m.review_status,'review');assert.equal(m.publication_status,'draft');assert.equal(m.release_id,'');assert.equal(m.content_sha256,written.sha256);assert.equal(m.audience,'student');
 assert.ok(records.Assignments.some(a=>a.material_id===m.material_id&&a.lesson_id===`booking-${j.bookingId}`&&a.status==='draft'));
});
test('no games means no file and no Materials row; old call shape unchanged',async()=>{
 const j=job();const api={async blob(){throw Error('must not write');}};
 assert.equal(await R.writeNativeGamesFile(api,'f',{...getPilot().bundle,games:[]},j.bookingId),null);
 assert.ok(!R.nativeDraftRecords(j,receipt,'S').Materials.some(m=>m.material_id.endsWith('-games-file')));
});
test('the games-file Material is a google_drive file, not a website',async()=>{
 const j=job();
 const written={url:'https://drive.google.com/file/d/games-file-id-123/view',sha256:'a'.repeat(64)};
 const records=R.nativeDraftRecords(j,receipt,'S',undefined,written);
 assert.equal(records.Materials.find(x=>x.material_id.endsWith('-games-file')).provider,'google_drive');
});
