import{test}from'node:test';import assert from'node:assert/strict';import{createHash}from'node:crypto';
import{provider,artifact,config}from'../central-drive-fixture.mjs';
test('shared personal folder is validated before scoped, resumable content upload and unchanged bytes are reused',async()=>{
 const {centralDriveApi}=await import('../../src/lib/server/central-drive/api.ts');const p=provider(),api=centralDriveApi({access:p.access,fetch:p.fetch,checkpoint:p.checkpoint});
 await api.prepare();const folder=await api.folder('site','Website sync',config.learningFolderId),a=artifact();const first=await api.blob(a,folder.id),again=await api.blob(a,folder.id);
 assert.equal(first.reused,false);assert.equal(again.reused,true);assert.equal(first.file.id,again.file.id);assert.equal(p.files.size,2);assert.deepEqual(p.files.get(first.file.id).bytes,await a.read());
 assert.ok(p.calls.every(c=>!new URL(c.url).pathname.includes('/permissions')));assert.ok(!JSON.stringify(p.checkpoint.read()).includes('private-access'));
 p.pause();await assert.rejects(api.folder('other','Other',config.learningFolderId),/paused/);
});
test('private ownership is mandatory and bearer credentials can never target a foreign host',async()=>{
 const{centralDriveApi}=await import('../../src/lib/server/central-drive/api.ts');
 for(const [options,reason]of [[{publicRoot:true},/privacy/],[{wrongOwner:true},/ownership/]]){const p=provider(options);await assert.rejects(centralDriveApi({access:p.access,fetch:p.fetch,checkpoint:p.checkpoint}).prepare(),reason);assert.equal(p.calls.filter(c=>c.method!=='GET'&&!c.url.includes('oauth2.googleapis.com')).length,0);}
 const p=provider(),api=centralDriveApi({access:p.access,fetch:p.fetch,checkpoint:p.checkpoint});await api.prepare();const count=p.calls.length;
 await assert.rejects(api.json('https://evil.test/private'),/google_response/);assert.equal(p.calls.length,count);
});
test('a lost chunk acknowledgement resumes the persisted upload without a second file or repeated accepted bytes',async()=>{
 const{centralDriveApi}=await import('../../src/lib/server/central-drive/api.ts');const p=provider({loseChunk:true}),a=artifact(Buffer.alloc(8*1024*1024+17,120));
 let api=centralDriveApi({access:p.access,fetch:p.fetch,checkpoint:p.checkpoint});await api.prepare();const folder=await api.folder('site','Website sync',config.learningFolderId);
 await assert.rejects(api.blob(a,folder.id),/google/);assert.ok(p.checkpoint.read().url);
 api=centralDriveApi({access:p.access,fetch:p.fetch,checkpoint:p.checkpoint});await api.prepare();const result=await api.blob(a,folder.id);
 assert.deepEqual(p.files.get(result.file.id).bytes,await a.read());assert.equal(p.files.size,2);assert.equal(p.checkpoint.read(),null);
 const uploaded=p.calls.filter(c=>c.method==='PUT'&&!new Headers(c.headers).get('Content-Range').startsWith('bytes */')).reduce((n,c)=>n+c.body.length,0);assert.equal(uploaded,a.size);
});
test('moved, edited and ambiguous snapshots are never overwritten',async()=>{
 const{centralDriveApi}=await import('../../src/lib/server/central-drive/api.ts');
 for(const change of ['moved','edited','duplicate']){
  const p=provider(),a=artifact();let api=centralDriveApi({access:p.access,fetch:p.fetch,checkpoint:p.checkpoint});await api.prepare();const folder=await api.folder('site','Website sync',config.learningFolderId),saved=await api.blob(a,folder.id),file=p.files.get(saved.file.id);
  if(change==='moved')file.parents=['elsewhere12345'];if(change==='edited')file.md5Checksum='different';if(change==='duplicate')p.files.set('duplicate12345',{...file,id:'duplicate12345'});
  api=centralDriveApi({access:p.access,fetch:p.fetch,checkpoint:p.checkpoint});await api.prepare();const before=p.calls.length;await assert.rejects(api.blob(a,folder.id),/conflict/);assert.equal(p.calls.length,before);
 }
});
test('a publicly shared app folder stops uploads even when the selected root is private',async()=>{
 const{centralDriveApi}=await import('../../src/lib/server/central-drive/api.ts');const p=provider();let api=centralDriveApi({access:p.access,fetch:p.fetch,checkpoint:p.checkpoint});await api.prepare();
 const folder=await api.folder('site','Website sync',config.learningFolderId);p.files.get(folder.id).permissions=[{type:'anyone'}];
 api=centralDriveApi({access:p.access,fetch:p.fetch,checkpoint:p.checkpoint});await api.prepare();await assert.rejects(api.folder('site','Website sync',config.learningFolderId),/privacy/);
});
