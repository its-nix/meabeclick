import {createHash} from 'node:crypto';
import {handle,inTransaction} from '../db.ts';
import {publicVisualLesson,visualGamesProblems,type VisualLesson} from '../../learning/deck/model.ts';

type Game=VisualLesson['games'][number];
export interface GamesFile {version:1;lessonRef:string;objectives:{id:string;title:string}[];games:Game[]}
/** Reads one Drive file at its current revision. Real Google access lives behind this seam. */
export interface GamesDrive {read(fileId:string):Promise<{revisionId:string;text:string}>}
export interface ApprovedGame {materialId:string;releaseId:string;gameId:string;kind:string;sourceRevision:string;contentSha256:string}
const MAX_BYTES=512*1024;
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');

/** The editable Drive source for one lesson. Answers stay in it; Drive is private to staff. */
export function exportGamesFile(bundle:VisualLesson,lessonRef:string):GamesFile {
 return {version:1,lessonRef,objectives:bundle.objectives.map(o=>({id:o.id,title:o.title})),games:structuredClone(bundle.games)};
}
export function gamesFileText(file:GamesFile){return JSON.stringify(file,null,1);}

function parseGamesFile(text:string,lessonRef:string):GamesFile {
 if(typeof text!=='string'||Buffer.byteLength(text)>MAX_BYTES)throw new Error('games_file_invalid: size');
 let raw:any;try{raw=JSON.parse(text);}catch{throw new Error('games_file_invalid: json');}
 if(!raw||typeof raw!=='object'||raw.version!==1||raw.lessonRef!==lessonRef)throw new Error('games_file_invalid: lesson');
 const objectives=raw.objectives;
 if(!Array.isArray(objectives)||objectives.some((o:any)=>!o||typeof o.id!=='string'))throw new Error('games_file_invalid: objectives');
 const problems=visualGamesProblems(raw.games,objectives);
 if(problems.length)throw new Error(`games_file_invalid: ${problems.slice(0,3).join('; ')}`);
 return raw as GamesFile;
}

/** Called by the Sheet sync when a game Material is approved and published; never by a button. Fails closed:
 * on any invalid file nothing is written and any previously approved copy stays as it was. */
export async function approveNativeLesson(input:{bookingId:number;sheetRevision:string;materialId:string;releaseId:string;fileId:string;expectedSha256?:string;drive:GamesDrive}):Promise<ApprovedGame[]> {
 const job=handle().prepare('SELECT student_id,state FROM native_lesson_jobs WHERE booking_id=?').get(input.bookingId);
 if(!job||job.state==='cancelled')throw new Error('games_no_lesson');
 if(!input.materialId||!input.releaseId||!input.sheetRevision)throw new Error('games_release_required');
 const file=await input.drive.read(input.fileId);
 if(!file||typeof file.revisionId!=='string'||!file.revisionId)throw new Error('games_file_invalid: revision');
 const hash=sha(file.text);
 if(input.expectedSha256&&input.expectedSha256!==hash)throw new Error('games_file_invalid: fingerprint');
 const parsed=parseGamesFile(file.text,`booking-${input.bookingId}`);
 const now=new Date().toISOString(),studentId=Number(job.student_id);
 return inTransaction(()=>{
  const db=handle();
  db.prepare('DELETE FROM native_games WHERE material_id=?').run(input.materialId);
  const insert=db.prepare(`INSERT INTO native_games (material_id,release_id,student_id,booking_id,game_id,kind,content_json,source_file_id,source_revision,content_sha256,approved_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  for(const g of parsed.games)insert.run(input.materialId,input.releaseId,studentId,input.bookingId,g.id,g.kind,JSON.stringify(g),input.fileId,file.revisionId,hash,now);
  db.prepare('UPDATE native_lesson_jobs SET approved_release_id=?,approved_sheet_revision=?,approved_at=? WHERE booking_id=?').run(input.releaseId,input.sheetRevision,now,input.bookingId);
  return parsed.games.map(g=>({materialId:input.materialId,releaseId:input.releaseId,gameId:g.id,kind:g.kind,sourceRevision:file.revisionId,contentSha256:hash}));
 });
}
/** Withdraw student access. native_results is a separate table, so recorded results are kept. */
export function withdrawNativeGames(materialId:string):number {
 return inTransaction(()=>{
  const db=handle(),rows=db.prepare('SELECT DISTINCT booking_id FROM native_games WHERE material_id=?').all(materialId);
  const n=Number(db.prepare('DELETE FROM native_games WHERE material_id=?').run(materialId).changes);
  for(const r of rows)db.prepare('UPDATE native_lesson_jobs SET approved_release_id=NULL,approved_sheet_revision=NULL,approved_at=NULL WHERE booking_id=?').run(r.booking_id);
  return n;
 });
}
export function approvedMaterialIds():string[]{return handle().prepare('SELECT DISTINCT material_id FROM native_games').all().map(r=>String(r.material_id));}
export function approvedRelease(materialId:string):{releaseId:string;contentSha256:string}|null{
 const r=handle().prepare('SELECT release_id,content_sha256 FROM native_games WHERE material_id=? LIMIT 1').get(materialId);
 return r?{releaseId:String(r.release_id),contentSha256:String(r.content_sha256)}:null;
}
/** Student-facing games, answers stripped by the same boundary as the review runtime. */
export function approvedGamesForStudent(studentId:number,bookingId:number){
 const rows=handle().prepare('SELECT content_json FROM native_games WHERE student_id=? AND booking_id=? ORDER BY id').all(studentId,bookingId);
 return rows.map(r=>{
  const shell={version:1,ruleVersion:'',title:'',subtitle:'',durationMin:0,homeworkMinutes:0,objectives:[],agenda:[],slides:[],tasks:[],homework:[],games:[JSON.parse(String(r.content_json))],sourceSolutions:[]} as unknown as VisualLesson;
  return publicVisualLesson(shell).games[0];
 });
}

const shellFor=(games:Game[]):VisualLesson=>({version:1,ruleVersion:'',title:'משחקי תרגול',subtitle:'',durationMin:0,homeworkMinutes:0,objectives:[],agenda:[],slides:[],tasks:[],homework:[],games,sourceSolutions:[]} as unknown as VisualLesson);
/** Server-only: the approved games with answers, for grading and for the player renderer (which strips them itself). */
export function approvedGameBundle(studentId:number,bookingId:number,gameId?:string):{bundle:VisualLesson;version:string}|null{
 const rows=handle().prepare('SELECT game_id,content_json,content_sha256 FROM native_games WHERE student_id=? AND booking_id=? ORDER BY id').all(studentId,bookingId).filter(r=>!gameId||r.game_id===gameId);
 if(!rows.length)return null;
 return {bundle:shellFor(rows.map(r=>JSON.parse(String(r.content_json)))),version:String(rows[0].content_sha256)};
}
/** Student's approved lessons with their answer-stripped games, newest lesson first. */
export function approvedGameLessonsForStudent(studentId:number){
 const ids=handle().prepare('SELECT DISTINCT booking_id FROM native_games WHERE student_id=? ORDER BY booking_id DESC').all(studentId).map(r=>Number(r.booking_id));
 return ids.map(bookingId=>({bookingId,games:approvedGamesForStudent(studentId,bookingId)}));
}
