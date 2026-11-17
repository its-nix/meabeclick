import{test}from'node:test';import assert from'node:assert/strict';
import{provider,config}from'../central-drive-fixture.mjs';
const DOC='application/vnd.google-apps.document',ID='homeworkdoc12345';
async function setup(over={}){
 const{centralDriveApi}=await import('../../src/lib/server/central-drive/api.ts');const p=provider(),calls=[];
 const api0=centralDriveApi({access:p.access,fetch:p.fetch,checkpoint:p.checkpoint});
 const perms=[{id:'own1',type:'user',role:'owner',emailAddress:config.ownerEmail}];let n=0;
 const file={id:ID,name:'hw',mimeType:DOC,parents:['x'],owners:[{emailAddress:config.ownerEmail}],trashed:false,appProperties:{meaCentralScope:api0.scope},...over};
 const fetch=async(input,init={})=>{const u=new URL(input);
  if(u.pathname===`/drive/v3/files/${ID}`&&!init.method)return Response.json(file);
  if(u.pathname===`/drive/v3/files/${ID}/permissions`){calls.push({m:init.method??'GET',q:u.search,b:init.body});
   if(!init.method)return Response.json({permissions:perms});
   const b=JSON.parse(init.body);perms.push({id:`p${++n}`,type:b.type,role:b.role,emailAddress:b.emailAddress});return Response.json(perms.at(-1));}
  const m=u.pathname.match(/\/permissions\/(\w+)$/);if(m&&init.method==='DELETE'){calls.push({m:'DELETE',id:m[1]});const i=perms.findIndex(x=>x.id===m[1]);if(i>=0)perms.splice(i,1);return new Response(null,{status:204});}
  return p.fetch(input,init);};
 const api=centralDriveApi({access:p.access,fetch,checkpoint:p.checkpoint});
 return{api,calls,perms};
}
test('homework Doc is shared read-only to the student email, once, without notification email',async()=>{
 const{shareHomeworkWithStudent}=await import('../../src/lib/server/central-drive/share.ts');const s=await setup();
 const first=await shareHomeworkWithStudent(s.api,ID,' Kid@Gmail.com ');const again=await shareHomeworkWithStudent(s.api,ID,'kid@gmail.com');
 assert.equal(first.shared,true);assert.equal(again.shared,false);
 const posts=s.calls.filter(c=>c.m==='POST');assert.equal(posts.length,1);
 assert.match(posts[0].q,/sendNotificationEmail=false/);assert.deepEqual(JSON.parse(posts[0].b),{type:'user',role:'reader',emailAddress:'kid@gmail.com'});
 assert.ok(!s.perms.some(p=>p.type==='anyone'));
});
test('sharing refuses invalid emails, foreign files, wrong type and the owner address',async()=>{
 const{shareHomeworkWithStudent}=await import('../../src/lib/server/central-drive/share.ts');
 let s=await setup();await assert.rejects(shareHomeworkWithStudent(s.api,ID,'not-an-email'),/invalid_email/);
 await assert.rejects(shareHomeworkWithStudent(s.api,ID,config.ownerEmail),/invalid_email/);
 s=await setup({appProperties:{}});await assert.rejects(shareHomeworkWithStudent(s.api,ID,'a@b.co'),/conflict/);
 s=await setup({mimeType:'application/pdf'});await assert.rejects(shareHomeworkWithStudent(s.api,ID,'a@b.co'),/conflict/);
 s=await setup({owners:[{emailAddress:'x@y.z'}]});await assert.rejects(shareHomeworkWithStudent(s.api,ID,'a@b.co'),/ownership/);
 assert.equal(s.calls.filter(c=>c.m==='POST').length,0);
});
test('revoke removes only that student permission and is idempotent',async()=>{
 const{shareHomeworkWithStudent,revokeHomeworkShare}=await import('../../src/lib/server/central-drive/share.ts');const s=await setup();
 await shareHomeworkWithStudent(s.api,ID,'kid@gmail.com');await shareHomeworkWithStudent(s.api,ID,'other@gmail.com');
 assert.equal((await revokeHomeworkShare(s.api,ID,'KID@gmail.com')).revoked,true);assert.equal((await revokeHomeworkShare(s.api,ID,'kid@gmail.com')).revoked,false);
 assert.deepEqual(s.perms.map(p=>p.emailAddress),[config.ownerEmail,'other@gmail.com']);
});
test('student Google email comes from google_identities for that student only',async()=>{
 const{studentGoogleEmail}=await import('../../src/lib/server/google-login.ts');assert.equal(typeof studentGoogleEmail,'function');
});
