import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
let dir,google,env,config;
const workspace={version:1,ownerEmail:'owner@example.com',projectFolderId:'project12345',learningFolderId:'learning12345',spreadsheetId:'spreadsheet12345',templatesFolderId:'templates12345',libraryFolderId:'library12345',studentsFolderId:'students12345',reviewFolderId:'review12345',studentProfileTemplateId:'profile12345',lessonBriefTemplateId:'brief12345'};
before(async()=>{
 dir=await mkdtemp(join(tmpdir(),'learning-google-'));
 await writeFile(join(dir,'workspace.json'),JSON.stringify(workspace));
 env={DATA_DIR:dir,SITE_URL:'https://example.test',LEARNING_GOOGLE_CLIENT_ID:'personal-client',LEARNING_GOOGLE_CLIENT_SECRET:'personal-secret',LEARNING_GOOGLE_TOKEN_KEY:'ab'.repeat(32),LEARNING_GOOGLE_WORKSPACE_FILE:join(dir,'workspace.json')};
 google=await import('../../src/lib/server/learning-google.ts');config=google.learningGoogleConfig(env);
});
after(async()=>{if(dir)await rm(dir,{recursive:true,force:true});});
test('dedicated personal setup starts a browser/session bound hosted Picker without broader Drive scope',()=>{
 const service=google.learningConnectionService({config});
 const started=service.start('admin-session'),url=new URL(started.url);
 assert.equal(url.origin,'https://accounts.google.com');
 assert.equal(url.searchParams.get('scope'),'https://www.googleapis.com/auth/drive.file');
 assert.equal(url.searchParams.get('include_granted_scopes'),'false');
 assert.equal(url.searchParams.get('redirect_uri'),'https://example.test/auth/google/callback');
 assert.equal(url.searchParams.get('access_type'),'offline');
 assert.equal(url.searchParams.get('trigger_onepick'),'true');
 assert.equal(url.searchParams.get('allow_folder_selection'),'true');
 assert.equal(url.searchParams.get('allow_multiple'),'true');
 assert.equal(url.searchParams.get('file_ids').split(',').length,9);
 assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 assert.match(url.searchParams.get('state'),/^learning\.[\w-]{43}$/);assert.match(started.browser,/^[\w-]{43}$/);
 assert.ok(!url.href.includes('personal-secret'));
 assert.throws(()=>google.learningGoogleConfig({...env,LEARNING_GOOGLE_CLIENT_SECRET:undefined,GOOGLE_OAUTH_CLIENT_SECRET:'business'}),/setup/);
 assert.throws(()=>google.learningGoogleConfig({...env,LEARNING_GOOGLE_TOKEN_KEY:'bad'}),/setup/);
 assert.throws(()=>service.start(''),/session/);
});

async function provider(options={}){
 const {workspaceFixture}=await import('../learning-workspace-fixture.mjs');
 const {workspaceTables,workspaceHeader}=await import('../../src/lib/learning/workspace.ts');
 const fixture=workspaceFixture(),calls=[];
 const grids=Object.fromEntries(Object.entries(workspaceTables).map(([n,cols])=>[n,[cols.map(workspaceHeader),...fixture[n].map(r=>cols.map(c=>r[c.key]??''))]]));
 grids.Config=[['key','value'],['schema_version',options.badSchema?'2':'1'],['owner_email',workspace.ownerEmail],['project_folder_id',workspace.projectFolderId],['learning_folder_id',workspace.learningFolderId],['spreadsheet_id',workspace.spreadsheetId]];
 const fetch=async(input,init={})=>{
  const url=new URL(input);calls.push({url:String(url),init});
  if(options.network)throw Error('provider-secret-body');
  let data;
  if(url.hostname==='oauth2.googleapis.com')data={access_token:'sensitive-access',refresh_token:options.noRefresh?undefined:'sensitive-refresh',scope:'https://www.googleapis.com/auth/drive.file'};
  else if(url.pathname.endsWith('/about'))data={user:{emailAddress:options.wrongOwner?'wrong@example.com':workspace.ownerEmail}};
  else if(url.hostname==='www.googleapis.com'){
   const id=url.pathname.split('/').at(-1),file=google.learningFiles(workspace).find(f=>f.id===id);
   if(!file||options.missingFile===id)return new Response('sensitive-provider-error',{status:404});
   data={id,mimeType:file.type,parents:options.wrongParent?['wrong12345']:file.parent?[file.parent]:[],owners:[{emailAddress:options.wrongOwner?'wrong@example.com':workspace.ownerEmail}],trashed:false};
  }else if(url.pathname.endsWith('/values:batchGet'))data={valueRanges:url.searchParams.getAll('ranges').map(range=>({range,values:grids[range.split('!')[0].replaceAll("'",'')]}))};
  else data={spreadsheetId:workspace.spreadsheetId,properties:{timeZone:'Etc/UTC'},sheets:Object.entries({...workspaceTables,Config:[]}).map(([title,cols],i)=>({properties:{sheetId:i+1,title,gridProperties:{rowCount:100,columnCount:title==='Config'?2:cols.length}}}))};
  return Response.json(data);
 };return{fetch,calls};
}
function callback(service,session='admin-session'){
 const start=service.start(session),url=new URL(start.url);
 return{input:{state:url.searchParams.get('state'),browser:start.browser,session,authCode:'single-use-code',pickedFileIds:url.searchParams.get('file_ids'),error:null},url};
}
test('successful consent verifies live ownership/register then saves only encrypted private credentials',async()=>{
 const p=await provider(),service=google.learningConnectionService({config,fetch:p.fetch});
 const {input,url}=callback(service);await service.finish(input);
 const tokenCall=p.calls.find(c=>c.url==='https://oauth2.googleapis.com/token');
 const form=new URLSearchParams(tokenCall.init.body);
 const {createHash}=await import('node:crypto');
 assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'),url.searchParams.get('code_challenge'));
 assert.equal(form.get('client_id'),'personal-client');
 assert.equal(form.get('redirect_uri'),'https://example.test/auth/google/callback');
 const disk=await readFile(config.storePath,'utf8');assert.ok(!disk.includes('sensitive-refresh'));assert.ok(!disk.includes('sensitive-access'));
 assert.equal((await stat(config.storePath)).mode&0o777,0o600);
 const status=service.status();assert.equal(status.state,'verified');assert.equal(status.account,workspace.ownerEmail);assert.equal(status.realRecords.Students,0);assert.equal(status.automaticPublishing,false);assert.equal(status.readOnly,true);
 assert.ok(!JSON.stringify(status).includes('sensitive-'));
 assert.ok(p.calls.every(c=>c.init.method===undefined||c.init.method==='POST'&&c.url==='https://oauth2.googleapis.com/token'));
 assert.equal((await service.connected().readSnapshot()).Students.length,1);
 await assert.rejects(service.finish(input),/expired/);
});
test('wrong browser/session, expiry and replay cannot exchange a code',async()=>{
 let time=Date.now();const p=await provider(),service=google.learningConnectionService({config,fetch:p.fetch,now:()=>time});
 const {input}=callback(service);
 for(const changed of [{browser:'other'},{session:'other'}])await assert.rejects(service.finish({...input,...changed}),/expired/);
 assert.equal(p.calls.length,0);
 time+=10*60*1000;
 await assert.rejects(service.finish(input),/expired/);assert.equal(p.calls.length,0);
 for(let i=0;i<50;i++)service.start('admin-session');
 assert.throws(()=>service.start('admin-session'),/busy/);
 time+=10*60*1000;assert.ok(service.start('admin-session'));
});
test('cancelled/partial/foreign selection and provider failures preserve the saved connection',async()=>{
 const before=await readFile(config.storePath,'utf8');
 for(const [options,inputChange,reason]of [
  [{},{error:'access_denied'},/cancelled/],[{},{pickedFileIds:'foreign12345'},/selection/],
  [{noRefresh:true},{},/offline/],[{wrongOwner:true},{},/account/],
  [{missingFile:workspace.studentProfileTemplateId},{},/files/],[{wrongParent:true},{},/files/],
  [{badSchema:true},{},/register/],[{network:true},{},/google/],
 ]){
  const p=await provider(options),service=google.learningConnectionService({config,fetch:p.fetch});
  const {input}=callback(service);
  await assert.rejects(service.finish({...input,...inputChange}),e=>reason.test(e.message)&&!e.message.includes('sensitive')&&!e.message.includes('provider-secret'));
  assert.equal(await readFile(config.storePath,'utf8'),before);
  await assert.rejects(service.finish(input),/expired/);
 }
 const altered=google.learningConnectionService({config:{...config,tokenKey:'cd'.repeat(32)}});
 assert.throws(()=>altered.status(),/storage/);
 const different=google.learningConnectionService({config:{...config,clientId:'another-client'}});
 assert.throws(()=>different.status(),/storage/);
});
test('a verification started before a new consent cannot overwrite the newer credentials',async()=>{
 const p=await provider();let release,started;
 const held=new Promise(r=>{started=r;}),gate=new Promise(r=>{release=r;});let first=true;
 const fetch=async(input,init)=>{
  if(first&&new URL(input).hostname==='oauth2.googleapis.com'&&new URLSearchParams(init?.body).get('grant_type')==='refresh_token'){first=false;started();await gate;}
  return p.fetch(input,init);
 };
 const service=google.learningConnectionService({config,fetch}),checking=service.verify();await held;
 const {input}=callback(service);await service.finish(input);
 const latest=await readFile(config.storePath,'utf8');release();
 await assert.rejects(checking,/superseded/);
 assert.equal(await readFile(config.storePath,'utf8'),latest);
});
test('reordering private configuration keys preserves identity while changing a file invalidates it',async()=>{
 const reversed=Object.fromEntries(Object.entries(workspace).reverse());
 const path=join(dir,'reordered.json');await writeFile(path,JSON.stringify(reversed));
 const reordered=google.learningGoogleConfig({...env,LEARNING_GOOGLE_WORKSPACE_FILE:path});
 assert.equal(google.learningConnectionService({config:reordered}).status().state,'verified');
 assert.throws(()=>google.learningConnectionService({config:{...config,workspace:{...config.workspace,reviewFolderId:'changed12345'}}}).status(),/storage/);
});
test('a revoked connection reports a failed last check without exposing or deleting its credentials',async()=>{
 const p=await provider({network:true}),service=google.learningConnectionService({config,fetch:p.fetch});
 await assert.rejects(service.verify(),/google/);
 assert.equal(service.status().state,'failed');assert.equal(service.status().automaticPublishing,false);
 assert.ok(!JSON.stringify(service.status()).includes('sensitive'));
 const good=await provider();await google.learningConnectionService({config,fetch:good.fetch}).verify();
 assert.equal(service.status().state,'verified');
});
