import {createHash} from 'node:crypto';
import {workspaceTables,workspaceHeader,workspaceProblems,type WorkspaceSnapshot,type WorkspaceRow} from '../../learning/workspace.ts';
import type {NativeLessonJob} from './jobs.ts';

interface Receipt {sourceHash:string;slides:{url:string};notesLocation?:'slides';tutorNotes?:{url:string};homework:{url:string};activities:{id:string;title:string;url:string}[];provenance?:{bundleVersion:string;sourceIds:string[]}}
interface Api {scope:string;json:(url:string,init?:RequestInit)=>Promise<any>}
const roles=['Students','Lessons','Materials','Assignments'] as const;
export function nativeDraftRecords(job:NativeLessonJob,receipt:Receipt,studentName:string):WorkspaceSnapshot {
 const studentId=`student-${job.studentId}`,lessonId=`booking-${job.bookingId}`,prefix=`native-${job.id}`,demo=false;
 const material=(suffix:string,title:string,kind:string,provider:string,url:string,audience:string):WorkspaceRow=>({material_id:`${prefix}-${suffix}`,title,kind,provider,url,review_status:'review',publication_status:'draft',audience,student_id:studentId,topic:`התפלגות נורמלית · 35372 · מקור: ${receipt.provenance?.sourceIds.join(', ')??'moe-2025a-35372-3'}`,education_level:'תיכון · 3 יחידות',release_id:'',content_sha256:receipt.sourceHash,is_demo:demo});
 const materials=[material('slides',receipt.notesLocation==='slides'?'מצגת למורה — הערות ופתרונות':'מצגת — טיוטה לבדיקה','presentation','google_slides',receipt.slides.url,receipt.notesLocation==='slides'?'staff':'student'),...(receipt.tutorNotes?[material('notes','הערות ופתרונות למורה','lesson_brief','google_docs',receipt.tutorNotes.url,'staff')]:[]),material('homework','תרגול לבית — טיוטה','homework','google_docs',receipt.homework.url,'student'),...receipt.activities.map(a=>material(`game-${createHash('sha256').update(a.id).digest('hex').slice(0,12)}`,a.title,'game','website',a.url,'staff'))];
 const snapshot:WorkspaceSnapshot={version:1,Students:[{student_id:studentId,display_name:studentName,subject:job.snapshot.subject??'מתמטיקה',education_level:'תיכון',track:'3',goals:'הכנת שיעור — ללא טענת שליטה',profile_url:'',folder_url:'',status:'active',is_demo:demo}],Lessons:[{lesson_id:lessonId,student_id:studentId,date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(job.snapshot.start)),goals:'התפלגות נורמלית · שאלון 35372 · 90 דקות',status:'planned',tutor_note:'טיוטה פרטית; נדרשת בדיקת מורה לפני כל שימוש עם תלמיד/ה.',is_demo:demo}],Materials:materials,Assignments:materials.filter(m=>m.kind==='homework').map(m=>({assignment_id:`${prefix}-homework-assignment`,student_id:studentId,lesson_id:lessonId,material_id:m.material_id,due_date:'',status:'draft',is_demo:demo})),Progress:[]};
 snapshot.Lessons[0].tutor_note+=` מקור חבילה: ${receipt.provenance?.bundleVersion??receipt.sourceHash}; חבילת כיול שנבחרה במפורש, ללא התאמה אוטומטית או אישור הוראה.`;
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
  const header=workspaceTables[role].map(workspaceHeader);
  if(sheet){
   if(sheet.properties.title!==title)throw Error('conflict');
   const result=await api.json(`${base}/values/${encodeURIComponent(`'${title}'!A1:P5002`)}?valueRenderOption=UNFORMATTED_VALUE`);
   existing=result.values??[];
   if(!Array.isArray(existing)||JSON.stringify(existing[0])!==JSON.stringify(header)||existing.length>5001)throw Error('conflict');
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
