import {decodeWorkspaceRows,workspaceSiteColumns,type WorkspaceCell} from '../../learning/workspace.ts';
import {approveNativeLesson,approvedMaterialIds,approvedRelease,withdrawNativeGames,type GamesDrive} from './games.ts';

/** The Sheet seam. Real Google lives behind it; tests use a double. */
export interface ApprovalSheet {
 read():Promise<{revision:string;grids:Record<string,WorkspaceCell[][]>}>;
 /** Cell writes by 0-based row/column of the grid. Only the site's own status column is ever passed. */
 update(cells:{table:'Materials';row:number;column:number;value:string}[],revision:string):Promise<void>;
}
export interface ReleaseTick {materialId:string;studentId:number;bookingId:number;releaseId:string;fileId:string;contentSha256:string}
export interface SiteStatusRow {materialId:string;status:'approved'|'rejected'|'withdrawn';code?:string}

export const driveFileId=(url:string)=>{try{const u=new URL(url);return u.pathname.match(/\/(?:file\/)?d\/([\w-]{10,200})/)?.[1]??u.searchParams.get('id')??'';}catch{return '';}};
const numeric=(value:unknown,prefix:string)=>{const m=String(value??'').match(new RegExp(`^${prefix}-(\\d+)$`));return m?Number(m[1]):null;};

/** Only Materials and Assignments are read, row by row: a row that cannot be read is skipped and reported (it earns no tick, so its access is withdrawn), and unrelated tabs or tutor-added columns cannot block the pass.
 * Game materials the tutor has approved and published, released to a student through a live assignment.
 * The Sheet rules (published requires approved + release_id + fingerprint; release requires published) are applied per row here, so a row that breaks them simply earns no tick and its access is withdrawn. */
export async function readReleaseTicks(sheet:ApprovalSheet):Promise<{revision:string;ticks:ReleaseTick[];problems:string[]}> {
 const {revision,grids}=await sheet.read(),ticks:ReleaseTick[]=[];
 const materials=decodeWorkspaceRows(grids,'Materials'),assignments=decodeWorkspaceRows(grids,'Assignments'),snapshot={Materials:materials.rows,Assignments:assignments.rows},problems=[...materials.problems,...assignments.problems];
 for(const m of snapshot.Materials){
  if(m.kind!=='game'||!m.release_id||!/^[a-f0-9]{64}$/.test(String(m.content_sha256))||m.review_status!=='approved'||m.publication_status!=='published'||m.audience!=='student'||m.is_demo===true)continue;
  const assignments=snapshot.Assignments.filter(a=>a.material_id===m.material_id&&['assigned','submitted','reviewed'].includes(String(a.status))&&a.is_demo===false);
  const studentId=numeric(m.student_id,'student'),bookingId=assignments.map(a=>numeric(a.lesson_id,'booking')).find(n=>n!==null)??null,fileId=driveFileId(String(m.url));
  if(!assignments.length||studentId===null||bookingId===null||!fileId)continue;
  if(assignments.some(a=>a.student_id!==m.student_id))continue;
  ticks.push({materialId:String(m.material_id),studentId,bookingId,releaseId:String(m.release_id),fileId,contentSha256:String(m.content_sha256)});
 }
 return {revision,ticks,problems};
}

/** Writes only the site_status column of Materials rows it names. Tutor-owned cells are never touched. */
export async function writeSiteStatus(sheet:ApprovalSheet,rows:SiteStatusRow[]):Promise<number> {
 if(!rows.length)return 0;
 const {revision,grids}=await sheet.read(),grid=grids.Materials;
 if(!Array.isArray(grid)||!Array.isArray(grid[0]))throw new Error('site_status_unavailable');
 const key=(h:unknown)=>String(h??'').trim().match(/\[([a-z][a-z0-9_]+)\]$/)?.[1]??String(h??'').trim();
 const keys=grid[0].map(key),idCol=keys.indexOf('material_id'),siteKey=workspaceSiteColumns.Materials[0].key,siteCol=keys.indexOf(siteKey);
 if(idCol<0||siteCol<0||siteCol===idCol)throw new Error('site_status_unavailable');
 const cells:{table:'Materials';row:number;column:number;value:string}[]=[];
 for(const r of rows){
  const row=grid.findIndex((g,i)=>i>0&&String(g[idCol]??'').trim()===r.materialId);
  if(row<0)continue;
  const value=r.code?`${r.status}: ${r.code}`.slice(0,200):r.status;
  if(String(grid[row][siteCol]??'')!==value)cells.push({table:'Materials',row,column:siteCol,value});
 }
 if(cells.length)await sheet.update(cells,revision);
 return cells.length;
}

const safeCode=(e:unknown)=>String((e as Error)?.message??'error').replace(/[^\w :;,.-]/g,'').slice(0,160)||'error';
/** One sync pass: copy newly approved games, withdraw revoked ones, then report back in the site column.
 * Unreadable rows are reported in `problems`; an unreadable Materials or Assignments header returns `error` and withdraws nothing. */
export async function syncNativeGameApprovals(input:{sheet:ApprovalSheet;drive:GamesDrive}) {
 let read:Awaited<ReturnType<typeof readReleaseTicks>>;
 try{read=await readReleaseTicks(input.sheet);}
 catch(e){return {revision:'',approved:0,rejected:0,withdrawn:[] as string[],problems:[] as string[],error:safeCode(e)};}
 const {revision,ticks,problems}=read,status:SiteStatusRow[]=[];
 for(const t of ticks){
  const current=approvedRelease(t.materialId);
  if(current&&current.releaseId===t.releaseId&&current.contentSha256===t.contentSha256){status.push({materialId:t.materialId,status:'approved'});continue;}
  try{
   await approveNativeLesson({bookingId:t.bookingId,studentId:t.studentId,sheetRevision:revision,materialId:t.materialId,releaseId:t.releaseId,fileId:t.fileId,expectedSha256:t.contentSha256,drive:input.drive});
   status.push({materialId:t.materialId,status:'approved'});
  }catch(e){status.push({materialId:t.materialId,status:'rejected',code:safeCode(e)});}
 }
 const live=new Set(ticks.map(t=>t.materialId)),withdrawn:string[]=[];
 for(const id of approvedMaterialIds())if(!live.has(id)){withdrawNativeGames(id);withdrawn.push(id);status.push({materialId:id,status:'withdrawn'});}
 const result={revision,approved:status.filter(s=>s.status==='approved').length,rejected:status.filter(s=>s.status==='rejected').length,withdrawn,problems} as {revision:string;approved:number;rejected:number;withdrawn:string[];problems:string[];error?:string};
 try{await writeSiteStatus(input.sheet,status);}catch(e){result.error=safeCode(e);}
 return result;
}
