/** Explicit learning-content export; never a database or DATA_DIR dump. */
import {createHash} from 'node:crypto';
import {createReadStream,constants} from 'node:fs';
import {lstat,readdir,realpath,open} from 'node:fs/promises';
import {join,resolve,relative,extname,basename} from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import {handle} from '../db.ts';
import {dataDir} from '../content.ts';

export interface CentralArtifact {
 key:string;name:string;folders:string[];mimeType:string;sha256:string;md5:string;size:number;
 role:string;lesson:string|null;version:number|null;
 read:(offset?:number,length?:number)=>Promise<Buffer>;
}
export interface CentralStudent {id:number;code:string;name:string;goals:string|null;style:string|null;notes:string|null;subjects:string;progress:number;progress_note:string|null}
export interface LearningInventory {artifacts:CentralArtifact[];students:CentralStudent[];progress:Array<Array<string|number|boolean|null>>;fingerprint:string;lessonSlugs:string[]}
const sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const MAX_ROWS=100000,MAX_INLINE=64*1024*1024,MAX_FILES=100000;

// Only named educational fields may leave the app. New credential columns
// cannot become exported accidentally when the operational schema changes.
const columns={
 students_v2:'id code name emoji progress progress_note goals style notes created_at',
 enrollments:'id student_id subject level teacher_id',
 lessons:'id slug student subject level topic title context at lesson_at status problem slides homework games',
 lessons_v2:'id student_id enrollment_id teacher_id slug topic title context summary status problem slides_path lesson_at created_at',
 lesson_materials:'id lesson_slug kind version origin published_at created_at',
 homework:'id lesson_id student_id task template data_id assigned_at due_at submitted_at submitted_by graded_at grade graded_by node_id booking_id held_until answer',
 results_v2:'id student_id at data_id template score total tries stars seconds missed hints',
 results:'id student at data_id template score total tries stars seconds missed',
 learning_assignments:'lesson_slug student_id booking_id node_id held_until practice_state practice_material_slug',
 learning_progress:'student_id lesson_slug fingerprint scene_id mode attempts hints solved visited updated_at',
 learning_events:'id student_id lesson_slug fingerprint scene_id mode action correct created_at',
 plans:'id student_id enrollment_id template_id template_version goal exam_date focus created_at',
 plan_nodes:'id plan_id key parent_id kind title position visibility',
 plan_prereqs:'skill_id requires_id',
 plan_events:'id plan_id node_id type status visibility note evidence source report_id corrects at',
 lesson_reports:'id booking_id student_id enrollment_id note created_at updated_at',
 lesson_report_notes:'id report_id note at teaching_coverage',
 lesson_requests:'id booking_id student_id source text at',
 game_skills:'student_id data_id node_id at',
 lesson_game_assignments:'id lesson_id student_id template title position status draft_revision published_data_id node_id created_at updated_at published_at',
 lesson_game_revisions:'data_id assignment_id published_at',
 lesson_engines:'lesson_slug engine at',
 library_items:'id template_id skill_key slug status problem updated_at',
 library_uses:'lesson_slug master_slug template_id skill_key at',
} as const;

const mime:Record<string,string>={'.html':'text/html','.json':'application/json','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.mp4':'video/mp4','.webm':'video/webm','.mp3':'audio/mpeg','.pdf':'application/pdf','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.txt':'text/plain','.md':'text/markdown'};

export async function learningInventory(options:{db?:DatabaseSync;dataRoot?:string;staticRoot?:string;templatesRoot?:string;gamesRoot?:string}={}):Promise<LearningInventory>{
 const db=options.db??handle(),artifacts:CentralArtifact[]=[];
 const records:Record<string,Record<string,any>[]>={};
 for(const[table,list]of Object.entries(columns)){
  const available=new Set((db.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[]).map(c=>c.name));
  const selected=list.split(' ').filter(k=>available.has(k));
  if(!selected.length)throw Error('source_schema');
  const order=selected.includes('id')?'id':selected.slice(0,4).join(',');
  const rows=db.prepare(`SELECT ${selected.join(',')} FROM ${table} ORDER BY ${order} LIMIT ${MAX_ROWS+1}`).all() as Record<string,any>[];
  if(rows.length>MAX_ROWS)throw Error('source_limit');
  records[table]=rows;
 }
 let inlineBytes=0;
 function inline(key:string,name:string,folders:string[],type:string,content:string,role:string,lesson:string|null=null,version:number|null=null){
  const bytes=Buffer.from(content);inlineBytes+=bytes.length;if(inlineBytes>MAX_INLINE)throw Error('source_limit');
  artifacts.push({key,name,folders,mimeType:type,sha256:sha(bytes),md5:createHash('md5').update(bytes).digest('hex'),size:bytes.length,role,lesson,version,read:async(offset=0,length=bytes.length-offset)=>bytes.subarray(offset,offset+length)});
 }
 inline('records/learning.json','Learning records.json',['Records'],'application/json',JSON.stringify({version:1,...records},null,2),'records');
 for(const row of db.prepare('SELECT id,lesson_slug,kind,version,content,teacher_only FROM lesson_materials ORDER BY id').iterate() as Iterable<{id:number;lesson_slug:string;kind:string;version:number;content:string;teacher_only:string|null}>){
  const extension=row.kind==='slides'?'html':'json',type=row.kind==='slides'?'text/html':'application/json';
  const folders=['Lessons',row.lesson_slug,'Versions'];
  inline(`materials/${row.id}`,`${row.kind} — v${row.version}.${extension}`,folders,type,row.content,row.kind,row.lesson_slug,row.version);
  if(row.teacher_only)inline(`material-notes/${row.id}`,`Teacher notes — v${row.version}.json`,folders,'application/json',row.teacher_only,'teacher-notes',row.lesson_slug,row.version);
 }
 for(const row of db.prepare('SELECT id,body FROM game_filler ORDER BY id').iterate() as Iterable<{id:string;body:string}>){
  inline(`catalogue/${row.id}`,`${row.id}.json`,['Game catalogue'],'application/json',row.body,'game-template');
 }
 for(const row of db.prepare('SELECT a.id,a.draft_body,a.draft_revision,l.slug FROM lesson_game_assignments a JOIN lessons l ON l.id=a.lesson_id ORDER BY a.id').iterate() as Iterable<{id:string;draft_body:string;draft_revision:number;slug:string}>){
  inline(`game-drafts/${row.id}`,`${row.id} — draft.json`,['Games','Drafts',row.slug],'application/json',row.draft_body,'game-draft',row.slug,row.draft_revision);
 }
 for(const row of db.prepare('SELECT r.data_id,r.body,l.slug FROM lesson_game_revisions r JOIN lesson_game_assignments a ON a.id=r.assignment_id JOIN lessons l ON l.id=a.lesson_id ORDER BY r.data_id').iterate() as Iterable<{data_id:string;body:string;slug:string}>){
  inline(`game-revisions/${row.data_id}`,`${row.data_id}.json`,['Games','Published',row.slug],'application/json',row.body,'game',row.slug);
 }
 // These examples live in the build, not the runtime database/filesystem.
 const corpora=[['baseline',(await import('../learning-review-corpus.json',{with:{type:'json'}})).default],['v2',(await import('../learning-review-v2-corpus.json',{with:{type:'json'}})).default],['visual-pilot',(await import('../learning-pilot-corpus.json',{with:{type:'json'}})).default]] as const;
 for(const[key,corpus]of corpora)inline(`review/${key}`,`${key}.json`,['Review'],'application/json',JSON.stringify(corpus),'review');
 const root=resolve(options.dataRoot??dataDir()),staticRoot=resolve(options.staticRoot??'static');
 const sources=[
  {root:join(root,'lessons'),key:'files/lessons',folders:['Lessons files'],role:'presentation'},
  {root:join(root,'drafts'),key:'files/drafts',folders:['Drafts'],role:'draft'},
  {root:join(root,'games-data'),key:'files/games-data',folders:['Games'],role:'game'},
  ...['learning-assets','learning-media','learning-sources','question-sources'].map(name=>({root:join(staticRoot,name),key:`resources/${name}`,folders:['Resources',name],role:'resource'})),
  {root:join(staticRoot,'images','logos'),key:'resources/logos',folders:['Resources','Brand'],role:'resource'},
  {root:resolve(options.templatesRoot??'templates/plans'),key:'curriculum',folders:['Curriculum'],role:'curriculum'},
  {root:resolve(options.gamesRoot??'games'),key:'game-registry',folders:['Game catalogue'],role:'game-template'},
 ];
 for(const source of sources){
  let base;
  try{base=await lstat(source.root);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')continue;throw Error('source_read');}
  if(base.isSymbolicLink()||!base.isDirectory())throw Error('source_path');
  const basePath=await realpath(source.root);
  async function walk(directory:string){
   const names=(await readdir(directory)).sort();
   for(const name of names){
    if(name.startsWith('.')||/^(service-account|credentials|auth\.json)/i.test(name))continue;
    const path=join(directory,name),stat=await lstat(path);
    if(stat.isSymbolicLink())throw Error('source_path');
    if(stat.isDirectory()){await walk(path);continue;}
    const type=mime[extname(name).toLowerCase()];if(!type||!stat.isFile())continue;
    if(artifacts.length>=MAX_FILES)throw Error('source_limit');
    const canonical=await realpath(path);
    if(!canonical.startsWith(basePath+'/'))throw Error('source_path');
    const hash=createHash('sha256'),checksum=createHash('md5');
    for await(const chunk of createReadStream(canonical)){hash.update(chunk);checksum.update(chunk);}
    const after=await lstat(canonical);
    if(after.ino!==stat.ino||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)throw Error('source_changed');
    const rel=relative(basePath,canonical).split('\\').join('/');
    artifacts.push({key:`${source.key}/${rel}`,name:basename(canonical),folders:[...source.folders,...rel.split('/').slice(0,-1)],mimeType:type,sha256:hash.digest('hex'),md5:checksum.digest('hex'),size:stat.size,role:source.role,lesson:source.role==='presentation'?rel.split('/')[0]:null,version:null,
     read:async(offset=0,length=stat.size-offset)=>{
      if(await realpath(path)!==canonical)throw Error('source_path');
      const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
      try{
       const current=await file.stat();if(current.ino!==stat.ino||current.size!==stat.size||current.mtimeMs!==stat.mtimeMs)throw Error('source_changed');
       const bytes=Buffer.alloc(length);let at=0;
       while(at<length){const read=await file.read(bytes,at,length-at,offset+at);if(!read.bytesRead)throw Error('source_changed');at+=read.bytesRead;}
       return bytes;
      }finally{await file.close();}
     }});
   }
  }
  await walk(source.root);
 }
 const students=records.students_v2.map(row=>({id:row.id,code:row.code,name:row.name,goals:row.goals??null,style:row.style??null,notes:row.notes??null,progress:row.progress,progress_note:row.progress_note??null,subjects:records.enrollments.filter(e=>e.student_id===row.id).map(e=>[e.subject,e.level].filter(Boolean).join(' · ')).join(', ')}));
 const progress:Array<Array<string|number|boolean|null>>=[
  ...records.plan_events.map(e=>['plan',e.id,records.plans.find(p=>p.id===e.plan_id)?.student_id??null,e.node_id??null,e.status??e.type,e.evidence??null,e.note??null,e.at]),
  ...records.results_v2.map(e=>['game',e.id,e.student_id,e.data_id,e.score,e.total,e.missed,e.at]),
  ...records.homework.map(e=>['homework',e.id,e.student_id,e.data_id??e.task,e.grade??(e.submitted_at?'submitted':'assigned'),null,null,e.graded_at??e.submitted_at??e.assigned_at]),
  ...records.learning_progress.map(e=>['activity',[e.lesson_slug,e.fingerprint,e.scene_id].join(':'),e.student_id,e.lesson_slug,e.solved===1?'solved':'in-progress',e.attempts,`hints:${e.hints}; visited:${e.visited}`,e.updated_at]),
 ];
 return {artifacts,students,progress,lessonSlugs:[...new Set([...records.lessons,...records.lessons_v2].map(l=>l.slug as string))].sort(),fingerprint:sha(JSON.stringify(artifacts.map(a=>[a.key,a.sha256])))};
}
