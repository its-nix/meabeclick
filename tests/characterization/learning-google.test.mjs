import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {startServer,login} from './harness.mjs';
const workspace={version:1,ownerEmail:'owner@example.com',projectFolderId:'project12345',learningFolderId:'learning12345',spreadsheetId:'spreadsheet12345',templatesFolderId:'templates12345',libraryFolderId:'library12345',studentsFolderId:'students12345',reviewFolderId:'review12345',studentProfileTemplateId:'profile12345',lessonBriefTemplateId:'brief12345'};
const path='/app/library/connection';
test('personal connection page is tutor-only, unconfigured setup is explicit and errors reveal no credentials',async()=>{
 const s=await startServer();try{
  const publicPage=await fetch(s.baseUrl+path,{redirect:'manual'});assert.equal(publicPage.status,302);assert.match(publicPage.headers.get('location'),/^\/login\?next=/);
  const cookie=await login(s.baseUrl),page=await fetch(s.baseUrl+path,{headers:{Cookie:cookie}});assert.equal(page.status,200);assert.match(page.headers.get('cache-control'),/no-store/);assert.match(await page.text(),/החיבור עדיין לא הוגדר/);
  const post=await fetch(s.baseUrl+path+'?/connect',{method:'POST',redirect:'manual',headers:{Cookie:cookie,Origin:s.baseUrl,Accept:'text/html'},body:new URLSearchParams()});assert.equal(post.status,503);
 }finally{await s.stop();}
});
test('hosted consent uses its own cookie and a same-session callback; normal login remains separate',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'learning-route-'));await writeFile(join(dir,'workspace.json'),JSON.stringify(workspace));
 const s=await startServer({env:{LEARNING_GOOGLE_CLIENT_ID:'synthetic-learning-client',LEARNING_GOOGLE_CLIENT_SECRET:'synthetic-learning-secret',LEARNING_GOOGLE_WORKSPACE_FILE:join(dir,'workspace.json'),LEARNING_GOOGLE_TOKEN_KEY:'ab'.repeat(32)}});
 try{
  const cookie=await login(s.baseUrl);
  const start=await fetch(s.baseUrl+path+'?/connect',{method:'POST',redirect:'manual',headers:{Cookie:cookie,Origin:s.baseUrl,Accept:'text/html'},body:new URLSearchParams()});
  assert.equal(start.status,303);const provider=new URL(start.headers.get('location'));assert.equal(provider.origin,'https://accounts.google.com');assert.equal(provider.searchParams.get('trigger_onepick'),'true');
  const set=start.headers.getSetCookie();assert.equal(set.length,1);assert.match(set[0],/maab_learning_google=/);assert.match(set[0],/HttpOnly/i);assert.match(set[0],/SameSite=Lax/i);assert.match(set[0],/Path=\/auth\/google/);
  const browser=set[0].split(';')[0],state=provider.searchParams.get('state');
  const cancelled=await fetch(s.baseUrl+'/auth/google/callback?'+new URLSearchParams({state,error:'access_denied'}),{redirect:'manual',headers:{Cookie:cookie+'; '+browser}});
  assert.equal(cancelled.status,303);assert.equal(cancelled.headers.get('location'),path+'?connectionError=cancelled');assert.ok(cancelled.headers.getSetCookie().every(c=>!c.startsWith('maab_session=')&&!c.startsWith('maab_google_flow=')));
  const replay=await fetch(s.baseUrl+'/auth/google/callback?'+new URLSearchParams({state,code:'secret-code'}),{redirect:'manual',headers:{Cookie:cookie+'; '+browser}});assert.equal(replay.headers.get('location'),path+'?connectionError=expired');
  const noSession=await fetch(s.baseUrl+'/auth/google/callback?state=learning.not-a-state&code=secret-code',{redirect:'manual',headers:{Cookie:browser}});assert.match(noSession.headers.get('location'),/^\/login\?next=%2Fapp%2Flibrary%2Fconnection/);assert.ok(!noSession.headers.get('location').includes('secret-code'));
  const cross=await fetch(s.baseUrl+path+'?/connect',{method:'POST',redirect:'manual',headers:{Cookie:cookie,Origin:'https://evil.test',Accept:'text/html'},body:new URLSearchParams()});assert.equal(cross.status,403);
  const page=await fetch(s.baseUrl+path+'?connectionError=arbitrary-secret',{headers:{Cookie:cookie}});const html=await page.text();assert.ok(!html.includes('synthetic-learning-secret'));assert.ok(!html.includes('arbitrary-secret'));
 }finally{await s.stop();await rm(dir,{recursive:true,force:true});}
});
test('a complete personal callback persists a server-only connection and can verify it again',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'learning-complete-'));await writeFile(join(dir,'workspace.json'),JSON.stringify(workspace));
 const s=await startServer({fakeGoogle:true,env:{CRON_KEY:'synthetic-central-cron',LEARNING_GOOGLE_CLIENT_ID:'synthetic-learning-client',LEARNING_GOOGLE_CLIENT_SECRET:'synthetic-learning-secret',LEARNING_GOOGLE_WORKSPACE_FILE:join(dir,'workspace.json'),LEARNING_GOOGLE_TOKEN_KEY:'ab'.repeat(32)}});
 try{
  const cookie=await login(s.baseUrl),start=await fetch(s.baseUrl+path+'?/connect',{method:'POST',redirect:'manual',headers:{Cookie:cookie,Origin:s.baseUrl,Accept:'text/html'},body:new URLSearchParams()});
  const provider=new URL(start.headers.get('location')),browser=start.headers.getSetCookie()[0].split(';')[0];
  const complete=await fetch(s.baseUrl+'/auth/google/callback?'+new URLSearchParams({state:provider.searchParams.get('state'),code:'learning.synthetic-code',picked_file_ids:provider.searchParams.get('file_ids')}),{redirect:'manual',headers:{Cookie:cookie+'; '+browser}});
  assert.equal(complete.status,303);assert.equal(complete.headers.get('location'),path);
  const page=await fetch(s.baseUrl+path,{headers:{Cookie:cookie}}),html=await page.text();
  assert.match(html,/מרחב הלמידה עבר בדיקה/);assert.ok(!html.includes('fake-learning-refresh'));assert.ok(!html.includes('fake-learning-access'));
  const status=await fetch(s.baseUrl+'/api/central-drive',{headers:{Cookie:cookie}});assert.equal(status.status,200);assert.equal((await status.json()).enabled,true);
  let synced;for(let i=0;i<500;i++){synced=await(await fetch(s.baseUrl+'/api/central-drive',{headers:{Cookie:cookie}})).json();if(synced.phase!=='running')break;await new Promise(r=>setTimeout(r,20));}
  assert.equal(synced.phase,'complete',JSON.stringify(synced));assert.ok(synced.total>0);assert.equal(synced.done,synced.total);assert.match(synced.indexUrl,/docs.google.com\/spreadsheets/);
  const dashboard=await(await fetch(s.baseUrl+'/app/dashboard',{headers:{Cookie:await login(s.baseUrl)}})).text();assert.match(dashboard,/האחסון המרכזי ב־Google Drive/);assert.match(dashboard,/owner@example.com/);
  const unauth=await fetch(s.baseUrl+'/api/central-drive');assert.equal(unauth.status,401);
  const cross=await fetch(s.baseUrl+'/api/central-drive',{method:'POST',headers:{Cookie:cookie,Origin:'https://evil.test','Content-Type':'application/json'},body:JSON.stringify({action:'pause'})});assert.equal(cross.status,403);
  const pause=await fetch(s.baseUrl+'/api/central-drive',{method:'POST',headers:{Cookie:cookie,Origin:s.baseUrl,'Content-Type':'application/json'},body:JSON.stringify({action:'pause'})});assert.equal(pause.status,200);assert.equal((await pause.json()).enabled,false);
  const legacy=await fetch(s.baseUrl+'/api/drive-sync',{headers:{'x-cron-key':'synthetic-central-cron'}});assert.deepEqual(await legacy.json(),{skipped:'central storage selected'});
  assert.equal((await fetch(s.baseUrl+'/api/central-drive-sync')).status,401);
  const cron=await(await fetch(s.baseUrl+'/api/central-drive-sync',{headers:{'x-cron-key':'synthetic-central-cron'}})).json();assert.equal(cron.enabled,false);assert.equal(cron.phase,'paused');assert.ok(!JSON.stringify(cron).includes('owner@example.com'));
  const verify=await fetch(s.baseUrl+path+'?/verify',{method:'POST',redirect:'manual',headers:{Cookie:cookie,Origin:s.baseUrl,Accept:'text/html'},body:new URLSearchParams()});assert.equal(verify.status,303);assert.equal(verify.headers.get('location'),path);
  const requests=s.googleRequests();assert.ok(requests.some(r=>r.url.includes('/drive/v3/files/learning12345')));assert.ok(!requests.some(r=>r.url.includes('values:batchGet')));
 }finally{await s.stop();await rm(dir,{recursive:true,force:true});}
});
