/** Retirement is a receipt for a verified Drive archive, never deletion. */
import {randomUUID} from 'node:crypto';
import {handle,inTransaction} from './db.ts';

export interface ArchiveJob {archiveId:string;fingerprint:string;slugs:string[]}
export interface NativeWorkspace {
 version:1;archiveId:string;fingerprint:string;archivedAt:string;artifactCount:number;lessonCount:number;
 workspaceId:string;libraryId:string;presentationsId:string;homeworkId:string;gamesId:string;notesId:string;
 templatesId:string;reviewId:string;archiveFolderId:string;archiveIndexId:string;studentsId:string;indexId:string;guideId:string;
}
export const NATIVE_AUTHORING_MESSAGE='הספרייה עברה ל־Google Drive. חומרים חדשים מכינים במרחב הלמידה; היצירה האוטומטית הישנה הושבתה.';
let publications=0;
const id=(v:unknown):v is string=>typeof v==='string'&&/^[\w-]{10,}$/.test(v);
function row(){return handle().prepare('SELECT archive_id,fingerprint,slugs,receipt FROM learning_archive WHERE id=1').get() as {archive_id:string;fingerprint:string;slugs:string;receipt:string|null}|undefined;}
export function archiveJob():ArchiveJob|null {const r=row();return r?{archiveId:r.archive_id,fingerprint:r.fingerprint,slugs:JSON.parse(r.slugs)}:null;}
export function beginArchive(snapshot:{fingerprint:string;slugs:string[]}):ArchiveJob {
 const previous=archiveJob();if(previous)return previous;
 if(!/^[a-f0-9]{64}$/.test(snapshot.fingerprint)||snapshot.slugs.length>100000||snapshot.slugs.some(s=>!s||s.length>240))throw Error('source_schema');
 const job={archiveId:randomUUID(),fingerprint:snapshot.fingerprint,slugs:[...new Set(snapshot.slugs)].sort()};
 handle().prepare('INSERT INTO learning_archive(id,archive_id,fingerprint,slugs) VALUES(1,?,?,?)').run(job.archiveId,job.fingerprint,JSON.stringify(job.slugs));return job;
}
export function nativeWorkspace():NativeWorkspace|null {const r=row();return r?.receipt?JSON.parse(r.receipt):null;}
export function sourceRevision():string {return `${handle().prepare('PRAGMA data_version').get()!.data_version}:${handle().prepare('SELECT total_changes() n').get()!.n}`;}
export function completeArchive(receipt:NativeWorkspace,revision:string):void {
 const job=archiveJob();if(!job||job.archiveId!==receipt.archiveId||job.fingerprint!==receipt.fingerprint||receipt.lessonCount!==job.slugs.length)throw Error('source_changed');
 if(nativeWorkspace())return;
 const ids=['workspaceId','libraryId','presentationsId','homeworkId','gamesId','notesId','templatesId','reviewId','archiveFolderId','archiveIndexId','studentsId','indexId','guideId'] as const;
 if(receipt.version!==1||ids.some(k=>!id(receipt[k]))||!Number.isSafeInteger(receipt.artifactCount)||receipt.artifactCount<1||!Number.isFinite(Date.parse(receipt.archivedAt)))throw Error('source_schema');
 inTransaction(()=>{
  if(publications||sourceRevision()!==revision)throw Error('source_changed');
  const insert=handle().prepare('INSERT INTO learning_retired_lessons(slug,archive_id) VALUES(?,?)');
  for(const slug of job.slugs)insert.run(slug,job.archiveId);
  handle().prepare('UPDATE learning_archive SET receipt=? WHERE id=1 AND receipt IS NULL').run(JSON.stringify(receipt));
 });
}
export function isRetiredLesson(slug:string):boolean {return !!handle().prepare('SELECT 1 FROM learning_retired_lessons WHERE slug=?').get(slug);}
export function assertLegacyAuthoring():void {if(nativeWorkspace())throw Error('native_workspace');}
/** Filesystem writes can finish after an await; retirement cannot race them. */
export async function withLegacyPublication<T>(write:()=>Promise<T>):Promise<T>{
 assertLegacyAuthoring();publications++;
 try{return await write();}finally{publications--;}
}
