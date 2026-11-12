import{test}from'node:test';import assert from'node:assert/strict';import{mkdtemp,readFile,rm,stat}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';
import{provider,artifact}from'../central-drive-fixture.mjs';
test('one shared worker backfills profiles and indexed originals, serializes calls and reuses snapshots after restart',async()=>{
 const{centralSyncController}=await import('../../src/lib/server/central-drive/sync.ts');
 const dir=await mkdtemp(join(tmpdir(),'central-sync-')),path=join(dir,'state.json'),p=provider();let enabled=true,epoch='one',captures=0;
 const service=()=>({status:()=>({state:'verified',account:p.access.config.ownerEmail,automaticSyncEnabled:enabled}),centralSelected:()=>true,syncAccess:()=>{if(!enabled)throw Error('disabled');const captured=epoch;return{...p.access,epoch,assertCurrent(){if(!enabled||epoch!==captured)throw Error('paused');}};},setAutomaticSync:async value=>{enabled=value;epoch+='x';}});
 const source={artifacts:[artifact()],students:[{id:1,code:'synthetic',name:'Test student',goals:'Algebra',style:null,notes:'<private teacher note>',subjects:'Math',progress:20,progress_note:null}],progress:[['game',1,1,'math',4,5,null,'2026-11-12']],fingerprint:'sample'};
 const options={path,service,fetch:p.fetch,inventory:async()=>{captures++;return source;}};
 try{
  let controller=centralSyncController(options);controller.queue();controller.queue();await controller.settled();
  assert.equal(captures,1);assert.equal(controller.view().phase,'complete');assert.equal(controller.view().done,1);assert.ok(controller.view().indexUrl.startsWith('https://docs.google.com/spreadsheets/'));
  const before=p.files.size,profile=[...p.files.values()].find(f=>f.mimeType==='application/vnd.google-apps.document');assert.ok(profile.html.includes('Website')===false);assert.ok(!profile.html.includes('spreadsheet12345'));assert.match(profile.html,/&lt;private teacher note&gt;/);
  profile.html='Human edit';controller=centralSyncController(options);controller.queue();await controller.settled();
  assert.equal(p.files.size,before);assert.equal(profile.html,'Human edit');assert.equal(controller.view().reused,1);
  const disk=await readFile(path,'utf8');assert.ok(!disk.includes('private-refresh'));assert.ok(!disk.includes('Test student'));assert.equal((await stat(path)).mode&0o777,0o600);
  await controller.setEnabled(false);controller.queue();await controller.settled();assert.equal(captures,2);assert.equal(controller.view().phase,'paused');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('partial failure preserves the last complete index and pause prevents further writes until resume',async()=>{
 const{centralSyncController}=await import('../../src/lib/server/central-drive/sync.ts');
 const dir=await mkdtemp(join(tmpdir(),'central-failure-')),p=provider();let enabled=true,epoch=1,fail=false,gate,release;
 const service=()=>({status:()=>({state:'verified',account:p.access.config.ownerEmail,automaticSyncEnabled:enabled}),syncAccess:()=>{const captured=epoch;return{...p.access,epoch:String(epoch),assertCurrent(){if(!enabled||epoch!==captured)throw Error('paused');}};},setAutomaticSync:async value=>{enabled=value;epoch++;}});
 const controller=centralSyncController({path:join(dir,'state.json'),service,fetch:p.fetch,inventory:async()=>{if(gate)await gate;if(fail)throw Error('source_changed');return{artifacts:[artifact()],students:[],progress:[],fingerprint:'sample'};}});
 try{
  controller.queue();await controller.settled();const first=JSON.stringify([...p.spreadsheets]),success=controller.view().lastSuccess;
  fail=true;controller.queue();await controller.settled();assert.equal(controller.view().phase,'failed');assert.equal(controller.view().error,'source_changed');assert.equal(controller.view().lastSuccess,success);assert.equal(JSON.stringify([...p.spreadsheets]),first);
  fail=false;gate=new Promise(r=>{release=r;});controller.queue();while(controller.view().stage!=='reading')await new Promise(r=>setImmediate(r));
  await controller.setEnabled(false);const count=p.calls.length;release();await controller.settled();assert.equal(controller.view().phase,'paused');assert.equal(p.calls.length,count);
  gate=null;await controller.setEnabled(true);await controller.settled();assert.equal(controller.view().phase,'complete');assert.equal(controller.view().reused,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
