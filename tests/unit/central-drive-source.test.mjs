import{test,before,after}from'node:test';import assert from'node:assert/strict';
import{mkdtemp,mkdir,writeFile,rm,symlink}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';
let root,db,source;
before(async()=>{
 root=await mkdtemp(join(tmpdir(),'central-source-'));process.env.DB_PATH=join(root,'records.db');process.env.DATA_DIR=root;process.env.SESSION_SECRET='synthetic-only';
 ({handle:db}=await import('../../src/lib/server/db.ts'));db=db();
 const {createAccount,createStudent}=await import('../../src/lib/server/entities.ts');
 const account=createAccount({name:'משפחת בדיקה',email:'private@example.test',credential:'PRIVATE-PARENT-CREDENTIAL'});
 createStudent({code:'sample-student',name:'תלמיד בדיקה',accountId:account.id,credential:'PRIVATE-STUDENT-CREDENTIAL'});
 await mkdir(join(root,'lessons','sample-lesson'),{recursive:true});await mkdir(join(root,'games-data'),{recursive:true});await mkdir(join(root,'.credentials'),{recursive:true});
 await writeFile(join(root,'lessons','sample-lesson','slides.html'),'<html dir="rtl">$x^2$<svg></svg></html>');
 await writeFile(join(root,'games-data','sample-game.json'),' {"rounds":[1,2]} ');
 await writeFile(join(root,'.credentials','learning-google.json'),'PRIVATE-REFRESH-TOKEN');
 source=await import('../../src/lib/server/central-drive/source.ts');
});
after(async()=>{if(root)await rm(root,{recursive:true,force:true});});
test('one central inventory preserves original learning files and excludes credentials and operational data',async()=>{
 const inventory=await source.learningInventory({db,dataRoot:root,staticRoot:join(root,'static'),templatesRoot:join(root,'templates'),gamesRoot:join(root,'games')});
 assert.equal(inventory.students.length,1);assert.equal(inventory.students[0].code,'sample-student');
 const slides=inventory.artifacts.find(a=>a.key==='files/lessons/sample-lesson/slides.html');assert.ok(slides);assert.equal((await slides.read()).toString(),'<html dir="rtl">$x^2$<svg></svg></html>');
 const game=inventory.artifacts.find(a=>a.key==='files/games-data/sample-game.json');assert.equal((await game.read()).toString(),' {"rounds":[1,2]} ');
 const exported=inventory.artifacts.find(a=>a.key==='records/learning.json');const records=(await exported.read()).toString();
 assert.ok(records.includes('תלמיד בדיקה'));for(const secret of ['PRIVATE-PARENT-CREDENTIAL','PRIVATE-STUDENT-CREDENTIAL','PRIVATE-REFRESH-TOKEN'])assert.ok(!records.includes(secret));
 assert.ok(!records.includes('private@example.test'));assert.ok(!records.includes('payments'));assert.ok(inventory.artifacts.every(a=>!a.key.includes('.credentials')));
 assert.match(slides.sha256,/^[a-f0-9]{64}$/);assert.match(slides.md5,/^[a-f0-9]{32}$/);
 const again=await source.learningInventory({db,dataRoot:root,staticRoot:join(root,'static'),templatesRoot:join(root,'templates'),gamesRoot:join(root,'games')});assert.deepEqual(again.artifacts.map(a=>[a.key,a.sha256]),inventory.artifacts.map(a=>[a.key,a.sha256]));
});
test('immutable material/game versions, teacher reports and source changes remain discoverable',async()=>{
 const inventory=await source.learningInventory({db,dataRoot:root,staticRoot:join(root,'static'),templatesRoot:join(root,'templates'),gamesRoot:join(root,'games')});
 const records=JSON.parse((await inventory.artifacts.find(a=>a.key==='records/learning.json').read()).toString());
 for(const table of ['lesson_reports','lesson_report_notes','lesson_requests','game_skills','lesson_game_assignments','lesson_game_revisions'])assert.ok(Array.isArray(records[table]),table);
 const file=inventory.artifacts.find(a=>a.key==='files/games-data/sample-game.json');
 await writeFile(join(root,'games-data','sample-game.json'),'{"changed":true}');
 await assert.rejects(file.read(),/source_changed/);
 await symlink(join(root,'.credentials'),join(root,'games-data','unsafe-link'));
 await assert.rejects(source.learningInventory({db,dataRoot:root,staticRoot:join(root,'static'),templatesRoot:join(root,'templates'),gamesRoot:join(root,'games')}),/source_path/);
 await rm(join(root,'games-data','unsafe-link'));
});
test('all material revisions, private notes and database-only game bodies are actual exported artifacts',async()=>{
 const {addMaterial}=await import('../../src/lib/server/materials.ts');
 addMaterial({slug:'sample-versioned',kind:'plan',content:'{"title":"first"}',teacherOnly:'{"private":"teacher"}',origin:'generated',publish:true});
 addMaterial({slug:'sample-versioned',kind:'plan',content:'{"title":"second"}',origin:'edited',publish:true});
 const lesson=Number(db.prepare("INSERT INTO lessons(slug,student,at,status) VALUES('sample-versioned','sample-student','2026-11-12','ready')").run().lastInsertRowid);
 const student=db.prepare("SELECT id FROM students_v2 WHERE code='sample-student'").get().id;
 db.prepare("INSERT INTO lesson_game_assignments(id,lesson_id,student_id,template,title,status,draft_body,created_at,updated_at) VALUES(?,?,?,?,?,'published',?,?,?)").run('sample-assignment',lesson,student,'quiz','משחק בדיקה','{"draft":true}','2026-11-12','2026-11-12');
 db.prepare('INSERT INTO lesson_game_revisions(data_id,assignment_id,body,published_at) VALUES(?,?,?,?)').run('sample-revision','sample-assignment','{"published":true}','2026-11-12');
 const inventory=await source.learningInventory({db,dataRoot:root,staticRoot:join(root,'static'),templatesRoot:join(root,'templates'),gamesRoot:join(root,'games')});
 assert.equal(inventory.artifacts.filter(a=>a.key.startsWith('materials/')).length,2);
 assert.equal((await inventory.artifacts.find(a=>a.key.startsWith('material-notes/')).read()).toString(),'{"private":"teacher"}');
 assert.equal((await inventory.artifacts.find(a=>a.key==='game-drafts/sample-assignment').read()).toString(),'{"draft":true}');
 assert.equal((await inventory.artifacts.find(a=>a.key==='game-revisions/sample-revision').read()).toString(),'{"published":true}');
});
test('review presentations and media are included without requiring all media in memory',async()=>{
 await mkdir(join(root,'static','learning-media'),{recursive:true});const bytes=Buffer.alloc(20000,17);await writeFile(join(root,'static','learning-media','sample.mp4'),bytes);
 const inventory=await source.learningInventory({db,dataRoot:root,staticRoot:join(root,'static'),templatesRoot:join(root,'templates'),gamesRoot:join(root,'games')});
 const media=inventory.artifacts.find(a=>a.key==='resources/learning-media/sample.mp4');assert.equal(media.mimeType,'video/mp4');assert.deepEqual(await media.read(9000,1000),bytes.subarray(9000,10000));
 for(const key of ['review/baseline','review/v2','review/visual-pilot'])assert.ok(inventory.artifacts.some(a=>a.key===key),key);
});
