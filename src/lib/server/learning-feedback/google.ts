/** Narrow Google boundary for private, human-reviewed learning corrections. */
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile,chmod,readdir} from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import sharp from 'sharp';

export interface FeedbackGoogleApi {scope:string;json:(url:string,init?:RequestInit)=>Promise<any>;privateFolder:(id:string,parent:string)=>Promise<unknown>;request?:(url:string,init?:RequestInit,allowed?:number[])=>Promise<Response>}
export interface FeedbackReply {id:string;content:string;author?:string;deleted:boolean;agent:boolean}
export interface FeedbackGoogleComment {id:string;content:string;quotedText?:string;location?:string;author?:string;resolved:boolean;deleted:boolean;replies:FeedbackReply[]}
export interface FeedbackTarget {id:string;text:string;kind:'slide'|'notes'|'doc'|'cell';slideNumber?:number;pageId?:string;objectId?:string;startIndex?:number;endIndex?:number;tabId?:string;editable:boolean}
export interface FeedbackSnapshot {fileId:string;mimeType:string;revision:string;contentHash:string;targets:FeedbackTarget[];pageCount?:number}
export interface FeedbackPatch {targetId:string;oldText:string;newText:string}
export interface FeedbackArtifactRow {fileId:string;title:string;url?:string;kind:string;sourceVersion:string;state:string;summary?:string;runId?:string|number|null;updatedAt?:string}
export interface FeedbackItemRow {id:string|number;fileId:string;location?:string;content:string;state:string;proposal?:string;verification?:string}
export type FeedbackCommand='ready'|'accept'|'changes'|'accept-policy'|'revoke-policy';
export interface FeedbackSheetCommand {fileId:string;command:FeedbackCommand;value:string;reviewToken:string;row:number;sheetId:number}
const DRIVE='https://www.googleapis.com/drive/v3/files';
export const FEEDBACK_SLIDES='application/vnd.google-apps.presentation',FEEDBACK_DOC='application/vnd.google-apps.document',FEEDBACK_SHEET='application/vnd.google-apps.spreadsheet';
const sha=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id=(value:string)=>{if(typeof value!=='string'||!/^[-\w]{10,200}$/.test(value))throw Error('conflict');return value;};
const threadId=(value:string)=>{if(typeof value!=='string'||value.length>200||!/^[-\w]+(?:\.[-\w]+)*$/.test(value))throw Error('conflict');return value;};
function bounded(value:unknown,max=12000):string {if(typeof value!=='string')return '';if(value.length>max)throw Error('source_limit');return value;}
function privateFile(file:any,ownerEmail:string){
 if(!file||file.trashed)throw Error('conflict');
 if(!file.owners?.some((o:any)=>typeof o.emailAddress==='string'&&o.emailAddress.toLowerCase()===ownerEmail.toLowerCase()))throw Error('ownership');
 if(!Array.isArray(file.permissions)||file.permissions.some((p:any)=>!['user','group'].includes(p.type)))throw Error('privacy');
}
export async function verifyFeedbackFile(api:FeedbackGoogleApi,fileId:string,parentId:string,ownerEmail:string){
 const file=await api.json(`${DRIVE}/${id(fileId)}?fields=id,name,mimeType,parents,owners(emailAddress),permissions(type),trashed,appProperties`);
 privateFile(file,ownerEmail);
 if(file.id!==fileId||!file.parents?.includes(id(parentId))||![FEEDBACK_SLIDES,FEEDBACK_DOC,FEEDBACK_SHEET].includes(file.mimeType)||file.appProperties?.meaCentralScope&&file.appProperties.meaCentralScope!==api.scope)throw Error('conflict');
 return {id:file.id as string,name:bounded(file.name,300),mimeType:file.mimeType as string};
}
async function paged(api:FeedbackGoogleApi,base:string,key:string,max:number){
 let token='';const seen=new Set<string>(),rows:any[]=[];
 do{const url=new URL(base);if(token)url.searchParams.set('pageToken',token);const result=await api.json(String(url));if(!Array.isArray(result[key]))throw Error('google_response');rows.push(...result[key]);if(rows.length>max)throw Error('source_limit');const next=result.nextPageToken??'';if(typeof next!=='string'||next.length>4096||next&&seen.has(next))throw Error('google_response');if(next)seen.add(next);token=next;}while(token);
 return rows;
}
export async function listFeedbackComments(api:FeedbackGoogleApi,fileId:string,knownAgentReplyIds:Set<string>=new Set()):Promise<FeedbackGoogleComment[]>{
 id(fileId);const rows=await paged(api,`${DRIVE}/${fileId}/comments?includeDeleted=true&pageSize=100&fields=nextPageToken,comments(id,content,quotedFileContent,anchor,author(displayName,emailAddress,me),resolved,deleted)`, 'comments',500);
 let replyCount=0;
 const result:FeedbackGoogleComment[]=[];
 const read=async(c:any):Promise<FeedbackGoogleComment>=>{
  threadId(c.id);const replies=await paged(api,`${DRIVE}/${fileId}/comments/${c.id}/replies?includeDeleted=true&pageSize=100&fields=nextPageToken,replies(id,content,author(displayName,emailAddress,me),deleted,action)`, 'replies',500);
  replyCount+=replies.length;if(replyCount>5000)throw Error('source_limit');
  return{id:c.id,content:bounded(c.content),...(c.quotedFileContent?.value?{quotedText:bounded(c.quotedFileContent.value,4000)}:{}),...(c.anchor?{location:bounded(c.anchor,4000)}:{}),author:bounded(c.author?.emailAddress??c.author?.displayName,300),resolved:c.resolved===true,deleted:c.deleted===true,replies:replies.map(r=>({id:threadId(r.id),content:bounded(r.content),author:bounded(r.author?.emailAddress??r.author?.displayName,300),deleted:r.deleted===true,agent:knownAgentReplyIds.has(r.id)||r.author?.me===true&&/^\[MeaBeclick agent [\w:.-]+\]/.test(r.content??'')}))};
 };
 for(let start=0;start<rows.length;start+=4)result.push(...await Promise.all(rows.slice(start,start+4).map(read)));
 return result;
}
function ensureSnapshot(fileId:string,mimeType:string,revision:unknown,targets:FeedbackTarget[]):FeedbackSnapshot{
 if(typeof revision!=='string'||!revision||revision.length>1000||targets.length>10000||JSON.stringify(targets).length>1500000)throw Error('source_limit');
 if(new Set(targets.map(t=>t.id)).size!==targets.length)throw Error('google_response');
 return{fileId,mimeType,revision,contentHash:sha(targets),targets};
}
function collectShapeTargets(elements:any[],out:FeedbackTarget[],slideNumber:number,pageId:string,kind:'slide'|'notes',speakerNotesObjectId?:string){
 for(const element of elements??[]){
  if(element.elementGroup?.children)collectShapeTargets(element.elementGroup.children,out,slideNumber,pageId,kind,speakerNotesObjectId);
  if(!element.shape?.text?.textElements)continue;
  const text=element.shape.text.textElements.map((e:any)=>e.textRun?.content??'').join('');if(!text)continue;
  if(typeof element.objectId!=='string'||element.objectId.length>200)throw Error('google_response');
  out.push({id:`${kind}:${element.objectId}`,text:bounded(text,20000),kind,slideNumber,pageId,objectId:element.objectId,editable:kind==='slide'||element.objectId===speakerNotesObjectId});
 }
}
function collectDocTargets(content:any[],out:FeedbackTarget[],tabId?:string,counter={n:0}){
 for(const node of content??[]){
  if(node.paragraph){
   const start=Number(node.startIndex),end=Number(node.endIndex);if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end<=start)continue;if(end-start>20000)throw Error('source_limit');
   let text='',position=start;for(const run of node.paragraph.elements??[]){const at=Number(run.startIndex);if(!Number.isSafeInteger(at)||at<position||!Number.isSafeInteger(run.endIndex)||run.endIndex<at||run.endIndex>end)throw Error('google_response');text+='\uFFFC'.repeat(Math.min(20000,at-position));const body=run.textRun?.content??'\uFFFC'.repeat(Math.max(0,Number(run.endIndex)-at));text+=body;position=Number(run.endIndex);}
   out.push({id:`doc:${tabId??'body'}:${counter.n++}`,text:bounded(text,20000),kind:'doc',startIndex:start,endIndex:end,...(tabId?{tabId}:{}),editable:true});
  }
  for(const row of node.table?.tableRows??[])for(const cell of row.tableCells??[])collectDocTargets(cell.content,out,tabId,counter);
  if(node.tableOfContents?.content)collectDocTargets(node.tableOfContents.content,out,tabId,counter);
 }
}
export async function readFeedbackSnapshot(api:FeedbackGoogleApi,fileId:string,mimeType:string):Promise<FeedbackSnapshot>{
 id(fileId);const targets:FeedbackTarget[]=[];
 if(mimeType===FEEDBACK_SLIDES){
  const value=await api.json(`https://slides.googleapis.com/v1/presentations/${fileId}?fields=presentationId,revisionId,slides(objectId,pageElements(objectId,shape(text(textElements(textRun(content)))),elementGroup),slideProperties(notesPage(objectId,pageElements(objectId,shape(text(textElements(textRun(content))))),notesProperties(speakerNotesObjectId))))`);
  if(value.presentationId!==fileId||!Array.isArray(value.slides))throw Error('google_response');
  value.slides.forEach((slide:any,i:number)=>{collectShapeTargets(slide.pageElements,targets,i+1,slide.objectId,'slide');const notes=slide.slideProperties?.notesPage;collectShapeTargets(notes?.pageElements,targets,i+1,notes?.objectId,'notes',slide.slideProperties?.notesProperties?.speakerNotesObjectId??notes?.notesProperties?.speakerNotesObjectId);});
  return {...ensureSnapshot(fileId,mimeType,value.revisionId,targets),pageCount:value.slides.length};
 }
 if(mimeType===FEEDBACK_DOC){
  const value=await api.json(`https://docs.googleapis.com/v1/documents/${fileId}?includeTabsContent=true`);if(value.documentId!==fileId)throw Error('google_response');
  const tabs=(items:any[])=>{for(const tab of items){const tabId=tab.tabProperties?.tabId;if(typeof tabId!=='string')throw Error('google_response');collectDocTargets(tab.documentTab?.body?.content,targets,tabId);tabs(tab.childTabs??[]);}};
  if(value.tabs?.length)tabs(value.tabs);else collectDocTargets(value.body?.content,targets);
  return ensureSnapshot(fileId,mimeType,value.revisionId,targets);
 }
 if(mimeType===FEEDBACK_SHEET){
  const value=await api.json(`https://sheets.googleapis.com/v4/spreadsheets/${fileId}?fields=spreadsheetId,sheets(properties(sheetId,title))`);if(value.spreadsheetId!==fileId||!Array.isArray(value.sheets)||value.sheets.length>30)throw Error('source_limit');
  for(const sheet of value.sheets){const title=bounded(sheet.properties?.title,200);const range=`'${title.replace(/'/g,"''")}'!A1:Z100`;const values=await api.json(`https://sheets.googleapis.com/v4/spreadsheets/${fileId}/values/${encodeURIComponent(range)}`);for(const[row,cells]of (values.values??[]).entries())for(const[col,text]of cells.entries())if(text!==''&&text!=null)targets.push({id:`cell:${sheet.properties.sheetId}:${row}:${col}`,text:bounded(String(text),4000),kind:'cell',editable:false});}
  return ensureSnapshot(fileId,mimeType,sha(targets),targets);
 }
 throw Error('unsupported_context');
}
function replacement(text:string,patch:FeedbackPatch){
 if(!patch.oldText||patch.oldText===patch.newText||patch.oldText.length>2000||!patch.newText||patch.newText.length>2000||/[\r\n\u0000-\u001f\uFFFC]/.test(patch.oldText+patch.newText))throw Error('feedback_patch');
 const at=text.indexOf(patch.oldText);if(at<0||text.indexOf(patch.oldText,at+1)>=0)throw Error('conflict');
 return{at,text:text.slice(0,at)+patch.newText+text.slice(at+patch.oldText.length)};
}
export async function applyFeedbackPatches(api:FeedbackGoogleApi,snapshot:FeedbackSnapshot,patches:FeedbackPatch[]):Promise<FeedbackSnapshot>{
 if(!Array.isArray(patches)||!patches.length||patches.length>20||new Set(patches.map(p=>p.targetId)).size!==patches.length||snapshot.mimeType===FEEDBACK_SHEET)throw Error('feedback_patch');
 const expected=new Map(snapshot.targets.map(t=>[t.id,t.text]));for(const patch of patches){const target=snapshot.targets.find(t=>t.id===patch.targetId);if(!target?.editable)throw Error('feedback_patch');expected.set(patch.targetId,replacement(target.text,patch).text);}
 const current=await readFeedbackSnapshot(api,snapshot.fileId,snapshot.mimeType);
 // An acknowledged write may have been lost. Replaying a complete verified result is safe.
 if(current.contentHash!==snapshot.contentHash&&current.targets.every(t=>t.text===expected.get(t.id))&&current.targets.length===snapshot.targets.length)return current;
 if(current.revision!==snapshot.revision||current.contentHash!==snapshot.contentHash)throw Error('conflict');
 const requests:object[]=[];
 const ordered=patches.map(p=>({patch:p,target:snapshot.targets.find(t=>t.id===p.targetId)!})).sort((a,b)=>(b.target.startIndex??0)-(a.target.startIndex??0));
 for(const {patch,target}of ordered){const at=replacement(target.text,patch).at;
  if(snapshot.mimeType===FEEDBACK_SLIDES){requests.push({deleteText:{objectId:target.objectId,textRange:{type:'FIXED_RANGE',startIndex:at,endIndex:at+patch.oldText.length}}},{insertText:{objectId:target.objectId,text:patch.newText,insertionIndex:at}});}
  else {const start=target.startIndex!+at,tab=target.tabId?{tabId:target.tabId}:{};requests.push({deleteContentRange:{range:{startIndex:start,endIndex:start+patch.oldText.length,...tab}}},{insertText:{location:{index:start,...tab},text:patch.newText}});}
 }
 const base=snapshot.mimeType===FEEDBACK_SLIDES?'https://slides.googleapis.com/v1/presentations/':'https://docs.googleapis.com/v1/documents/';
 await api.json(`${base}${snapshot.fileId}:batchUpdate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({writeControl:{requiredRevisionId:snapshot.revision},requests})});
 const after=await readFeedbackSnapshot(api,snapshot.fileId,snapshot.mimeType);
 if(after.targets.length!==snapshot.targets.length||after.targets.some(t=>t.text!==expected.get(t.id)))throw Error('conflict');
 return after;
}
const reviewTitle='Learning Reviews',feedbackTitle='Learning Feedback';
const reviewHeaders=['file_id','קובץ','סוג','גרסה','מצב','סיכום','בדיקה','עודכן','פעולה'];
const feedbackHeaders=['feedback_id','קובץ','מיקום','משוב','מצב','הצעת תיקון','אימות'];
const commands:Record<string,FeedbackCommand>={ready:'ready',accept:'accept',changes:'changes','accept-policy':'accept-policy','מוכן לסוכן':'ready','אישור':'accept','לתקן שוב':'changes','אישור כלל להמשך':'accept-policy','revoke-policy':'revoke-policy','ביטול כלל להמשך':'revoke-policy'};
function commandFor(raw:string):{command:FeedbackCommand;reviewToken:string}|undefined{
 const value=raw.trim();if(value==='ready'||value==='מוכן לסוכן')return{command:'ready',reviewToken:''};
 const match=value.match(/^(.*?) · בדיקה ([1-9]\d*\.[1-9]\d*)$/);if(!match||!Object.hasOwn(commands,match[1]))return;
 const command=commands[match[1]];if(command==='ready')return;return{command,reviewToken:match[2]};
}
function commandChoices(token:unknown,kind?:string){const value=String(token??''),valid=/^[1-9]\d*\.[1-9]\d*$/.test(value);if(kind==='policy'){if(!valid)throw Error('conflict');return[`ביטול כלל להמשך · בדיקה ${value}`];}return['מוכן לסוכן',...(valid?['אישור','לתקן שוב','אישור כלל להמשך','ביטול כלל להמשך'].map(command=>`${command} · בדיקה ${value}`):[])];}
function validationRequest(sheetId:number,startRowIndex:number,endRowIndex:number,choices:string[]){return{setDataValidation:{range:{sheetId,startRowIndex,endRowIndex,startColumnIndex:8,endColumnIndex:9},rule:{condition:{type:'ONE_OF_LIST',values:choices.map(userEnteredValue=>({userEnteredValue}))},strict:true,showCustomUi:true}}};}

function stringCell(value:unknown){const text=String(value??'');if(text.length>49000)throw Error('source_limit');return{userEnteredValue:{stringValue:text}};}
function indexUrl(indexId:string){return `https://sheets.googleapis.com/v4/spreadsheets/${id(indexId)}`;}
export async function syncFeedbackSheet(api:FeedbackGoogleApi,indexId:string,artifacts:FeedbackArtifactRow[],feedback:FeedbackItemRow[]):Promise<{commands:FeedbackSheetCommand[];sheetId:number}>{
 if(artifacts.length>10000||feedback.length>30000||new Set(artifacts.map(a=>a.fileId)).size!==artifacts.length||new Set(feedback.map(f=>String(f.id))).size!==feedback.length)throw Error('source_limit');
 const base=indexUrl(indexId);const metadata=await api.json(`${base}?fields=spreadsheetId,sheets(properties,developerMetadata)`);if(!Array.isArray(metadata.sheets))throw Error('google_response');
 const used=new Set<number>(metadata.sheets.map((s:any)=>s.properties.sheetId));let next=1;const selected:any[]=[];
 for(const [role,title,headers]of [['reviews',reviewTitle,reviewHeaders],['feedback',feedbackTitle,feedbackHeaders]] as const){
  const mark=`${api.scope}:learning-feedback:${role}`;const owned=metadata.sheets.filter((s:any)=>s.developerMetadata?.some((d:any)=>d.metadataKey==='meaLearningFeedback'&&d.metadataValue===mark));if(owned.length>1)throw Error('conflict');
  let sheet=owned[0];if(!sheet){if(metadata.sheets.some((s:any)=>s.properties.title===title))throw Error('conflict');while(used.has(next))next++;used.add(next);sheet={properties:{sheetId:next,title,gridProperties:{rowCount:1000,columnCount:15}}};
   const requests:object[]=[{addSheet:{properties:{...sheet.properties,rightToLeft:true,gridProperties:{rowCount:1000,columnCount:15,frozenRowCount:1}}}},{createDeveloperMetadata:{developerMetadata:{metadataKey:'meaLearningFeedback',metadataValue:mark,visibility:'DOCUMENT',location:{sheetId:next}}}},{updateCells:{start:{sheetId:next,rowIndex:0,columnIndex:0},rows:[{values:headers.map(stringCell)}],fields:'userEnteredValue'}}];
   requests.push({updateDimensionProperties:{range:{sheetId:next,dimension:'COLUMNS',startIndex:0,endIndex:1},properties:{hiddenByUser:true},fields:'hiddenByUser'}},{repeatCell:{range:{sheetId:next,startRowIndex:0,endRowIndex:1},cell:{userEnteredFormat:{backgroundColor:{red:.04,green:.18,blue:.32},textFormat:{bold:true,foregroundColor:{red:1,green:1,blue:1}}}},fields:'userEnteredFormat'}},{updateDimensionProperties:{range:{sheetId:next,dimension:'COLUMNS',startIndex:1,endIndex:2},properties:{pixelSize:240},fields:'pixelSize'}});
   if(role==='reviews')requests.push(validationRequest(next,1,1000,commandChoices(null)));
   await api.json(`${base}:batchUpdate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requests})});
  }
  if(sheet.properties.title!==title)throw Error('conflict');selected.push(sheet);
 }
 const output:FeedbackSheetCommand[]=[];
 const byArtifact=new Map(artifacts.map(a=>[a.fileId,a]));const byFeedback=new Map(feedback.map(f=>[String(f.id),f]));
 const stateLabel=(value:string)=>({'collecting':'איסוף משוב','queued':'ממתין לסוכן','working':'בבדיקה','awaiting-review':'ממתין לאישור','awaiting_human':'ממתין לאישור','accepted':'אושר','blocked':'נדרש טיפול','new':'חדש','applied':'יושם','failed':'נכשל','revoked':'בוטל'} as Record<string,string>)[value]??value;
 for(const [n,rows,columns]of [[0,artifacts.map(a=>[a.fileId,a.title,a.kind,a.sourceVersion,stateLabel(a.state),a.summary??'',a.runId??'',a.updatedAt??'']),8],[1,feedback.map(f=>[String(f.id),byArtifact.get(f.fileId)?.title??f.fileId,f.location??'',f.content,stateLabel(f.state),f.proposal??'',f.verification??'']),7]] as const){
  const sheet=selected[n],title=n===0?reviewTitle:feedbackTitle;const value=await api.json(`${base}/values/${encodeURIComponent(`'${title}'!A:O`)}?valueRenderOption=UNFORMATTED_VALUE`);const existing:any[][]=value.values??[];if(!Array.isArray(existing)||existing.length>40000)throw Error('source_limit');
  const byId=new Map<string,number>();existing.slice(1).forEach((r,i)=>{if(r[0]!=null&&r[0]!==''){const key=String(r[0]);if(byId.has(key))throw Error('conflict');byId.set(key,i+1);}});
  const updates:object[]=[];let appendAt=Math.max(1,existing.length);
  for(const row of rows){const key=String(row[0]);const at=byId.get(key)??appendAt++;byId.set(key,at);if(n===0&&commandFor(String(existing[at]?.[8]??''))&&commandFor(String(existing[at]?.[8]??''))?.command!=='ready')continue;if(row.every((v,i)=>String(existing[at]?.[i]??'')===String(v??'')))continue;if(n===0)updates.push(validationRequest(sheet.properties.sheetId,at,at+1,commandChoices(row[6],byArtifact.get(key)?.kind)));const cells:any[]=row.map(stringCell);const linked=n===0?byArtifact.get(key):byArtifact.get(byFeedback.get(key)!.fileId);if(linked){const link=linked.url??`https://drive.google.com/file/d/${id(linked.fileId)}/view`;const parsed=new URL(link);if(parsed.protocol!=='https:'||!['docs.google.com','drive.google.com'].includes(parsed.hostname)||parsed.username||parsed.password)throw Error('conflict');cells[1].userEnteredFormat={textFormat:{link:{uri:link}}};}updates.push({updateCells:{start:{sheetId:sheet.properties.sheetId,rowIndex:at,columnIndex:0},rows:[{values:cells}],fields:'userEnteredValue,userEnteredFormat.textFormat.link'}});}
  const needed=Math.max(sheet.properties.gridProperties?.rowCount??1000,appendAt+1);if(needed>(sheet.properties.gridProperties?.rowCount??1000))updates.unshift({updateSheetProperties:{properties:{sheetId:sheet.properties.sheetId,gridProperties:{rowCount:needed}},fields:'gridProperties.rowCount'}});
  // A pending action freezes its displayed proposal token; never retarget an old approval.
  // Other updates stop before the human command column and never clear omitted rows.
  if(updates.length){if(JSON.stringify(updates).length>1800000)throw Error('source_limit');await api.json(`${base}:batchUpdate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requests:updates})});}
  if(n===0){const known=new Set(artifacts.map(a=>a.fileId));for(const [row,values]of existing.entries()){if(!row||!known.has(String(values[0])))continue;const raw=String(values[8]??'');const parsed=commandFor(raw);if(parsed)output.push({fileId:String(values[0]),command:parsed.command,value:raw,reviewToken:parsed.reviewToken,row,sheetId:sheet.properties.sheetId});}}
  void columns;
 }
 return{commands:output,sheetId:selected[0].properties.sheetId};
}
/** Compare-and-clear on Google's server, so a different newly entered action survives. */
export async function ackFeedbackCommand(api:FeedbackGoogleApi,indexId:string,observed:{sheetId:number;row:number;value:string}){
 if(!Number.isSafeInteger(observed.sheetId)||observed.sheetId<0||!Number.isSafeInteger(observed.row)||observed.row<1||!commandFor(observed.value))throw Error('conflict');
 await api.json(`${indexUrl(indexId)}:batchUpdate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requests:[{findReplace:{range:{sheetId:observed.sheetId,startRowIndex:observed.row,endRowIndex:observed.row+1,startColumnIndex:8,endColumnIndex:9},find:observed.value,replacement:'',matchEntireCell:true,matchCase:true,searchByRegex:false,includeFormulas:false}}]})});
}
export async function appendReplyOnce(api:FeedbackGoogleApi,fileId:string,commentId:string,runId:string,content:string,options:{resolve?:boolean}={}):Promise<string>{
 id(fileId);threadId(commentId);if(!/^[\w.-]{1,120}$/.test(runId)||!content||content.length>6000)throw Error('feedback_reply');
 const marker=`[MeaBeclick agent ${runId}]`;
 const base=`${DRIVE}/${fileId}/comments/${commentId}/replies`;
 const existing=await paged(api,`${base}?includeDeleted=true&pageSize=100&fields=nextPageToken,replies(id,content,author(me),deleted,action)`,'replies',500);
 const same=existing.find(r=>!r.deleted&&r.author?.me===true&&r.content?.startsWith(marker));if(same)return threadId(same.id);
 const result=await api.json(`${base}?fields=id`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:marker+'\n'+content,...(options.resolve?{action:'resolve'}:{})})});
 return threadId(result.id);
}

export interface FeedbackEvidenceImage {name:string;path:string;sha256:string}
export interface FeedbackEvidenceDependencies {fetch?:typeof fetch;renderPdf?:(pdf:Buffer,directory:string)=>Promise<{pages:number;images:Buffer[]}>}
async function binary(response:Response,limit:number):Promise<Buffer>{
 if(!response.ok||!response.body)throw Error('review_evidence');
 const length=Number(response.headers.get('content-length'));if(length>limit)throw Error('source_limit');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>limit){await reader.cancel();throw Error('source_limit');}chunks.push(part.value);}}finally{reader.releaseLock();}
 return Buffer.concat(chunks);
}
async function renderNativePdf(pdf:Buffer,directory:string):Promise<{pages:number;images:Buffer[]}>{
 const file=path.join(directory,'native.pdf');await writeFile(file,pdf,{mode:0o600,flag:'wx'});
 const run=promisify(execFile);let info:string;
 try{info=(await run('pdfinfo',[file],{timeout:15000,maxBuffer:128000})).stdout;}catch{throw Error('review_evidence');}
 const pages=Number(info.match(/^Pages:\s+(\d+)\s*$/m)?.[1]);if(!Number.isSafeInteger(pages)||pages<1||pages>12)throw Error('source_limit');
 try{await run('pdftoppm',['-png','-scale-to','1600','-f','1','-l',String(pages),file,path.join(directory,'render')],{timeout:90000,maxBuffer:128000});}catch{throw Error('review_evidence');}
 const files=(await readdir(directory)).filter(n=>/^render-\d+\.png$/.test(n)).sort((a,b)=>Number(a.match(/\d+/)![0])-Number(b.match(/\d+/)![0]));
 if(files.length!==pages)throw Error('review_evidence');
 return{pages,images:await Promise.all(files.map(async name=>{const file=path.join(directory,name);await chmod(file,0o600);return readFile(file);} ))};
}
/** Actual native output, with a revision fence around capture rather than a recreated storyboard. */
export async function feedbackVisualEvidence(api:FeedbackGoogleApi,snapshot:FeedbackSnapshot,directory:string,targetIds?:string[],deps:FeedbackEvidenceDependencies={}):Promise<FeedbackEvidenceImage[]>{
 if(!path.isAbsolute(directory))throw Error('review_evidence');
 const current=await readFeedbackSnapshot(api,snapshot.fileId,snapshot.mimeType);
 if(current.revision!==snapshot.revision||current.contentHash!==snapshot.contentHash)throw Error('conflict');
 await mkdir(directory,{recursive:true,mode:0o700});await chmod(directory,0o700);
 const output=await mkdtemp(path.join(directory,'native-evidence-'));await chmod(output,0o700);
 const images:FeedbackEvidenceImage[]=[];
 async function save(name:string,bytes:Buffer){
  if(bytes.length>15*1024*1024)throw Error('source_limit');let png:Buffer;
  try{png=await sharp(bytes,{limitInputPixels:40000000}).resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).png().toBuffer();}catch{throw Error('review_evidence');}
  const target=path.join(output,name+'.png');await writeFile(target,png,{mode:0o600,flag:'wx'});images.push({name,path:target,sha256:createHash('sha256').update(png).digest('hex')});
 }
 if(snapshot.mimeType===FEEDBACK_SLIDES){
  const pages=new Map<number,string>();for(const t of snapshot.targets)if(t.kind==='slide'&&t.slideNumber&&t.pageId)pages.set(t.slideNumber,t.pageId);
  if(!pages.size)throw Error('review_evidence');let selected:Array<[number,string]>;
  if(targetIds?.length){const numbers=new Set<number>();for(const targetId of targetIds){const t=snapshot.targets.find(t=>t.id===targetId);if(!t?.slideNumber)throw Error('feedback_patch');numbers.add(t.slideNumber);}selected=[...pages].filter(([n])=>numbers.has(n));if(selected.length!==numbers.size||selected.length>20)throw Error('source_limit');}
  else selected=[...pages].slice(0,20);
  for(const[number,pageId]of selected){
   const thumbnail=await api.json(`https://slides.googleapis.com/v1/presentations/${id(snapshot.fileId)}/pages/${encodeURIComponent(pageId)}/thumbnail?thumbnailProperties.mimeType=PNG&thumbnailProperties.thumbnailSize=LARGE`);
   let url:URL;try{url=new URL(thumbnail.contentUrl);}catch{throw Error('review_evidence');}
   if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||!(url.hostname==='googleusercontent.com'||url.hostname.endsWith('.googleusercontent.com')))throw Error('review_evidence');
   let response:Response;try{response=await(deps.fetch??fetch)(url,{redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw Error('review_evidence');}
   const total=snapshot.pageCount??Math.max(...snapshot.targets.map(t=>t.slideNumber??0));
   await save(`slide-${String(number).padStart(3,'0')}-of-${String(total).padStart(3,'0')}`,await binary(response,15*1024*1024));
  }
 }else if(snapshot.mimeType===FEEDBACK_DOC){
  if(!api.request)throw Error('api_setup');
  const response=await api.request(`${DRIVE}/${id(snapshot.fileId)}/export?mimeType=application%2Fpdf`);
  const pdf=await binary(response,10*1024*1024);const rendered=await(deps.renderPdf??renderNativePdf)(pdf,output);
  if(!Number.isSafeInteger(rendered.pages)||rendered.pages<1||rendered.pages>12||rendered.images.length!==rendered.pages)throw Error('source_limit');
  for(const[i,bytes]of rendered.images.entries())await save(`page-${String(i+1).padStart(3,'0')}-of-${String(rendered.pages).padStart(3,'0')}`,bytes);
 }else throw Error('unsupported_context');
 const after=await readFeedbackSnapshot(api,snapshot.fileId,snapshot.mimeType);
 if(after.revision!==snapshot.revision||after.contentHash!==snapshot.contentHash)throw Error('conflict');
 if(!images.length)throw Error('review_evidence');return images;
}
