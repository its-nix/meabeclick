/** The shared contract for the native teaching register and its programmatic reader. */
export type WorkspaceCell = string | number | boolean | null;
export type WorkspaceRow = Record<string,string|boolean>;
export interface WorkspaceColumn {key:string; label:string; required?:boolean; options?:readonly string[]; kind?:'date'|'instant'|'url'|'boolean'}
const col=(key:string,label:string,extra:Omit<WorkspaceColumn,'key'|'label'>={}):WorkspaceColumn=>({key,label,...extra});
const id=(key:string,label:string)=>col(key,label,{required:true});
const demo=col('is_demo','רשומת הדגמה',{required:true,kind:'boolean'});
export const workspaceTables:Record<string,readonly WorkspaceColumn[]>={
 Students:[id('student_id','מזהה תלמיד'),id('display_name','שם התלמיד'),id('subject','מקצוע'),id('education_level','שלב לימוד'),col('track','מסלול'),col('goals','מטרות'),col('profile_url','פרופיל למורה',{kind:'url'}),col('folder_url','תיקיית התלמיד',{kind:'url'}),col('status','מצב',{required:true,options:['active','paused','archived']}),demo],
 Materials:[id('material_id','מזהה חומר'),id('title','שם החומר'),col('kind','סוג',{required:true,options:['presentation','homework','game','lesson_brief','teacher_guide']}),col('provider','מערכת',{required:true,options:['google_slides','google_docs','website']}),col('url','קישור לחומר',{required:true,kind:'url'}),col('review_status','בדיקת תוכן',{required:true,options:['draft','review','approved','retired']}),col('publication_status','פרסום',{required:true,options:['draft','published','retired']}),col('audience','קהל',{required:true,options:['staff','student']}),col('student_id','מיועד לתלמיד'),id('topic','נושא'),col('education_level','שלב לימוד'),col('release_id','מזהה מהדורה'),col('content_sha256','טביעת תוכן'),demo],
 Lessons:[id('lesson_id','מזהה שיעור'),id('student_id','מזהה תלמיד'),col('date','תאריך',{required:true,kind:'date'}),id('goals','מטרות השיעור'),col('status','מצב',{required:true,options:['planned','delivered','cancelled']}),col('tutor_note','הערת המורה'),demo],
 Assignments:[id('assignment_id','מזהה הקצאה'),id('student_id','מזהה תלמיד'),id('lesson_id','מזהה שיעור'),id('material_id','מזהה חומר'),col('due_date','תאריך יעד',{kind:'date'}),col('status','מצב',{required:true,options:['draft','assigned','submitted','reviewed','cancelled']}),demo],
 Progress:[id('evidence_id','מזהה תצפית'),id('student_id','מזהה תלמיד'),id('skill','מיומנות'),id('lesson_id','מזהה שיעור'),col('assignment_id','מזהה הקצאה'),col('outcome','תוצאה',{required:true,options:['needs_review','practising','demonstrated']}),col('support','רמת תמיכה',{required:true,options:['none','guided','independent']}),col('evidence_type','מקור התצפית',{required:true,options:['planning_note','tutor_observation','checked_answer']}),col('evidence_url','קישור לראיה',{kind:'url'}),id('note','תיאור הראיה'),col('observed_at','מועד התצפית',{required:true,kind:'instant'}),demo]
};
export type WorkspaceTable=keyof typeof workspaceTables;
export interface WorkspaceSnapshot {version:1;Students:WorkspaceRow[];Materials:WorkspaceRow[];Lessons:WorkspaceRow[];Assignments:WorkspaceRow[];Progress:WorkspaceRow[]}
const names=Object.keys(workspaceTables) as (keyof Omit<WorkspaceSnapshot,'version'>)[];
export const workspaceHeader=(column:WorkspaceColumn)=>`${column.label} [${column.key}]`;
export function decodeWorkspace(grids:Record<string,WorkspaceCell[][]>,version:number):WorkspaceSnapshot {
 if(version!==1)throw Error('unsupported workspace schema version');
 const snapshot={version:1} as WorkspaceSnapshot;
 for(const name of names){
  const grid=grids[name];if(!Array.isArray(grid)||!Array.isArray(grid[0]))throw Error(`${name}: missing header`);
  const keys=grid[0].map(h=>String(h??'').trim().match(/\[([a-z][a-z0-9_]+)\]$/)?.[1]??String(h??'').trim());
  const expected=workspaceTables[name].map(c=>c.key);
  for(const key of expected)if(keys.filter(k=>k===key).length!==1)throw Error(`${name}: missing or duplicate column ${key}`);
  for(const key of keys)if(key&&!expected.includes(key))throw Error(`${name}: unknown column ${key}`);
  snapshot[name]=grid.slice(1).filter(row=>row.some(v=>v!==null&&String(v).trim()!=='')).map((row,i)=>{
   if(row.some((value,index)=>!keys[index]&&value!==null&&value!==undefined&&String(value).trim()!==''))throw Error(`${name} row ${i+2}: populated column has no key`);
   const record:WorkspaceRow={};for(const c of workspaceTables[name]){const raw=row[keys.indexOf(c.key)];if(c.kind==='boolean'){const v=String(raw??'').toLowerCase();if(!['true','false'].includes(v))throw Error(`${name} row ${i+2}: invalid ${c.key}`);record[c.key]=v==='true';}else record[c.key]=String(raw??'').trim();}return record;
  });
 }
 const problems=workspaceProblems(snapshot);if(problems.length)throw Error(problems.join('; '));return snapshot;
}
function validDate(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
function safeUrl(value:string){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}}
function googleUrl(value:string,kind:'profile'|'folder'|'google_docs'|'google_slides'){
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(kind==='folder'?u.hostname==='drive.google.com'&&/^\/drive\/folders\/[\w-]+\/?$/.test(u.pathname):u.hostname==='docs.google.com'&&new RegExp(`^/${kind==='google_slides'?'presentation':'document'}/d/[\\w-]+(?:/|$)`).test(u.pathname));}catch{return false;}
}
export function workspaceProblems(snapshot:WorkspaceSnapshot):string[]{
 const issues:string[]=[];if(!snapshot||snapshot.version!==1)return ['unsupported workspace schema version'];
 const maps:Record<string,Map<string,WorkspaceRow>>={};
 for(const name of names){
  const rows=snapshot[name];if(!Array.isArray(rows)){issues.push(`${name}: rows required`);continue;}
  if(rows.length>5000)issues.push(`${name}: register exceeds 5000 records`);
  const key=workspaceTables[name][0].key,seen=new Map<string,WorkspaceRow>();maps[name]=seen;
  for(const [i,row]of rows.entries()){
   const at=`${name}[${i+2}]`;if(!row||typeof row!=='object'){issues.push(`${at}: record required`);continue;}
   for(const c of workspaceTables[name]){
    const value=row[c.key];if(c.kind==='boolean'){if(typeof value!=='boolean')issues.push(`${at}.${c.key}: boolean required`);continue;}
    if(value!==undefined&&typeof value!=='string'){issues.push(`${at}.${c.key}: text required`);continue;}
    const text=String(value??'');if(c.required&&!text.trim())issues.push(`${at}.${c.key}: required`);if(text.length>4000)issues.push(`${at}.${c.key}: exceeds 4000 characters`);
    if(text&&c.options&&!c.options.includes(text))issues.push(`${at}.${c.key}: invalid option`);
    if(text&&c.kind==='url'&&!safeUrl(text))issues.push(`${at}.${c.key}: HTTPS URL required`);
    if(text&&c.kind==='date'&&!validDate(text))issues.push(`${at}.${c.key}: ISO date required`);
    if(text&&c.kind==='instant'&&(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(text)||!Number.isFinite(Date.parse(text))||new Date(text).toISOString()!==(text.includes('.')?text:text.replace('Z','.000Z'))))issues.push(`${at}.${c.key}: UTC timestamp required`);
   }
   const value=String(row[key]??'');if(value&&!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/.test(value))issues.push(`${at}.${key}: stable ID required`);
   if(seen.has(value))issues.push(`${at}.${key}: duplicate ID`);else if(value)seen.set(value,row);
  }
 }
 if(names.some(n=>!maps[n]))return issues;
 const link=(name:string,row:WorkspaceRow,field:string,target:string,optional=false)=>{
  const value=String(row[field]??'');if(!value&&optional)return undefined;
  const found=maps[target].get(value);if(!found)issues.push(`${name}.${field}: referenced ${target} record not found`);
  else if(found.is_demo!==row.is_demo)issues.push(`${name}.${field}: demo isolation mismatch`);return found;
 };
 for(const row of snapshot.Students){if(!row||typeof row!=='object')continue;for(const [key,kind]of [['profile_url','profile'],['folder_url','folder']]as const)if(row[key]&&!googleUrl(String(row[key]),kind))issues.push(`Students.${key}: Google ${kind} URL required`);}
 for(const row of snapshot.Materials){
  if(!row||typeof row!=='object')continue;link('Materials',row,'student_id','Students',true);
  if(['google_docs','google_slides'].includes(String(row.provider))&&!googleUrl(String(row.url),row.provider as 'google_docs'|'google_slides'))issues.push('Materials.url: provider does not match Google file URL');
  if(row.publication_status==='published'){
   if(row.review_status!=='approved')issues.push('Materials: published material must be approved');
   if(!row.release_id)issues.push('Materials.release_id: published release required');
   if(!/^[a-f0-9]{64}$/.test(String(row.content_sha256??'')))issues.push('Materials.content_sha256: published content fingerprint required');
  }
 }
 for(const row of snapshot.Lessons)if(row&&typeof row==='object')link('Lessons',row,'student_id','Students');
 for(const row of snapshot.Assignments){
  if(!row||typeof row!=='object')continue;link('Assignments',row,'student_id','Students');const lesson=link('Assignments',row,'lesson_id','Lessons'),material=link('Assignments',row,'material_id','Materials');
  if(lesson&&lesson.student_id!==row.student_id)issues.push('Assignments: lesson must belong to the same student');
  if(material?.student_id&&material.student_id!==row.student_id)issues.push('Assignments: material belongs to another student');
  if(row.is_demo&&row.status!=='draft')issues.push('Assignments: demo assignments must remain draft');
  if(!['draft','cancelled'].includes(String(row.status))&&material&&(material.publication_status!=='published'||material.review_status!=='approved'||material.audience!=='student'))issues.push('Assignments: release requires approved published material with student audience');
 }
 for(const row of snapshot.Progress){
  if(!row||typeof row!=='object')continue;link('Progress',row,'student_id','Students');const lesson=link('Progress',row,'lesson_id','Lessons'),assignment=link('Progress',row,'assignment_id','Assignments',true);
  if(lesson&&lesson.student_id!==row.student_id||assignment&&assignment.student_id!==row.student_id)issues.push('Progress: evidence must belong to the same student');
  if(assignment&&assignment.lesson_id!==row.lesson_id)issues.push('Progress: assignment must belong to the evidence lesson');
  if(row.outcome==='demonstrated'&&(row.support!=='independent'||!['tutor_observation','checked_answer'].includes(String(row.evidence_type))))issues.push('Progress: demonstrated outcome requires independent assessment evidence');
 }
 return issues;
}
export function workspaceCounts(snapshot:WorkspaceSnapshot){return Object.fromEntries(names.map(n=>[n,snapshot[n].filter(row=>row.is_demo===false).length]));}
export function learningContext(snapshot:WorkspaceSnapshot,studentId:string,options:{includeDemo?:boolean}={}){
 const issues=workspaceProblems(snapshot);if(issues.length)throw Error(issues.join('; '));
 const student=snapshot.Students.find(s=>s.student_id===studentId);if(!student)throw Error('student not found');if(student.is_demo&&!options.includeDemo)throw Error('demo student requires explicit includeDemo');
 const lessons=snapshot.Lessons.filter(r=>r.student_id===studentId),assignments=snapshot.Assignments.filter(r=>r.student_id===studentId),observations=snapshot.Progress.filter(r=>r.student_id===studentId);
 const ids=new Set(assignments.filter(a=>!['draft','cancelled'].includes(String(a.status))).map(a=>a.material_id));
 const publishedMaterials=snapshot.Materials.filter(m=>ids.has(m.material_id)&&m.review_status==='approved'&&m.publication_status==='published'&&m.audience==='student');
 return {student,lessons,assignments,observations,publishedMaterials,publicationVerification:'declared_register_state_only' as const};
}
