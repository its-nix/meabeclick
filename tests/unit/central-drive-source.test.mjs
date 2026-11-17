import{test,before,after}from'node:test';import assert from'node:assert/strict';
import{mkdtemp,mkdir,writeFile,rm,symlink}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';
let root,db,source;
before(async()=>{
 root=await mkdtemp(join(tmpdir(),'central-source-'));process.env.DB_PATH=join(root,'records.db');process.env.DATA_DIR=root;process.env.SESSION_SECRET='synthetic-only';
 ({handle:db}=await import('../../src/lib/server/db.ts'));db=db();
 const {createAccount,createStudent}=await import('../../src/lib/server/entities.ts');
 const account=createAccount({name:'משפחת בדיקה',email:'private@example.test',credential:'PRIVATE-PARENT-CREDENTIAL'});
 createStudent({code:'sample-student',name:'תלמיד בדיקה',accountId:account.id,credential:'PRIVATE-STUDENT-CREDENTIAL'});
 await mkdir(join(root,'drafts','sample-lesson'),{recursive:true});await mkdir(join(root,'.credentials'),{recursive:true});
 await writeFile(join(root,'drafts','sample-lesson','slides.html'),'<html dir="rtl">$x^2$<svg></svg></html>');
 await writeFile(join(root,'drafts','sample-lesson','lesson.json'),' {"title":"draft"} ');
 await writeFile(join(root,'.credentials','learning-google.json'),'PRIVATE-REFRESH-TOKEN');
 source=await import('../../src/lib/server/central-drive/source.ts');
});
after(async()=>{if(root)await rm(root,{recursive:true,force:true});});
test('one central inventory preserves original learning files and excludes credentials and operational data',async()=>{
 const inventory=await source.learningInventory({db,dataRoot:root,staticRoot:join(root,'static'),templatesRoot:join(root,'templates')});
 assert.equal(inventory.students.length,1);assert.equal(inventory.students[0].code,'sample-student');
 const slides=inventory.artifacts.find(a=>a.key==='files/drafts/sample-lesson/slides.html');assert.ok(slides);assert.equal((await slides.read()).toString(),'<html dir="rtl">$x^2$<svg></svg></html>');
 const draft=inventory.artifacts.find(a=>a.key==='files/drafts/sample-lesson/lesson.json');assert.equal((await draft.read()).toString(),' {"title":"draft"} ');
 const exported=inventory.artifacts.find(a=>a.key==='records/learning.json');const records=(await exported.read()).toString();
 assert.ok(records.includes('תלמיד בדיקה'));for(const secret of ['PRIVATE-PARENT-CREDENTIAL','PRIVATE-STUDENT-CREDENTIAL','PRIVATE-REFRESH-TOKEN'])assert.ok(!records.includes(secret));
 assert.ok(!records.includes('private@example.test'));assert.ok(!records.includes('payments'));assert.ok(inventory.artifacts.every(a=>!a.key.includes('.credentials')));
 assert.match(slides.sha256,/^[a-f0-9]{64}$/);assert.match(slides.md5,/^[a-f0-9]{32}$/);
 const again=await source.learningInventory({db,dataRoot:root,staticRoot:join(root,'static'),templatesRoot:join(root,'templates')});assert.deepEqual(again.artifacts.map(a=>[a.key,a.sha256]),inventory.artifacts.map(a=>[a.key,a.sha256]));
});
test('teacher reports, native results and source changes remain discoverable',async()=>{
 const inventory=await source.learningInventory({db,dataRoot:root,staticRoot:join(root,'static'),templatesRoot:join(root,'templates')});
 const records=JSON.parse((await inventory.artifacts.find(a=>a.key==='records/learning.json').read()).toString());
 for(const table of ['lesson_reports','lesson_report_notes','lesson_requests','native_results'])assert.ok(Array.isArray(records[table]),table);
 const file=inventory.artifacts.find(a=>a.key==='files/drafts/sample-lesson/lesson.json');
 await writeFile(join(root,'drafts','sample-lesson','lesson.json'),'{"changed":true}');
 await assert.rejects(file.read(),/source_changed/);
 await symlink(join(root,'.credentials'),join(root,'drafts','unsafe-link'));
 await assert.rejects(source.learningInventory({db,dataRoot:root,staticRoot:join(root,'static'),templatesRoot:join(root,'templates')}),/source_path/);
 await rm(join(root,'drafts','unsafe-link'));
});
test('all material revisions and private notes are actual exported artifacts',async()=>{
 const {addMaterial}=await import('../../src/lib/server/materials.ts');
 addMaterial({slug:'sample-versioned',kind:'plan',content:'{"title":"first"}',teacherOnly:'{"private":"teacher"}',origin:'generated',publish:true});
 addMaterial({slug:'sample-versioned',kind:'plan',content:'{"title":"second"}',origin:'edited',publish:true});
 const inventory=await source.learningInventory({db,dataRoot:root,staticRoot:join(root,'static'),templatesRoot:join(root,'templates')});
 assert.equal(inventory.artifacts.filter(a=>a.key.startsWith('materials/')).length,2);
 assert.equal((await inventory.artifacts.find(a=>a.key.startsWith('material-notes/')).read()).toString(),'{"private":"teacher"}');
});
test('review presentations and media are included without requiring all media in memory',async()=>{
 await mkdir(join(root,'static','learning-media'),{recursive:true});const bytes=Buffer.alloc(20000,17);await writeFile(join(root,'static','learning-media','sample.mp4'),bytes);
 const inventory=await source.learningInventory({db,dataRoot:root,staticRoot:join(root,'static'),templatesRoot:join(root,'templates')});
 const media=inventory.artifacts.find(a=>a.key==='resources/learning-media/sample.mp4');assert.equal(media.mimeType,'video/mp4');assert.deepEqual(await media.read(9000,1000),bytes.subarray(9000,10000));
 for(const key of ['review/baseline','review/v2','review/visual-pilot'])assert.ok(inventory.artifacts.some(a=>a.key===key),key);
});
