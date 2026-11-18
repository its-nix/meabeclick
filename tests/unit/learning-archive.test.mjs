import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
let root,db,A;
before(async()=>{
 root=await mkdtemp(join(tmpdir(),'learning-archive-'));process.env.DB_PATH=join(root,'results.db');process.env.DATA_DIR=root;
 process.env.SESSION_SECRET='archive-test-session-secret-long-enough';
 db=(await import('../../src/lib/server/db.ts')).handle();A=await import('../../src/lib/server/learning-archive.ts');
});
after(async()=>{db?.close();if(root)await rm(root,{recursive:true,force:true});});
const fingerprint='a'.repeat(64),receipt={version:1,archiveId:'archive-first',fingerprint,archivedAt:'2026-11-14T12:00:00.000Z',artifactCount:3,lessonCount:2,
 workspaceId:'nativeworkspace123',libraryId:'nativelibrary123',presentationsId:'presentations123',homeworkId:'homeworkfolder123',gamesId:'gamesfolder123',notesId:'notesfolder123',templatesId:'templatesfolder123',reviewId:'reviewfolder123',archiveFolderId:'archivefolder123',archiveIndexId:'archiveindex123',studentsId:'studentsfolder123',indexId:'sitesheet12345',guideId:'guide123456789'};
const lesson=slug=>db.prepare("INSERT INTO lessons(slug,student,at,status) VALUES(?,'Synthetic learner',?,'ready')").run(slug,new Date().toISOString());
test('the cutover commits only its captured lesson set and keeps every historical record',()=>{
 for(const slug of ['old-master','assigned-lesson','new-lesson'])lesson(slug);
 const job=A.beginArchive({fingerprint,slugs:['old-master','assigned-lesson']});
 assert.equal(A.nativeWorkspace(),null);
 A.completeArchive({...receipt,archiveId:job.archiveId},A.sourceRevision());
 assert.equal(A.nativeWorkspace().archiveIndexId,receipt.archiveIndexId);
 assert.equal(db.prepare('SELECT count(*) n FROM lessons').get().n,3,'the historical store stays intact');
 assert.deepEqual(A.archiveJob().slugs,['assigned-lesson','old-master'],'the receipt keeps the archived slugs');
 const again=A.beginArchive({fingerprint:'b'.repeat(64),slugs:['new-lesson']});assert.equal(again.archiveId,job.archiveId);
 assert.deepEqual(again.slugs,['assigned-lesson','old-master'],'repeated activation cannot sweep in new work');
});
test('a changed database revision and unverified receipts cannot complete the cutover',()=>{
 db.exec('DELETE FROM learning_archive');
 const job=A.beginArchive({fingerprint,slugs:['assigned-lesson']});
 const revision=A.sourceRevision();
 db.prepare('UPDATE lessons SET status=? WHERE slug=?').run('held','assigned-lesson');
 assert.throws(()=>A.completeArchive({...receipt,archiveId:job.archiveId,lessonCount:1},revision),/source_changed/);
 assert.equal(A.nativeWorkspace(),null);
 assert.throws(()=>A.completeArchive({...receipt,archiveId:job.archiveId,lessonCount:1,fingerprint:'c'.repeat(64)},A.sourceRevision()),/source_changed/);
 assert.equal(A.nativeWorkspace(),null);
 const revision2=A.sourceRevision();const other=new (db.constructor)(process.env.DB_PATH);other.prepare('UPDATE lessons SET status=? WHERE slug=?').run('ready','assigned-lesson');other.close();
 assert.throws(()=>A.completeArchive({...receipt,archiveId:job.archiveId,lessonCount:1},revision2),/source_changed/);
 assert.equal(A.beginArchive({fingerprint:'b'.repeat(64),slugs:['new-lesson']}).fingerprint,fingerprint,'retry retains the original snapshot');
});
