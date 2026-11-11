import {accessToken} from '../../../server/drive/client.mjs';
import {decodeWorkspace,workspaceCounts,workspaceTables,type WorkspaceCell} from '../learning/workspace.ts';

export interface LearningWorkspaceConfig {version:1;ownerEmail:string;projectFolderId:string;learningFolderId:string;spreadsheetId:string}
interface Credentials {clientId:string;clientSecret:string;refreshToken:string}
/** Keep the existing business-account backup/sync connection entirely separate. */
export function learningWorkspaceCredentials(env:Record<string,string|undefined>=process.env):Credentials {
 const c={clientId:env.LEARNING_GOOGLE_CLIENT_ID,clientSecret:env.LEARNING_GOOGLE_CLIENT_SECRET,refreshToken:env.LEARNING_GOOGLE_REFRESH_TOKEN};
 if(!c.clientId||!c.clientSecret||!c.refreshToken)throw Error('personal learning workspace not connected; dedicated LEARNING_GOOGLE credentials required');
 return c as Credentials;
}
export function workspaceClient(options:{config:LearningWorkspaceConfig;credentials?:Credentials;fetch?:typeof fetch}){
 const {config}=options,fetchImpl=options.fetch??fetch;
 if(config?.version!==1||!config.ownerEmail||!['projectFolderId','learningFolderId','spreadsheetId'].every(k=>/^[\w-]{10,}$/.test(String(config[k as keyof LearningWorkspaceConfig]))))throw Error('invalid private learning workspace configuration');
 const credentials=options.credentials??learningWorkspaceCredentials();
 let token:string|undefined;
 async function get(url:URL|string):Promise<any>{
  if(!token){token=await accessToken(credentials,(input,init)=>fetchImpl(input,{...init,signal:AbortSignal.timeout(20000)}));if(typeof token!=='string'||!token)throw Error('personal workspace authorization returned no access token');}
  const response=await fetchImpl(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error(`learning workspace API read failed (${response.status}); check personal authorization and enabled APIs`);
  const body=await response.text();if(body.length>2*1024*1024)throw Error('learning workspace read exceeded 2 MB limit');
  try{return JSON.parse(body);}catch{throw Error('learning workspace API returned invalid JSON');}
 }
 function endpoint(base:string,params:Record<string,string>){const u=new URL(base);for(const[k,v]of Object.entries(params))u.searchParams.set(k,v);return u;}
 async function file(id:string,kind:string,parent?:string){
  const data=await get(endpoint(`https://www.googleapis.com/drive/v3/files/${id}`,{fields:'id,mimeType,parents,owners(emailAddress),trashed'}));
  if(data.id!==id||data.mimeType!==kind||data.trashed)throw Error('learning workspace file identity/type mismatch');
  if(!Array.isArray(data.owners)||!data.owners.some((o:{emailAddress?:string})=>o.emailAddress?.toLowerCase()===config.ownerEmail.toLowerCase()))throw Error('learning workspace file owner mismatch');
  if(parent&&(!Array.isArray(data.parents)||!data.parents.includes(parent)))throw Error('learning workspace parent folder mismatch');
 }
 async function readSnapshot(){
  // This reader is a short-lived job/CLI object, not an indefinitely cached token singleton.
  token=undefined;
  const account=await get('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)');
  if(account.user?.emailAddress?.toLowerCase()!==config.ownerEmail.toLowerCase())throw Error('personal learning workspace OAuth owner mismatch');
  await file(config.projectFolderId,'application/vnd.google-apps.folder');
  await file(config.learningFolderId,'application/vnd.google-apps.folder',config.projectFolderId);
  await file(config.spreadsheetId,'application/vnd.google-apps.spreadsheet',config.learningFolderId);
  const metadata=await get(endpoint(`https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}`,{fields:'spreadsheetId,properties(title,locale,timeZone),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))'}));
  if(metadata.spreadsheetId!==config.spreadsheetId||!Array.isArray(metadata.sheets))throw Error('learning register metadata is incomplete');
  const names=[...Object.keys(workspaceTables),'Config'],ranges:string[]=[];
  for(const name of names){
   const sheets=metadata.sheets.filter((s:{properties?:{title?:string}})=>s.properties?.title===name);
   if(sheets.length!==1)throw Error(`learning register missing or duplicate tab: ${name}`);
   const grid=sheets[0].properties.gridProperties,rows=grid?.rowCount,cols=grid?.columnCount;
   if(!Number.isInteger(rows)||rows<2||rows>5001||!Number.isInteger(cols)||cols<1||cols>64)throw Error(`${name}: worksheet dimensions exceed safe read limit or are incomplete`);
   let column='',n=cols;while(n){n--;column=String.fromCharCode(65+n%26)+column;n=Math.floor(n/26);}
   ranges.push(`'${name}'!A1:${column}${rows}`);
  }
  const url=endpoint(`https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values:batchGet`,{valueRenderOption:'UNFORMATTED_VALUE',dateTimeRenderOption:'FORMATTED_STRING'});for(const range of ranges)url.searchParams.append('ranges',range);
  const data=await get(url);if(!Array.isArray(data.valueRanges)||data.valueRanges.length!==names.length)throw Error('learning register read is incomplete');
  const grids:Record<string,WorkspaceCell[][]>={};
  for(const entry of data.valueRanges){
   const match=String(entry.range??'').match(/^'?([A-Za-z]+)'?!A1:/),name=match?.[1];
   if(!name||!names.includes(name)||grids[name]||!Array.isArray(entry.values)||!entry.values.every((row:unknown)=>Array.isArray(row)))throw Error('learning register ranges are incomplete or ambiguous');
   grids[name]=entry.values;
  }
  if(names.some(n=>!grids[n]))throw Error('learning register read is incomplete');
  const settings:Record<string,string>={},headers=grids.Config[0].map(v=>String(v??'').match(/\[([a-z_]+)\]$/)?.[1]??String(v??'').trim());
  if(headers.filter(v=>v==='key').length!==1||headers.filter(v=>v==='value').length!==1)throw Error('Config: missing or duplicate keys/values column');
  for(const row of grids.Config.slice(1)){const key=String(row[headers.indexOf('key')]??'').trim();if(!key)continue;if(Object.hasOwn(settings,key))throw Error(`Config: duplicate setting ${key}`);settings[key]=String(row[headers.indexOf('value')]??'').trim();}
  for(const[key,value]of Object.entries({schema_version:'1',owner_email:config.ownerEmail,project_folder_id:config.projectFolderId,learning_folder_id:config.learningFolderId,spreadsheet_id:config.spreadsheetId}))if(settings[key]!==value)throw Error(`Config.${key}: workspace identity/version mismatch`);
  return decodeWorkspace(grids,1);
 }
 return {readSnapshot,async status(){const snapshot=await readSnapshot();return{schemaVersion:1,ownerVerified:true,readOnly:true,automaticPublishing:false,realRecords:workspaceCounts(snapshot),demoRecords:Object.fromEntries(Object.keys(workspaceTables).map(n=>[n,snapshot[n as keyof Omit<typeof snapshot,'version'>].filter(r=>r.is_demo).length]))};}};
}
