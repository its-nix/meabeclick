import{test,after}from'node:test';import assert from'node:assert/strict';import{provider,artifact}from'../central-drive-fixture.mjs';
const{mkdtemp:makeSuite,rm:removeSuite}=await import('node:fs/promises');const{join:suiteJoin}=await import('node:path');const{tmpdir:suiteTmp}=await import('node:os');
const suiteRoot=await makeSuite(suiteJoin(suiteTmp(),'archive-suite-'));process.env.DB_PATH=suiteJoin(suiteRoot,'records.db');
after(async()=>{(await import('../../src/lib/server/db.ts')).handle().close();await removeSuite(suiteRoot,{recursive:true,force:true});});
test('archive register is read back completely and cannot overwrite a human change',async()=>{
 const{centralDriveApi}=await import('../../src/lib/server/central-drive/api.ts');
 const{writeVerifiedArchive}=await import('../../src/lib/server/central-drive/archive.ts');
 const p=provider(),api=centralDriveApi({access:p.access,fetch:p.fetch,checkpoint:p.checkpoint});await api.prepare();
 const folder=await api.folder('archive-test','Archive',p.access.config.learningFolderId);
 const reg=await api.native('archive-test-register','Archive register','application/vnd.google-apps.spreadsheet',folder.id);
 const views={students:[],materials:[['sample','plan',null,1,'sample.json','sample.json','a'.repeat(64),10,{text:'Open',url:'https://drive.google.com/file/d/verifiedfile123/view'},'application/json','verifiedfile123']],progress:[]};
 await writeVerifiedArchive(api,reg.file.id,views);const before=p.calls.length;
 await writeVerifiedArchive(api,reg.file.id,views);
 assert.equal(p.calls.slice(before).filter(c=>c.method==='POST').length,0,'verified archive is reused without rewriting');
 const sheet=p.spreadsheets.get(reg.file.id).sheets.find(s=>s.properties.title==='Site Materials');sheet.rows[1].values[0].userEnteredValue.stringValue='Teacher edit';
 await assert.rejects(writeVerifiedArchive(api,reg.file.id,views),/conflict/);
});
test('archive completion is serialized behind an active sync and a source change prevents retirement',async()=>{
 const{centralSyncController}=await import('../../src/lib/server/central-drive/sync.ts');
 const{mkdtemp,rm}=await import('node:fs/promises');const{join}=await import('node:path');const{tmpdir}=await import('node:os');
 const root=await mkdtemp(join(tmpdir(),'archive-sync-')),p=provider();let fingerprint='a'.repeat(64),completed=null,job=null,release,blocked=true,captures=0;
 const source=()=>({artifacts:[artifact()],students:[],progress:[],fingerprint,lessonSlugs:['old-lesson']});
 const gate=new Promise(r=>release=r),archive={current:()=>completed,begin:inv=>job??={archiveId:'archive-first',fingerprint:inv.fingerprint,slugs:inv.lessonSlugs},revision:()=>'stable',complete:(receipt)=>{completed=receipt;}};
 const service=()=>({status:()=>({state:'verified',account:p.access.config.ownerEmail,automaticSyncEnabled:true}),syncAccess:()=>p.access,setAutomaticSync:async()=>{}});
 const controller=centralSyncController({path:join(root,'state.json'),service,fetch:p.fetch,archive,inventory:async()=>{captures++;if(blocked){blocked=false;await gate;}return source();}});
 try{
  controller.queue();while(captures===0)await new Promise(r=>setImmediate(r));controller.archive();assert.equal(captures,1);release();await controller.settled();
  assert.equal(controller.view().phase,'complete');assert.ok(completed);assert.equal(completed.artifactCount,1);assert.equal(completed.lessonCount,1);assert.equal(captures,3);
  assert.ok([...p.files.values()].some(f=>f.mimeType==='application/vnd.google-apps.document'));
  const before=p.calls.length;controller.archive();await controller.settled();assert.equal(p.calls.length,before,'completed cutover cannot sweep up later work');
  completed=null;fingerprint='b'.repeat(64);controller.archive();await controller.settled();assert.equal(controller.view().error,'source_changed');assert.equal(completed,null);
 }finally{await rm(root,{recursive:true,force:true});}
});
