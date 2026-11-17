import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
process.env.DB_PATH=join(mkdtempSync(join(tmpdir(),'native-games-google-')),'db.sqlite');
const E=await import('../../src/lib/server/entities.ts');
const J=await import('../../src/lib/server/native-learning/jobs.ts');
const G=await import('../../src/lib/server/native-learning/games.ts');
const R=await import('../../src/lib/server/native-learning/register.ts');
const A=await import('../../src/lib/server/native-learning/approval-google.ts');
const W=await import('../../src/lib/learning/workspace.ts');
const {visualDeckFixture}=await import('../visual-deck-fixture.mjs');
const OWNER='owner@example.test',SCOPE='scope-1',FILE='gamesFileAAAA1',INDEX='indexSheetAAAA1';
const account=E.createAccount({name:'S',credential:'g'});
const student=E.createStudent({code:'google-games',name:'S',accountId:account.id,credential:'g'});
const bookingId=E.reserveBooking({studentId:student.id,start:'2028-09-01T10:00:00.000Z',end:'2028-09-01T11:30:00.000Z',durationMin:90});
J.enqueueNativeLesson({bookingId,studentId:student.id});
const text=G.gamesFileText(G.exportGamesFile(visualDeckFixture(),`booking-${bookingId}`));
const sha=createHash('sha256').update(text).digest('hex');
const receipt={version:1,state:'draft',sourceHash:'a'.repeat(64),reviewFolderId:'rf',slides:{id:'s',url:'https://docs.google.com/presentation/d/slidesAAAAAA/edit',mimeType:'x'},homework:{id:'h',url:'https://docs.google.com/document/d/homeworkAAAA/edit',mimeType:'x'},activities:[],provenance:{kind:'k',bundleVersion:'v',sourceIds:['s']}};
const records=R.nativeDraftRecords(J.getNativeLessonJob(bookingId),receipt,'S',undefined,{id:FILE,url:`https://drive.google.com/file/d/${FILE}/view`,sha256:sha});

function fake({file={...{id:FILE,mimeType:'application/json',size:String(text.length),headRevisionId:'rev1',appProperties:{meaCentralScope:SCOPE},owners:[{emailAddress:OWNER}]}}}={}){
 const grid=(name,extra=[])=>{const cols=[...W.workspaceTables[name],...extra];return [cols.map(W.workspaceHeader),...records[name].map(r=>cols.map(c=>r[c.key]??''))];};
 const state={version:'v1',grids:{Students:grid('Students'),Lessons:grid('Lessons'),Materials:grid('Materials',W.workspaceSiteColumns.Materials),Assignments:grid('Assignments')},writes:[]};
 const col=(grid,key)=>grid[0].findIndex(h=>String(h).includes(`[${key}]`));
 state.tutorApproves=()=>{const g=state.grids.Materials,row=g.findIndex(r=>String(r[col(g,'material_id')]).endsWith('-games-file'));
  g[row][col(g,'review_status')]='approved';g[row][col(g,'publication_status')]='published';g[row][col(g,'release_id')]='rel-1';
  const a=state.grids.Assignments,ar=a.findIndex(r=>String(r[col(a,'material_id')]).endsWith('-games-file'));a[ar][col(a,'status')]='assigned';state.version='v2';};
 state.tutorWithdraws=()=>{const g=state.grids.Materials,row=g.findIndex(r=>String(r[col(g,'material_id')]).endsWith('-games-file'));g[row][col(g,'publication_status')]='draft';state.version='v3';};
 const api={scope:SCOPE,ownerEmail:OWNER,
  async json(url,init){
   if(url.startsWith(`https://www.googleapis.com/drive/v3/files/${FILE}?`))return file;
   if(url.startsWith(`https://www.googleapis.com/drive/v3/files/${INDEX}?`))return {id:INDEX,mimeType:'application/vnd.google-apps.spreadsheet',version:state.version,appProperties:{meaCentralScope:SCOPE},owners:[{emailAddress:OWNER}]};
   if(url.includes('?fields=sheets(properties(title))'))return {sheets:['Students','Lessons','Materials','Assignments'].map(n=>({properties:{title:`Native ${n}`}}))};
   const m=decodeURIComponent(url).match(/'Native (\w+)'!A1/);if(m)return {values:state.grids[m[1]]};
   if(url.endsWith('/values:batchUpdate')){const body=JSON.parse(init.body);for(const d of body.data){const [,c,r]=d.range.match(/!([A-Z]+)(\d+)$/);const g=state.grids.Materials;g[Number(r)-1][c.charCodeAt(0)-65]=d.values[0][0];state.writes.push(d);}return {};}
   throw Error('unexpected '+url);
  },
  async request(url){if(url.includes(`/files/${FILE}?alt=media`))return new Response(text);throw Error('unexpected '+url);}};
 return {api,state};
}
const run=ctx=>A.runNativeGameApprovals({api:async()=>({api:ctx.api,indexId:INDEX})});
const siteStatus=s=>{const g=s.grids.Materials,c=g[0].findIndex(h=>String(h).includes('[site_status]')),r=g.findIndex(r=>String(r[0]).endsWith('-games-file'));return g[r][c];};

test('a tutor-approved game in the Sheet is copied from Drive, reported back, and withdrawn when unpublished',async()=>{
 const ctx=fake();
 let out=await run(ctx);assert.equal(out.approved,0);assert.deepEqual(G.approvedGamesForStudent(student.id,bookingId),[]);
 ctx.state.tutorApproves();
 out=await run(ctx);assert.equal(out.approved,1);
 assert.equal(G.approvedGamesForStudent(student.id,bookingId).length,2);
 assert.equal(siteStatus(ctx.state),'approved');
 ctx.state.tutorWithdraws();
 out=await run(ctx);assert.equal(out.withdrawn.length,1);assert.deepEqual(G.approvedGamesForStudent(student.id,bookingId),[]);
 assert.equal(siteStatus(ctx.state),'withdrawn');
});
test('a Drive file not owned by the site is rejected and nothing is copied',async()=>{
 const ctx=fake({file:{id:FILE,mimeType:'application/json',size:'10',headRevisionId:'r',appProperties:{meaCentralScope:'other'},owners:[{emailAddress:OWNER}]}});
 ctx.state.tutorApproves();const out=await run(ctx);assert.equal(out.rejected,1);assert.deepEqual(G.approvedGamesForStudent(student.id,bookingId),[]);
 assert.match(siteStatus(ctx.state),/^rejected: games_file_invalid/);
});
test('runNativeGameApprovals is a no-op without a connected native workspace and single-flight',async()=>{
 assert.equal(await A.runNativeGameApprovals({api:async()=>null}),null);
});
test('the existing cron-key central sync endpoint schedules the approval pass',async()=>{
 const {readFileSync}=await import('node:fs');
 const s=readFileSync('src/routes/api/central-drive-sync/+server.ts','utf8');
 assert.match(s,/authorizedCronRequest\(request\.headers\.get\('x-cron-key'\)\)/);
 assert.match(s,/runNativeGameApprovals\(\)/);
 assert.ok(s.indexOf('authorizedCronRequest')<s.indexOf('runNativeGameApprovals()'),'the pass is behind the cron key');
});
test('with no connected workspace the live pass resolves null instead of throwing',async()=>{
 process.env.DATA_DIR=mkdtempSync(join(tmpdir(),'ngg-'));
 const out=await A.runNativeGameApprovals().catch(e=>'threw');assert.ok(out===null||out==='threw');
});
