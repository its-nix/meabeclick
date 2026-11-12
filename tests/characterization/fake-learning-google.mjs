/** Test preload only; production has no fake-provider switch. */
import {readFileSync} from 'node:fs';
import {workspaceFixture} from '../learning-workspace-fixture.mjs';
import {workspaceTables,workspaceHeader} from '../../src/lib/learning/workspace.ts';
import {learningFiles} from '../../src/lib/server/learning-google.ts';

export function fakeLearningGoogle(url,init){
 if(process.env.LEARNING_GOOGLE_CLIENT_ID!=='synthetic-learning-client')return null;
 const workspace=JSON.parse(readFileSync(process.env.LEARNING_GOOGLE_WORKSPACE_FILE,'utf8'));
 if(url.hostname==='oauth2.googleapis.com'&&url.pathname==='/token'){
  const form=new URLSearchParams(String(init.body??''));
  if(form.get('client_id')!=='synthetic-learning-client')return null;
  return {access_token:'fake-learning-access',refresh_token:'fake-learning-refresh',scope:'https://www.googleapis.com/auth/drive.file'};
 }
 if(url.pathname==='/drive/v3/about')return {user:{emailAddress:workspace.ownerEmail}};
 if(url.pathname.startsWith('/drive/v3/files/')){
  const file=learningFiles(workspace).find(f=>f.id===url.pathname.split('/').at(-1));
  return file?{id:file.id,mimeType:file.type,parents:file.parent?[file.parent]:[],owners:[{emailAddress:workspace.ownerEmail}],trashed:false}:null;
 }
 if(url.hostname!=='sheets.googleapis.com')return null;
 if(url.pathname.endsWith('/values:batchGet')){
  const fixture=workspaceFixture(),grids=Object.fromEntries(Object.entries(workspaceTables).map(([name,cols])=>[name,[cols.map(workspaceHeader),...fixture[name].map(row=>cols.map(col=>row[col.key]??''))]]));
  grids.Config=[['key','value'],['schema_version','1'],['owner_email',workspace.ownerEmail],['project_folder_id',workspace.projectFolderId],['learning_folder_id',workspace.learningFolderId],['spreadsheet_id',workspace.spreadsheetId]];
  return {valueRanges:url.searchParams.getAll('ranges').map(range=>({range,values:grids[range.split('!')[0].replaceAll("'",'')]}))};
 }
 return {spreadsheetId:workspace.spreadsheetId,properties:{timeZone:'Etc/UTC'},sheets:Object.entries({...workspaceTables,Config:[]}).map(([title,cols],index)=>({properties:{sheetId:index+1,title,gridProperties:{rowCount:100,columnCount:title==='Config'?2:cols.length}}}))};
}
