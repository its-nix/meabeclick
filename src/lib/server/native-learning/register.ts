import {createHash} from 'node:crypto';
import {workspaceTables,workspaceSiteColumns,workspaceHeader,workspaceProblems,type WorkspaceSnapshot,type WorkspaceRow} from '../../learning/workspace.ts';
import type {NativeLessonJob} from './jobs.ts';
import {exportGamesFile,gamesFileText} from './games.ts';
import type {VisualLesson} from '../../learning/deck/model.ts';
import type {CentralArtifact} from '../central-drive/source.ts';
import {centralFileUrl,type CentralFile} from '../central-drive/api.ts';

export interface GamesFileReceipt {id:string;url:string;sha256:string}
/** Writes the editable games JSON next to the review Slides/Docs (private folder; answers stay in it). Idempotent: the blob key includes the content hash. */
export async function writeNativeGamesFile(api:{blob:(a:CentralArtifact,parent:string)=>Promise<{file:CentralFile}>},folderId:string,bundle:VisualLesson,bookingId:number):Promise<GamesFileReceipt|null> {
 if(!bundle?.games?.length)return null;
 const buffer=Buffer.from(gamesFileText(exportGamesFile(bundle,`booking-${bookingId}`)),'utf8');
 const sha256=createHash('sha256').update(buffer).digest('hex'),md5=createHash('md5').update(buffer).digest('hex');
 const artifact:CentralArtifact={key:`native-games:${bookingId}:${sha256}`,name:`משחקים — שיעור ${bookingId}.json`,folders:[],mimeType:'application/json',sha256,md5,size:buffer.length,role:'game',lesson:null,version:null,read:async(offset=0,length=buffer.length)=>buffer.subarray(offset,offset+length)} as CentralArtifact;
 const {file}=await api.blob(artifact,folderId);
 return {id:file.id,url:centralFileUrl(file),sha256};
}

interface Receipt {sourceHash:string;slides:{url:string};notesLocation?:'slides';tutorNotes?:{url:string};homework:{url:string};activities:{id:string;title:string;url:string}[];provenance?:{kind?:string;bundleVersion:string;sourceIds:string[]}}
interface Api {scope:string;json:(url:string,init?:RequestInit)=>Promise<any>}
/** Recheck sealed native files before linking them, including after a registration retry. */
export async function validateNativeDraftFiles(api:Api&{privateFolder:(id:string,parent:string)=>Promise<unknown>},workspace:{workspaceId:string;reviewId:string},receipt:{reviewFolderId:string;slides:{id:string};homework:{id:string};tutorNotes?:{id:string}},config:{learningFolderId:string;ownerEmail:string},homeworkParent?:string){
 await api.privateFolder(workspace.workspaceId,config.learningFolderId);
 await api.privateFolder(workspace.reviewId,workspace.workspaceId);
 await api.privateFolder(receipt.reviewFolderId,workspace.reviewId);
 const items=[{id:receipt.slides.id,type:'application/vnd.google-apps.presentation'},{id:receipt.homework.id,type:'application/vnd.google-apps.document'},...(receipt.tutorNotes?[{id:receipt.tutorNotes.id,type:'application/vnd.google-apps.document'}]:[])];
 for(const item of items){
  if(!/^[A-Za-z0-9_-]{10,200}$/.test(item.id))throw Error('conflict');
  const file=await api.json(`https://www.googleapis.com/drive/v3/files/${item.id}?fields=id,mimeType,parents,owners(emailAddress),permissions(type),trashed,appProperties`);
  const parent=file.parents?.length===1?file.parents[0]:null;
  const expectedParent=parent===receipt.reviewFolderId||
    item.type==='application/vnd.google-apps.document'&&item.id===receipt.homework.id&&parent===homeworkParent;
  if(file.id!==item.id||file.mimeType!==item.type||file.trashed||!expectedParent||file.appProperties?.meaCentralScope!==api.scope)throw Error('conflict');
  if(!file.owners?.some((o:{emailAddress?:string})=>o.emailAddress?.toLowerCase()===config.ownerEmail.toLowerCase()))throw Error('ownership');
  if(!Array.isArray(file.permissions)||file.permissions.some((p:{type?:string})=>!['user','group'].includes(p.type??'')))throw Error('privacy');
 }
}
const UNSPECIFIED='לא צוין';
const roles=['Students','Lessons','Materials','Assignments'] as const;
export function nativeDraftRecords(job:NativeLessonJob,receipt:Receipt,studentName:string,studentLinks?:{profileUrl:string;folderUrl:string},gamesFile?:GamesFileReceipt|null):WorkspaceSnapshot {
 const studentId=`student-${job.studentId}`,lessonId=`booking-${job.bookingId}`,prefix=`native-${job.id}`,demo=false;
 const material=(suffix:string,title:string,kind:string,provider:string,url:string,audience:string):WorkspaceRow=>({material_id:`${prefix}-${suffix}`,title,kind,provider,url,review_status:'review',publication_status:'draft',audience,student_id:studentId,topic:`${(job.snapshot.brief?.topic??job.snapshot.subject??UNSPECIFIED).slice(0,160)}${receipt.provenance?.sourceIds.length?` · מקור: ${receipt.provenance.sourceIds.join(', ')}`:''}`,education_level:job.snapshot.level??UNSPECIFIED,release_id:'',content_sha256:receipt.sourceHash,is_demo:demo});
 const materials=[...(gamesFile?[{...material('games-file','משחקי תרגול — קובץ לאישור','game','google_drive',gamesFile.url,'student'),content_sha256:gamesFile.sha256}]:[]),material('slides',receipt.notesLocation==='slides'?'מצגת למורה — הערות ופתרונות':'מצגת — טיוטה לבדיקה','presentation','google_slides',receipt.slides.url,receipt.notesLocation==='slides'?'staff':'student'),...(receipt.tutorNotes?[material('notes','הערות ופתרונות למורה','lesson_brief','google_docs',receipt.tutorNotes.url,'staff')]:[]),material('homework','תרגול לבית — טיוטה','homework','google_docs',receipt.homework.url,'student'),...receipt.activities.map(a=>material(`game-${createHash('sha256').update(a.id).digest('hex').slice(0,12)}`,a.title,'game','website',a.url,'staff'))];
 const snapshot:WorkspaceSnapshot={version:1,Students:[{student_id:studentId,display_name:studentName,subject:job.snapshot.subject??UNSPECIFIED,education_level:job.snapshot.level??UNSPECIFIED,track:'',goals:'הכנת שיעור — ללא טענת שליטה',profile_url:studentLinks?.profileUrl??'',folder_url:studentLinks?.folderUrl??'',status:'active',is_demo:demo}],Lessons:[{lesson_id:lessonId,student_id:studentId,date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(job.snapshot.start)),goals:job.snapshot.brief?.request??`${job.snapshot.subject??UNSPECIFIED} · ${job.snapshot.durationMin??''} דקות`,status:'planned',tutor_note:'טיוטה פרטית; נדרשת בדיקת מורה לפני כל שימוש עם תלמיד/ה.',is_demo:demo}],Materials:materials,Assignments:materials.filter(m=>m.kind==='homework'||m.material_id===`${prefix}-games-file`).map(m=>({assignment_id:`${prefix}-${m.kind==='game'?'games':'homework'}-assignment`,student_id:studentId,lesson_id:lessonId,material_id:m.material_id,due_date:'',status:'draft',is_demo:demo})),Progress:[]};
 if(job.snapshot.brief?.priorKnowledge)snapshot.Lessons[0].tutor_note+=` ידע קודם — דיווח מורה: ${job.snapshot.brief.priorKnowledge}.`;
 snapshot.Lessons[0].tutor_note+=` מקור חבילה: ${receipt.provenance?.bundleVersion??receipt.sourceHash}; טיוטה חדשה לפי בקשת המורה; טרם אושרה להוראה.`;
 const problems=workspaceProblems(snapshot);if(problems.length)throw Error('native_register_schema');return snapshot;
}
/** Append missing stable IDs only. Existing rows (including tutor edits) are untouched. */
export async function appendNativeDraftRecords(api:Api,indexId:string,records:WorkspaceSnapshot) {
 if(!/^[\w-]{10,}$/.test(indexId)||workspaceProblems(records).length)throw Error('native_register_schema');
 const base=`https://sheets.googleapis.com/v4/spreadsheets/${indexId}`;
 const meta=await api.json(`${base}?fields=sheets(properties,developerMetadata)`);
 if(!Array.isArray(meta.sheets))throw Error('google_response');
 const used=new Set(meta.sheets.map((s:any)=>s.properties?.sheetId)),requests:object[]=[];
 let next=1;
 for(const role of roles){
  const title=`Native ${role}`,marker=`${api.scope}:native-v1:${role}`;
  const owned=meta.sheets.filter((s:any)=>s.developerMetadata?.some((m:any)=>m.metadataKey==='meaNativeRecords'&&m.metadataValue===marker));
  if(owned.length>1)throw Error('conflict');
  let sheet=owned[0],existing:unknown[][]=[];
  const columns=workspaceTables[role].map(workspaceHeader),site=(workspaceSiteColumns[role]??[]).map(workspaceHeader),header=[...columns,...site];
  if(sheet){
   if(sheet.properties.title!==title)throw Error('conflict');
   const result=await api.json(`${base}/values/${encodeURIComponent(`'${title}'!A1:P5002`)}?valueRenderOption=UNFORMATTED_VALUE`);
   existing=result.values??[];
   const lacksSite=site.length>0&&JSON.stringify(existing?.[0])===JSON.stringify(columns);
   if(!Array.isArray(existing)||existing.length>5001||JSON.stringify(existing[0])!==JSON.stringify(header)&&!lacksSite)throw Error('conflict');
   if(lacksSite){
    // Add the site-owned header only into a column nobody has written to.
    if(existing.some(r=>!Array.isArray(r)||r.length>columns.length))throw Error('conflict');
    if((sheet.properties.gridProperties?.columnCount??0)<header.length)requests.push({appendDimension:{sheetId:sheet.properties.sheetId,dimension:'COLUMNS',length:header.length-(sheet.properties.gridProperties?.columnCount??columns.length)}});
    requests.push({updateCells:{start:{sheetId:sheet.properties.sheetId,rowIndex:0,columnIndex:columns.length},rows:[{values:site.map(v=>({userEnteredValue:{stringValue:v}}))}],fields:'userEnteredValue'}});
   }
  }else{
   if(meta.sheets.some((s:any)=>s.properties?.title===title))throw Error('conflict');
   while(used.has(next))next++;used.add(next);
   sheet={properties:{sheetId:next,title}};
   requests.push({addSheet:{properties:{...sheet.properties,rightToLeft:true,gridProperties:{rowCount:5001,columnCount:header.length,frozenRowCount:1}}}},{createDeveloperMetadata:{developerMetadata:{metadataKey:'meaNativeRecords',metadataValue:marker,visibility:'DOCUMENT',location:{sheetId:next}}}});
  }
  const ids=existing.slice(1).map(r=>String(r[0]??''));if(new Set(ids).size!==ids.length)throw Error('conflict');
  const identity=role==='Materials'?['student_id','url','content_sha256']:role==='Assignments'?['student_id','lesson_id','material_id']:role==='Lessons'?['student_id']:[];
  for(const record of records[role]){
   const at=ids.indexOf(String(record[workspaceTables[role][0].key]));if(at<0)continue;
   for(const key of identity){const column=workspaceTables[role].findIndex(c=>c.key===key);if(String(existing[at+1][column]??'')!==String(record[key]??''))throw Error('conflict');}
  }
  const missing=records[role].filter(r=>!ids.includes(String(r[workspaceTables[role][0].key])));
  if(existing.length+missing.length>5001)throw Error('source_limit');
  const rows=[...(!existing.length?[header]:[]),...missing.map(row=>workspaceTables[role].map(c=>row[c.key]??''))];
  if(rows.length)requests.push({appendCells:{sheetId:sheet.properties.sheetId,rows:rows.map(row=>({values:row.map(v=>({userEnteredValue:typeof v==='boolean'?{boolValue:v}:{stringValue:String(v)}}))})),fields:'userEnteredValue'}});
 }
 if(requests.length)await api.json(`${base}:batchUpdate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requests})});
}
