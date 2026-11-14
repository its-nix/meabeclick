import {israelToday} from '../../dates.ts';
import {indexHeadings,writeCentralIndex,type IndexViews} from './index.ts';
import {centralFileUrl,DOC,SHEET,type centralDriveApi} from './api.ts';
import type {ArchiveJob,NativeWorkspace} from '../learning-archive.ts';
import type {LearningInventory} from './source.ts';

type Api=ReturnType<typeof centralDriveApi>;
const roles=['students','materials','progress'] as const;
const titles=['Site Students','Site Materials','Site Progress'];
const normalize=(rows:unknown[][])=>rows.map(row=>{const r=[...row];while(r.length&&(r.at(-1)===null||r.at(-1)===''))r.pop();return r;});
/** A dated register is immutable. Never refresh it like the ongoing mirror. */
export async function writeVerifiedArchive(api:Api,id:string,views:IndexViews){
 const base=`https://sheets.googleapis.com/v4/spreadsheets/${id}`;
 const meta=await api.json(`${base}?fields=sheets(properties,developerMetadata)`);
 if(!Array.isArray(meta.sheets))throw Error('google_response');
 const owned=meta.sheets.filter((s:any)=>s.developerMetadata?.some((m:any)=>m.metadataKey==='meaCentralView'&&m.metadataValue.startsWith(api.scope+':')));
 if(owned.length&&owned.length!==3)throw Error('conflict');
 if(!owned.length)await writeCentralIndex(api,id,views);
 const query=new URLSearchParams({valueRenderOption:'UNFORMATTED_VALUE'});
 for(const title of titles)query.append('ranges',`'${title}'!A1:K100001`);
 const actual=await api.json(`${base}/values:batchGet?${query}`);
 if(!Array.isArray(actual.valueRanges)||actual.valueRanges.length!==roles.length)throw Error('google_response');
 for(const [i,role]of roles.entries()){
  const expected=[indexHeadings[role],...views[role]].map(row=>row.map(c=>c===null?'':typeof c==='object'?c.text:c));
  const values=actual.valueRanges[i].values;
  if(!Array.isArray(values)||JSON.stringify(normalize(values))!==JSON.stringify(normalize(expected)))throw Error('conflict');
 }
}

export async function prepareNativeArchive(api:Api,job:ArchiveJob,inventory:LearningInventory,views:IndexViews,refs:{studentsId:string;indexId:string;learningFolderId:string}):Promise<NativeWorkspace>{
 if(job.fingerprint!==inventory.fingerprint)throw Error('source_changed');
 const workspace=await api.folder('native-workspace','Teaching workspace',refs.learningFolderId);
 const library=await api.folder('native-library','Library',workspace.id);
 const folders:Record<string,string>={};
 // The shared upload checkpoint requires sequential creation, even for folders.
 for(const [key,name,parent]of [
  ['presentations','Presentations',library.id],['homework','Homework',library.id],['games','Interactive games',library.id],['notes','Teacher notes',library.id],
  ['templates','Templates',workspace.id],['review','Review',workspace.id],['archive','Archive',workspace.id],
 ])folders[key]=(await api.folder(`native-${key}`,name,parent)).id;
 const dated=await api.folder(`archive:${job.archiveId}`,`Website content — ${israelToday()}`,folders.archive);
 const index=await api.native(`archive-index:${job.archiveId}`,'MeaBeclick — Archived website content',SHEET,dated.id);
 await writeVerifiedArchive(api,index.file.id,views);
 const guide=await api.native('native-workspace-guide','מאה בקליק — מרחב ההוראה החדש',DOC,workspace.id,
  `<!doctype html><html lang="he" dir="rtl"><body dir="rtl"><h1>מאה בקליק — מרחב ההוראה</h1><p>הספרייה מתחילה מחדש. החומרים הישנים נשמרו בארכיון כמקורות היסטוריים, ואינם חומרי הוראה שאושרו לשימוש חדש.</p><h2>מבנה חבילת שיעור</h2><p>מצגת ניתנת לעריכה ב־Google Slides. מסמך Google Docs נפרד להערות למורה ולפתרונות, ומסמך תרגול לבית ללא תשובות. משחקים ותרגול אינטראקטיבי שומרים על ההמחשות ועל מעקב הניסיונות באתר.</p><h2>לפני שימוש עם תלמיד/ה</h2><p>בודקים את המתמטיקה, ההסברים, המיתוג והערות המורה. טיוטה אינה חומר שאושר או שפורסם לתלמיד. שומרים על הפרדה בין חומר לתלמיד לבין פתרונות ומידע פרטי למורה.</p><h2>קישורים</h2><p><a href="${centralFileUrl(index.file)}">ארכיון מלא של המקורות</a></p><p><a href="https://docs.google.com/spreadsheets/d/${refs.indexId}/edit">תלמידים, חומרים והתקדמות</a></p><p>היצירה האוטומטית הישנה הושבתה. הפעלת יצירה חדשה מחייבת תחילה חבילת שיעור מקורית שעברה בדיקת איכות.</p></body></html>`);
 return {version:1,archiveId:job.archiveId,fingerprint:job.fingerprint,archivedAt:new Date().toISOString(),artifactCount:inventory.artifacts.length,lessonCount:job.slugs.length,
  workspaceId:workspace.id,libraryId:library.id,presentationsId:folders.presentations,homeworkId:folders.homework,gamesId:folders.games,notesId:folders.notes,templatesId:folders.templates,reviewId:folders.review,
  archiveFolderId:dated.id,archiveIndexId:index.file.id,studentsId:refs.studentsId,indexId:refs.indexId,guideId:guide.file.id};
}
