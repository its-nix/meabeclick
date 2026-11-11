import {test} from 'node:test';import assert from 'node:assert/strict';
import {workspaceFixture} from '../learning-workspace-fixture.mjs';
import {workspaceTables,workspaceHeader} from '../../src/lib/learning/workspace.ts';
const config={version:1,ownerEmail:'owner@example.com',projectFolderId:'project12345',learningFolderId:'learning12345',spreadsheetId:'spreadsheet12345'};
const credentials={clientId:'test-client',clientSecret:'test-secret',refreshToken:'test-refresh'};
function mock({owner='owner@example.com',rows=1000,missingRange=false,wrongParent=false,googleError=false,version='1',timeZone='Etc/UTC'}={}){
 const calls=[],fixture=workspaceFixture();const grids=Object.fromEntries(Object.entries(workspaceTables).map(([n,cols])=>[n,[cols.map(workspaceHeader),...fixture[n].map(r=>cols.map(c=>r[c.key]??''))]]));
 grids.Config=[['מפתח [key]','ערך [value]','הסבר [description]'],['schema_version',version,''],['owner_email',config.ownerEmail,''],['project_folder_id',config.projectFolderId,''],['learning_folder_id',config.learningFolderId,''],['spreadsheet_id',config.spreadsheetId,'']];
 const fetch=async(url,init={})=>{url=new URL(url);calls.push({url:String(url),method:init.method??'GET'});let out;
  if(url.hostname==='oauth2.googleapis.com')out={access_token:'test-access'};
  else if(googleError)return new Response('test-secret test-refresh',{status:403});
  else if(url.pathname.endsWith('/about'))out={user:{emailAddress:owner}};
  else if(url.hostname==='www.googleapis.com'){const id=url.pathname.split('/').at(-1);out={id,mimeType:id===config.spreadsheetId?'application/vnd.google-apps.spreadsheet':'application/vnd.google-apps.folder',parents:id===config.learningFolderId?[wrongParent?'other12345':config.projectFolderId]:id===config.spreadsheetId?[config.learningFolderId]:[],owners:[{emailAddress:owner}],trashed:false};}
  else if(url.pathname.endsWith('/values:batchGet')){out={valueRanges:url.searchParams.getAll('ranges').map(range=>({range,values:grids[range.split('!')[0].replaceAll("'",'')]}))};if(missingRange)out.valueRanges.pop();}
  else out={spreadsheetId:config.spreadsheetId,properties:{title:'Workspace',timeZone},sheets:Object.entries({...workspaceTables,Config:[]}).map(([title,cols],i)=>({properties:{sheetId:i+1,title,gridProperties:{rowCount:rows,columnCount:title==='Config'?3:cols.length}}}))};
  return Response.json(out);
 };return{fetch,calls};
}
test('personal workspace reads a bounded native register, checks ownership and issues no content writes',async()=>{
 const {workspaceClient}=await import('../../src/lib/server/learning-workspace.ts'),m=mock(),client=workspaceClient({config,credentials,fetch:m.fetch});const s=await client.readSnapshot();assert.equal(s.Students.length,1);assert.equal(s.Students[0].is_demo,true);assert.ok(m.calls.every(c=>c.method==='GET'||c.url.startsWith('https://oauth2.googleapis.com/')));const query=new URL(m.calls.find(c=>c.url.includes('values:batchGet')).url);assert.equal(query.searchParams.getAll('ranges').length,6);assert.ok(query.searchParams.getAll('ranges').every(r=>/!A1:[A-Z]+1000$/.test(r)));assert.ok(m.calls.some(c=>c.url.includes('about?')));
});
test('missing dedicated credentials never falls back to business Drive credentials',async()=>{
 const {learningWorkspaceCredentials}=await import('../../src/lib/server/learning-workspace.ts');assert.throws(()=>learningWorkspaceCredentials({GOOGLE_OAUTH_CLIENT_ID:'business',GOOGLE_OAUTH_CLIENT_SECRET:'business-secret',GOOGLE_OAUTH_REFRESH_TOKEN:'business-refresh'}),/personal.*not connected/);assert.deepEqual(learningWorkspaceCredentials({LEARNING_GOOGLE_CLIENT_ID:'a',LEARNING_GOOGLE_CLIENT_SECRET:'b',LEARNING_GOOGLE_REFRESH_TOKEN:'c'}),{clientId:'a',clientSecret:'b',refreshToken:'c'});
});
test('wrong account, parent, grants, schema or incomplete reads fail explicitly',async()=>{
 const {workspaceClient}=await import('../../src/lib/server/learning-workspace.ts');for(const [options,error]of [[{owner:'other@example.com'},/owner/],[{wrongParent:true},/parent/],[{googleError:true},/403/],[{rows:6000},/limit/],[{missingRange:true},/incomplete/],[{version:'2'},/version/]]){const m=mock(options);await assert.rejects(workspaceClient({config,credentials,fetch:m.fetch}).readSnapshot(),e=>error.test(e.message)&&!e.message.includes('test-secret')&&!e.message.includes('test-refresh'));}
});
test('status excludes demonstration records and reports the remaining personal-authorization boundary',async()=>{
 const {workspaceClient}=await import('../../src/lib/server/learning-workspace.ts'),m=mock(),s=await workspaceClient({config,credentials,fetch:m.fetch}).status();assert.equal(s.readOnly,true);assert.equal(s.ownerVerified,true);assert.equal(s.realRecords.Students,0);assert.equal(s.demoRecords.Students,1);assert.equal(s.automaticPublishing,false);
});
test('native timestamps reject workbook timezone drift instead of inventing UTC evidence',async()=>{
 const {workspaceClient}=await import('../../src/lib/server/learning-workspace.ts'),m=mock({timeZone:'Asia/Jerusalem'});await assert.rejects(workspaceClient({config,credentials,fetch:m.fetch}).readSnapshot(),/timezone.*UTC/);
});
