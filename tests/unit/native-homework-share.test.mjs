import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
process.env.DB_PATH=join(mkdtempSync(join(tmpdir(),'native-hw-share-')),'db.sqlite');

const E=await import('../../src/lib/server/entities.ts');
const {handle}=await import('../../src/lib/server/db.ts');
const J=await import('../../src/lib/server/native-learning/jobs.ts');
const R=await import('../../src/lib/server/native-learning/register.ts');
const H=await import('../../src/lib/server/native-learning/homework-share.ts');
const {placeHomeworkDoc}=await import('../../src/lib/server/native-learning/homework-placement.ts');
const {homeworkDeliveryPermissions}=await import('../../src/lib/server/central-drive/share.ts');
const {verifyFeedbackFile}=await import('../../src/lib/server/learning-feedback/google.ts');
const W=await import('../../src/lib/learning/workspace.ts');

const docId='homeworkDocAAAA',review='reviewFolderAAA',target='studentFolderAAA';
const owner='operator@example.test',writer='learner@example.test',parent='parent@example.test';
const docType='application/vnd.google-apps.document';
const hash='a'.repeat(64);
let sequence=0;

function fixture(){
 const serial=++sequence;
 const account=E.createAccount({name:'Parent',credential:'h'});
 const student=E.createStudent({code:`hw-share-${serial}`,name:'Learner',accountId:account.id,credential:'h'});
 const bookingId=E.reserveBooking({studentId:student.id,start:`2028-09-${String(serial).padStart(2,'0')}T10:00:00.000Z`,end:`2028-09-${String(serial).padStart(2,'0')}T11:30:00.000Z`,durationMin:90});
 const job=J.enqueueNativeLesson({bookingId,studentId:student.id});
 const receipt={sourceHash:hash,reviewFolderId:review,slides:{url:'https://docs.google.com/presentation/d/tutorSlidesAAAA/edit'},homework:{id:docId,url:`https://docs.google.com/document/d/${docId}/edit`},activities:[]};
 handle().prepare("UPDATE bookings_v2 SET status='confirmed' WHERE id=?").run(bookingId);
 handle().prepare("UPDATE native_lesson_jobs SET state='review',bundle=? WHERE id=?").run(JSON.stringify(receipt),job.id);
 const records=R.nativeDraftRecords(job,receipt,'Learner');
 const material=records.Materials.find(m=>m.kind==='homework');
 const assignment=records.Assignments.find(a=>a.material_id===material.material_id);
 const sheet={async read(){return {revision:'fixture',grids:Object.fromEntries(Object.entries(records).filter(([k,v])=>Array.isArray(v)).map(([k,v])=>[k,[W.workspaceTables[k].map(W.workspaceHeader),...v.map(row=>W.workspaceTables[k].map(c=>row[c.key]??''))]]))};}};
 const file={id:docId,mimeType:docType,parents:[review],owners:[{emailAddress:owner}],writersCanShare:true,resourceKey:'fixture-key',appProperties:{meaCentralScope:'fixture'}};
 const permissions=[{id:'owner',type:'user',role:'owner',emailAddress:owner},{id:'tutor',type:'user',role:'writer',emailAddress:'tutor@example.test'}];
 const writes=[];
 let failCreate=false,failDelete=false,value='original worksheet',differentFolders=false;
 const api={scope:'fixture',ownerEmail:owner,
  async json(raw,init){
   const url=new URL(raw),fileId=url.pathname.split('/')[4];
   if([review,target].includes(fileId)){
    assert.equal(init?.method,undefined);
    return {id:fileId,mimeType:'application/vnd.google-apps.folder',permissions:differentFolders&&fileId===target?permissions.slice(0,1):permissions.slice(0,2)};
   }
   assert.equal(fileId,docId);
   const body=init?.body?JSON.parse(init.body):null;
   if(init?.method)writes.push({path:url.pathname,query:url.search,method:init.method,body});
   if(!url.pathname.includes('/permissions')){
    if(url.searchParams.has('addParents'))file.parents=[url.searchParams.get('addParents')];
    if(body)Object.assign(file,body);
    return {...file,permissions:structuredClone(permissions)};
   }
   if(init?.method==='POST'){
    const entry={id:body.type==='anyone'?'anyone':`user-${body.emailAddress.replace(/\W/g,'-')}`,...body};
    assert.ok(!permissions.some(p=>p.id===entry.id));
    permissions.push(entry);
    if(failCreate){failCreate=false;throw Error('lost_response');}
    return entry;
   }
   if(init?.method==='PATCH'){const p=permissions.find(p=>url.pathname.endsWith('/'+p.id));Object.assign(p,body);return p;}
   return {permissions:structuredClone(permissions)};
  },
  async request(raw,init){
   const url=new URL(raw);assert.equal(url.pathname.split('/')[4],docId);
   assert.equal(init.method,'DELETE');
   if(failDelete){failDelete=false;throw Error('retry_revoke');}
   const i=permissions.findIndex(p=>url.pathname.endsWith('/'+p.id));
   if(i>=0){writes.push({method:'DELETE',path:url.pathname});permissions.splice(i,1);}
   return new Response(null,{status:i<0?404:204});
  },
 };
 handle().prepare("INSERT INTO google_identities(subject,scope_kind,scope_id,email,created_at) VALUES (?,'account',?,?,?)").run(`parent-${serial}`,account.id,parent,new Date().toISOString());
 const acl=homeworkDeliveryPermissions(api);
 const sync=()=>H.syncHomeworkShares({sheet,api:{...acl,async place(t){assert.equal(t.docId,docId);await placeHomeworkDoc(api,t.docId,t.reviewFolderId,target);return target;}}});
 const approve=()=>{Object.assign(material,{review_status:'approved',publication_status:'published',release_id:'rel-1'});assignment.status='assigned';};
 const edit=(text,email)=>{const grant=permissions.find(p=>p.type==='anyone'||p.emailAddress===email);if(!['writer','owner'].includes(grant?.role))return false;value=text;return true;};
 return {student,account,material,assignment,permissions,writes,file,api,approve,sync,edit,get value(){return value;},unlinkAccount(){handle().prepare('DELETE FROM google_identities WHERE subject=?').run(`google-${serial}`);},linkAccount(){handle().prepare("INSERT INTO google_identities(subject,scope_kind,scope_id,email,created_at) VALUES (?,'student',?,?,?)").run(`google-${serial}`,student.id,writer,new Date().toISOString());},conflictingFolders(){differentFolders=true;},failCreate(){failCreate=true;},failDelete(){failDelete=true;}};
}

test('an approved anonymous editor can edit through the exact unlisted file grant until withdrawal',async()=>{
 const f=fixture();
 assert.equal((await f.sync()).shared,0);
 assert.equal(f.writes.length,0);
 assert.equal(f.edit('signed out'),false);
 f.approve();
 assert.equal((await f.sync()).shared,1);
 assert.deepEqual(f.file.parents,[target]);
 assert.equal(f.file.writersCanShare,false);
 assert.deepEqual(f.writes.find(w=>w.method==='POST').body,{type:'anyone',role:'writer',allowFileDiscovery:false});
 assert.ok(f.writes.every(w=>w.path.split('/')[4]===docId));
 assert.equal(f.edit('signed out'),true);
 assert.equal(f.value,'signed out');
 const student={identity:{kind:'student',id:f.student.id},students:[f.student],isSelf:false};
 const parentPreview={...student,identity:{kind:'account',id:f.account.id}};
 assert.equal(H.studentHomeworkLinks(student,f.student.id)[0].forwardable,true);
 assert.equal(new URL(H.studentHomeworkLinks(student,f.student.id)[0].url).searchParams.get('resourcekey'),'fixture-key');
 assert.deepEqual(H.studentHomeworkLinks(parentPreview,f.student.id),[]);
 await assert.rejects(verifyFeedbackFile(f.api,docId,target,owner),/privacy/);
 const writes=f.writes.length;
 assert.equal((await f.sync()).shared,0);
 assert.equal(f.writes.length,writes);
 f.assignment.status='cancelled';
 f.failDelete();
 assert.equal((await f.sync()).failed,1);
 assert.deepEqual(H.studentHomeworkLinks(student,f.student.id),[]);
 assert.equal((await f.sync()).revoked,1);
 assert.equal(f.edit('signed out again'),false);
 assert.ok(f.permissions.some(p=>p.id==='tutor'&&p.role==='writer'));
});

test('lost grant response is reconciled and linking Google replaces public access with distinct named roles',async()=>{
 const f=fixture();f.approve();f.failCreate();
 assert.equal((await f.sync()).failed,1);
 assert.equal((await f.sync()).failed,0);
 assert.equal(f.writes.filter(w=>w.method==='POST').length,1);
 f.linkAccount();
 f.failDelete();
 assert.equal((await f.sync()).failed,1);
 assert.ok(!f.permissions.some(p=>[writer,parent].includes(p.emailAddress)));
 assert.equal((await f.sync()).failed,0);
 assert.deepEqual(f.permissions.filter(p=>[writer,parent].includes(p.emailAddress)).map(p=>[p.emailAddress,p.role]),[[writer,'writer'],[parent,'reader']]);
 assert.equal(f.edit('anonymous'),false);
 assert.equal(f.edit('parent edit',parent),false);
 assert.equal(f.edit('student edit',writer),true);
 assert.ok(!f.permissions.some(p=>p.type==='anyone'));
 const writes=f.writes.length;
 await f.sync();
 assert.equal(f.writes.length,writes);
 f.material.publication_status='retired';
 assert.equal((await f.sync()).revoked,2);
 assert.deepEqual(f.permissions.map(p=>p.id),['owner','tutor']);
});

test('a valid URL on a different file, booking, or student never grants access',async()=>{
 const f=fixture();f.approve();
 const url=f.material.url,student=f.material.student_id,lesson=f.assignment.lesson_id;
 f.material.url='https://docs.google.com/document/d/anotherPrivateDoc/edit';
 assert.equal((await f.sync()).shared,0);
 f.material.url=url;f.assignment.lesson_id='booking-99999';
 assert.equal((await f.sync()).shared,0);
 f.assignment.lesson_id=lesson;f.material.student_id='student-99999';
 assert.equal((await f.sync()).shared,0);
 f.material.student_id=student;f.material.content_sha256='b'.repeat(64);
 assert.equal((await f.sync()).shared,0);
 assert.deepEqual(f.writes,[]);
});


test('moving would change inherited operator access, so the file and permissions are left alone',async()=>{
 const f=fixture();f.approve();f.conflictingFolders();
 const result=await f.sync();
 assert.equal(result.failed,1);
 assert.match(result.problems[0],/homework_folder_access_conflict/);
 assert.deepEqual(f.file.parents,[review]);
 assert.deepEqual(f.writes,[]);
});

test('an untracked anyone grant is reported and never repurposed by the worker',async()=>{
 const f=fixture();f.approve();
 f.permissions.push({id:'unknown-link',type:'anyone',role:'reader',allowFileDiscovery:false});
 const result=await f.sync();
 assert.equal(result.failed,1);
 assert.match(result.problems[0],/privacy/);
 assert.deepEqual(f.writes,[]);
});


test('unlinking the student removes both named grants before granting unlisted writer access',async()=>{
 const f=fixture();f.approve();f.linkAccount();
 assert.equal((await f.sync()).shared,2);
 assert.ok(!f.permissions.some(p=>p.type==='anyone'));
 f.unlinkAccount();
 const result=await f.sync();
 assert.equal(result.revoked,2);assert.equal(result.shared,1);
 assert.ok(!f.permissions.some(p=>[writer,parent].includes(p.emailAddress)));
 assert.equal(f.edit('signed out'),true);
});
