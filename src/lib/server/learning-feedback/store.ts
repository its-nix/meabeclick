import {createHash} from 'node:crypto';
import {handle,inTransaction} from '../db.ts';

export type FeedbackState='collecting'|'queued'|'working'|'awaiting-review'|'applying'|'accepted'|'blocked'|'stale'|'rejected'|'cancelled';
export interface FeedbackArtifact {fileId:string;title:string;mimeType:string;kind:'slides'|'homework'|'sheet';bookingId:number|null;sourceVersion:string;state:FeedbackState;feedbackHash:string;createdAt:string;updatedAt:string}
export interface FeedbackReply {id:string;content:string;author?:string;deleted?:boolean;agent?:boolean}
export interface FeedbackComment {id:string;content:string;quotedText?:string;location?:string;author?:string;resolved?:boolean;deleted?:boolean;replies?:FeedbackReply[]}
export interface FeedbackProposal {patches:Array<{targetId:string;oldText:string;newText:string}>;summary:string;policySuggestion?:string;scope?:'artifact'|'future-guidance'|'generator-change';sourceSnapshot?:unknown;reviewBundle?:unknown}
export interface FeedbackRun {id:number;fileId:string;state:Exclude<FeedbackState,'collecting'>;attempts:number;leaseUntil:string|null;sourceRevision:string;contentHash:string;sourceVersion:string;feedbackHash:string;fingerprint:string;comments:FeedbackComment[];proposal:FeedbackProposal|null;validation:Record<string,unknown>|null;result:unknown|null;errorCode:string|null;acceptedAt:string|null;createdAt:string;updatedAt:string}
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const EMPTY=hash('[]');
const stamp=()=>new Date().toISOString();
function limited(value:unknown,max:number,required=true):string {if(typeof value!=='string'||value.length>max||required&&!value.trim())throw Error('feedback_schema');return value;}
function json(value:unknown,max=1024*1024):string {const text=JSON.stringify(value);if(typeof text!=='string'||Buffer.byteLength(text)>max)throw Error('feedback_limit');return text;}
function fileId(value:string){if(!/^[A-Za-z0-9_-]{10,200}$/.test(value))throw Error('feedback_schema');return value;}
function lease(ms=15*60_000){if(!Number.isFinite(ms)||ms<=0||ms>2*60*60_000)throw Error('feedback_lease');return new Date(Date.now()+ms).toISOString();}
function artifact(row:Record<string,unknown>|undefined):FeedbackArtifact|null {return row?{fileId:String(row.file_id),title:String(row.title),mimeType:String(row.mime_type),kind:row.kind as FeedbackArtifact['kind'],bookingId:row.booking_id==null?null:Number(row.booking_id),sourceVersion:String(row.source_version),state:row.state as FeedbackState,feedbackHash:String(row.feedback_hash),createdAt:String(row.created_at),updatedAt:String(row.updated_at)}:null;}
function run(row:Record<string,unknown>|undefined):FeedbackRun|null {return row?{id:Number(row.id),fileId:String(row.file_id),state:row.state as FeedbackRun['state'],attempts:Number(row.attempts),leaseUntil:row.lease_until as string|null,sourceRevision:String(row.source_revision),contentHash:String(row.content_hash),sourceVersion:String(row.source_version),feedbackHash:String(row.feedback_hash),fingerprint:String(row.fingerprint),comments:JSON.parse(String(row.comments)),proposal:row.proposal?JSON.parse(String(row.proposal)):null,validation:row.validation?JSON.parse(String(row.validation)):null,result:row.result?JSON.parse(String(row.result)):null,errorCode:row.error_code as string|null,acceptedAt:row.accepted_at as string|null,createdAt:String(row.created_at),updatedAt:String(row.updated_at)}:null;}
function bookingCurrent(a:FeedbackArtifact){return a.state!=='cancelled'&&(a.bookingId===null||handle().prepare("SELECT 1 FROM bookings_v2 WHERE id=? AND status='confirmed'").get(a.bookingId));}
function invalidate(id:string,now:string){handle().prepare("UPDATE learning_feedback_runs SET state='stale',lease_until=NULL,error_code='feedback_changed',updated_at=? WHERE file_id=? AND state IN ('queued','working','awaiting-review','applying','blocked')").run(now,id);}
function requireArtifact(id:string){const a=getFeedbackArtifact(id);if(!a)throw Error('feedback_not_found');if(!bookingCurrent(a))throw Error('feedback_cancelled');return a;}
export function getFeedbackArtifact(id:string):FeedbackArtifact|null{return artifact(handle().prepare('SELECT * FROM learning_feedback_artifacts WHERE file_id=?').get(id));}
export function listFeedbackArtifacts():FeedbackArtifact[]{return handle().prepare('SELECT * FROM learning_feedback_artifacts ORDER BY created_at,file_id').all().map(r=>artifact(r)!);}
export function registerFeedbackArtifact(input:{fileId:string;title:string;mimeType:string;kind:FeedbackArtifact['kind'];bookingId?:number|null;sourceVersion:string}):FeedbackArtifact {
 fileId(input.fileId);limited(input.title,500);limited(input.sourceVersion,200);const types={slides:'application/vnd.google-apps.presentation',homework:'application/vnd.google-apps.document',sheet:'application/vnd.google-apps.spreadsheet'};
 if(!Object.hasOwn(types,input.kind)||types[input.kind]!==input.mimeType)throw Error('feedback_schema');
 const bookingId=input.bookingId??null;if(bookingId!==null&&(!Number.isSafeInteger(bookingId)||bookingId<=0))throw Error('feedback_schema');
 return inTransaction(()=>{const old=getFeedbackArtifact(input.fileId),now=stamp();
  if(old&&(old.kind!==input.kind||old.mimeType!==input.mimeType||old.bookingId!==bookingId))throw Error('feedback_conflict');
  if(old&&!bookingCurrent(old)||!old&&bookingId!==null&&!handle().prepare("SELECT 1 FROM bookings_v2 WHERE id=? AND status='confirmed'").get(bookingId))throw Error('feedback_cancelled');
  if(old&&old.sourceVersion!==input.sourceVersion){invalidate(input.fileId,now);handle().prepare("UPDATE learning_feedback_artifacts SET state='collecting' WHERE file_id=?").run(input.fileId);}
  handle().prepare(`INSERT INTO learning_feedback_artifacts(file_id,title,mime_type,kind,booking_id,source_version,feedback_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(file_id) DO UPDATE SET title=excluded.title,source_version=excluded.source_version,updated_at=excluded.updated_at`).run(input.fileId,input.title,input.mimeType,input.kind,bookingId,input.sourceVersion,EMPTY,now,now);
  return getFeedbackArtifact(input.fileId)!;
 });
}
function normalizeComment(c:FeedbackComment):FeedbackComment {
 const id=limited(c.id,200);if(!/^[-\w]+(?:\.[-\w]+)*$/.test(id))throw Error('feedback_schema');
 const replies=(c.replies??[]).filter(r=>!r.agent).map(r=>({id:limited(r.id,200),content:limited(r.content,12000,false),...(r.author?{author:limited(r.author,500)}:{}),deleted:!!r.deleted})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 if(replies.length>500||new Set(replies.map(r=>r.id)).size!==replies.length)throw Error('feedback_schema');
 return{id,content:limited(c.content,12000,false),...(c.quotedText?{quotedText:limited(c.quotedText,12000)}:{}),...(c.location?{location:limited(c.location,4000)}:{}),...(c.author?{author:limited(c.author,500)}:{}),resolved:!!c.resolved,deleted:!!c.deleted,replies};
}
export function listFeedbackComments(id:string):FeedbackComment[]{return handle().prepare('SELECT content FROM learning_feedback_comments WHERE file_id=? ORDER BY comment_id').all(id).map(r=>JSON.parse(String(r.content)));}
/** Supply a complete, paginated snapshot. Missing threads become deleted; agent replies and timestamps are not review evidence. */
export function ingestFeedbackComments(id:string,comments:FeedbackComment[]):FeedbackArtifact {
 if(!Array.isArray(comments)||comments.length>1000)throw Error('feedback_limit');const normalized=comments.map(normalizeComment);json(normalized);
 if(new Set(normalized.map(c=>c.id)).size!==normalized.length)throw Error('feedback_schema');
 return inTransaction(()=>{const a=requireArtifact(id),now=stamp(),known=listFeedbackComments(id),ids=new Set(normalized.map(c=>c.id));
  const all=[...normalized,...known.filter(c=>!ids.has(c.id)).map(c=>({...c,deleted:true}))].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  json(all);const fingerprint=hash(json(all));
  for(const c of all){const text=json(c);handle().prepare(`INSERT INTO learning_feedback_comments(file_id,comment_id,content,fingerprint,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(file_id,comment_id) DO UPDATE SET content=excluded.content,fingerprint=excluded.fingerprint,updated_at=excluded.updated_at`).run(id,c.id,text,hash(text),now);}
  if(fingerprint!==a.feedbackHash){
   const latest=listFeedbackReviews(id)[0];
   const preserveAccepted=a.state==='accepted'&&latest?.state==='accepted'&&latest.sourceVersion===a.sourceVersion&&!all.some(c=>!c.resolved&&!c.deleted);
   invalidate(id,now);handle().prepare('UPDATE learning_feedback_artifacts SET feedback_hash=?,state=?,updated_at=? WHERE file_id=?').run(fingerprint,preserveAccepted?'accepted':'collecting',now,id);
  }
  return getFeedbackArtifact(id)!;
 });
}
export function getFeedbackReview(id:number):FeedbackRun|null{return run(handle().prepare('SELECT * FROM learning_feedback_runs WHERE id=?').get(id));}
export function listFeedbackReviews(id?:string):FeedbackRun[]{return handle().prepare('SELECT * FROM learning_feedback_runs WHERE (? IS NULL OR file_id=?) ORDER BY id DESC').all(id??null,id??null).map(r=>run(r)!);}
export function queueFeedbackReview(id:string,sourceRevision:string,contentHash:string,options:{retry?:boolean}={}):FeedbackRun {
 limited(sourceRevision,300);limited(contentHash,200);
 return inTransaction(()=>{const a=requireArtifact(id),now=stamp(),comments=listFeedbackComments(id).filter(c=>!c.deleted&&!c.resolved);
  if(!comments.length)throw Error('feedback_empty');
  const fingerprint=hash(json([a.sourceVersion,a.feedbackHash,sourceRevision,contentHash]));
  const old=run(handle().prepare('SELECT * FROM learning_feedback_runs WHERE file_id=? AND fingerprint=?').get(id,fingerprint));
  if(old){if(options.retry&&['blocked','rejected'].includes(old.state)){if(old.acceptedAt)throw Error('feedback_apply_pending');handle().prepare("UPDATE learning_feedback_runs SET state='queued',error_code=NULL,accepted_at=NULL,updated_at=? WHERE id=?").run(now,old.id);handle().prepare("UPDATE learning_feedback_artifacts SET state='queued',updated_at=? WHERE file_id=?").run(now,id);}return getFeedbackReview(old.id)!;}
  invalidate(id,now);
  const r=handle().prepare(`INSERT INTO learning_feedback_runs(file_id,state,source_revision,content_hash,source_version,feedback_hash,fingerprint,comments,created_at,updated_at) VALUES(?,'queued',?,?,?,?,?,?,?,?)`).run(id,sourceRevision,contentHash,a.sourceVersion,a.feedbackHash,fingerprint,json(comments),now,now);
  handle().prepare("UPDATE learning_feedback_artifacts SET state='queued',updated_at=? WHERE file_id=?").run(now,id);
  return getFeedbackReview(Number(r.lastInsertRowid))!;
 });
}
const CURRENT=`EXISTS(SELECT 1 FROM learning_feedback_artifacts a WHERE a.file_id=learning_feedback_runs.file_id AND a.source_version=learning_feedback_runs.source_version AND a.feedback_hash=learning_feedback_runs.feedback_hash AND a.state<>'cancelled' AND (a.booking_id IS NULL OR EXISTS(SELECT 1 FROM bookings_v2 b WHERE b.id=a.booking_id AND b.status='confirmed')))`;
function stateArtifact(r:FeedbackRun){handle().prepare('UPDATE learning_feedback_artifacts SET state=?,updated_at=? WHERE file_id=?').run(r.state,r.updatedAt,r.fileId);return r;}
export function claimFeedbackReview(input:{id?:number;leaseMs?:number}={}):FeedbackRun|null {
 const now=stamp(),until=lease(input.leaseMs);
 return inTransaction(()=>{const r=run(handle().prepare(`UPDATE learning_feedback_runs SET state='working',attempts=attempts+1,lease_until=?,updated_at=? WHERE id=(SELECT id FROM learning_feedback_runs WHERE (? IS NULL OR id=?) AND (state='queued' OR state='working' AND lease_until<=?) AND ${CURRENT} ORDER BY id LIMIT 1) RETURNING *`).get(until,now,input.id??null,input.id??null,now));return r?stateArtifact(r):null;});
}
function checkedProposal(p:FeedbackProposal):string {
 if(!p||!Array.isArray(p.patches)||p.patches.length>50||p.scope!==undefined&&!['artifact','future-guidance','generator-change'].includes(p.scope))throw Error('feedback_schema');limited(p.summary,6000);
 const keys=new Set<string>();for(const patch of p.patches){limited(patch.targetId,300);limited(patch.oldText,12000);limited(patch.newText,12000);const key=json([patch.targetId,patch.oldText]);if(patch.oldText===patch.newText||keys.has(key))throw Error('feedback_schema');keys.add(key);}
 if(p.policySuggestion!==undefined)limited(p.policySuggestion,1000);return json(p);
}
/** Validation must be the server-checked reviewer result, never a client-supplied approval. */
export function completeFeedbackReview(input:{id:number;attempt:number;proposal:FeedbackProposal;validation:Record<string,unknown>}):FeedbackRun|null {
 const proposal=checkedProposal(input.proposal),validation=json(input.validation);
 if(!input.validation||!['pass','revise','blocked'].includes(String(input.validation.status)))throw Error('feedback_schema');
 const now=stamp(),state=input.validation.status==='pass'?'awaiting-review':'blocked';
 return inTransaction(()=>{const r=run(handle().prepare(`UPDATE learning_feedback_runs SET state=?,proposal=?,validation=?,lease_until=NULL,error_code=?,updated_at=? WHERE id=? AND attempts=? AND state='working' AND lease_until>? AND ${CURRENT} RETURNING *`).get(state,proposal,validation,state==='blocked'?'feedback_validation':null,now,input.id,input.attempt,now));return r?stateArtifact(r):null;});
}
export function failFeedbackReview(input:{id:number;attempt:number;code:string}):FeedbackRun|null {
 if(!/^[a-z0-9_-]{1,80}$/.test(input.code))throw Error('feedback_schema');const now=stamp();
 return inTransaction(()=>{const r=run(handle().prepare(`UPDATE learning_feedback_runs SET state='blocked',error_code=?,lease_until=NULL,updated_at=? WHERE id=? AND attempts=? AND state IN ('working','applying') AND lease_until>? AND ${CURRENT} RETURNING *`).get(input.code,now,input.id,input.attempt,now));return r?stateArtifact(r):null;});
}
/** Call only for an explicit human acceptance. A resumed expired application must reconcile original/new text before further Google writes. */
export function beginFeedbackApply(input:{id:number;sourceRevision:string;contentHash:string;leaseMs?:number}):FeedbackRun|null {
 const now=stamp(),until=lease(input.leaseMs);
 return inTransaction(()=>{const prior=getFeedbackReview(input.id);if(!prior)return null;
  if(prior.sourceRevision!==input.sourceRevision||prior.contentHash!==input.contentHash)throw Error('feedback_conflict');
  if(prior.validation?.status!=='pass')throw Error('feedback_validation');
  const r=run(handle().prepare(`UPDATE learning_feedback_runs SET state='applying',attempts=attempts+1,lease_until=?,accepted_at=COALESCE(accepted_at,?),updated_at=? WHERE id=? AND (state='awaiting-review' OR state='applying' AND lease_until<=? OR state='blocked' AND accepted_at IS NOT NULL) AND ${CURRENT} RETURNING *`).get(until,now,now,input.id,now));return r?stateArtifact(r):null;
 });
}
export function finishFeedbackApply(input:{id:number;attempt:number;result:unknown}):FeedbackRun|null {
 const result=json(input.result),now=stamp();
 return inTransaction(()=>{const r=run(handle().prepare(`UPDATE learning_feedback_runs SET state='accepted',result=?,lease_until=NULL,error_code=NULL,updated_at=? WHERE id=? AND attempts=? AND state='applying' AND accepted_at IS NOT NULL AND lease_until>? AND ${CURRENT} RETURNING *`).get(result,now,input.id,input.attempt,now));return r?stateArtifact(r):null;});
}
export function rejectFeedbackReview(id:number):FeedbackRun|null {
 const now=stamp();return inTransaction(()=>{const prior=getFeedbackReview(id);if(prior?.acceptedAt&&['blocked','applying'].includes(prior.state))throw Error('feedback_apply_pending');const r=run(handle().prepare(`UPDATE learning_feedback_runs SET state='rejected',lease_until=NULL,error_code=NULL,updated_at=? WHERE id=? AND state IN ('queued','working','awaiting-review','blocked') AND ${CURRENT} RETURNING *`).get(now,id));return r?stateArtifact(r):null;});
}
/** Separate human action; accepting a deck does not silently change future lessons. */
export function approveFeedbackPolicy(id:number):{guidance:string[];hash:string} {
 return inTransaction(()=>{const r=getFeedbackReview(id);if(!r||r.state!=='accepted'||!r.acceptedAt||r.validation?.status!=='pass'||!r.proposal?.policySuggestion)throw Error('feedback_policy_state');requireArtifact(r.fileId);limited(r.proposal.policySuggestion,1000);
  handle().prepare('INSERT INTO learning_feedback_policies(run_id,guidance,created_at) VALUES(?,?,?) ON CONFLICT(run_id) DO NOTHING').run(id,r.proposal.policySuggestion,stamp());return acceptedFeedbackRules();
 });
}
export function revokeFeedbackPolicy(id:number):{guidance:string[];hash:string} {
 handle().prepare('UPDATE learning_feedback_policies SET revoked_at=COALESCE(revoked_at,?) WHERE run_id=?').run(stamp(),id);return acceptedFeedbackRules();
}
export function acceptedFeedbackRules():{guidance:string[];hash:string} {const rows=handle().prepare('SELECT id,run_id,guidance FROM learning_feedback_policies WHERE revoked_at IS NULL ORDER BY id').all();return{guidance:[...new Set(rows.map(r=>String(r.guidance)))],hash:hash(json(rows))};}

/** Only delivery metadata is retried here; a notification retry never spends another model call. */
export function claimFeedbackNotification(runId:number,phase:string,leaseMs=10*60_000):{attempt:number}|null {
 if(!Number.isSafeInteger(runId)||runId<=0||!/^[a-z0-9._-]{1,100}$/.test(phase))throw Error('feedback_schema');
 if(!Number.isFinite(leaseMs)||leaseMs<=0||leaseMs>10*60_000)throw Error('feedback_lease');
 const now=stamp(),until=lease(leaseMs);
 return inTransaction(()=>{
  if(!getFeedbackReview(runId))return null;
  handle().prepare(`INSERT INTO learning_feedback_notifications(run_id,phase,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(run_id,phase) DO NOTHING`).run(runId,phase,now,now);
  const row=handle().prepare(`UPDATE learning_feedback_notifications SET state='working',attempts=attempts+1,lease_until=?,updated_at=? WHERE run_id=? AND phase=? AND (state='pending' OR state='working' AND lease_until<=?) RETURNING attempts`).get(until,now,runId,phase,now);
  return row?{attempt:Number(row.attempts)}:null;
 });
}
export function finishFeedbackNotification(runId:number,phase:string,attempt:number):boolean {
 if(!Number.isSafeInteger(runId)||runId<=0||!/^[a-z0-9._-]{1,100}$/.test(phase)||!Number.isSafeInteger(attempt)||attempt<=0)throw Error('feedback_schema');
 const now=stamp();
 return !!handle().prepare(`UPDATE learning_feedback_notifications SET state='completed',lease_until=NULL,updated_at=? WHERE run_id=? AND phase=? AND attempts=? AND state='working' AND lease_until>?`).run(now,runId,phase,attempt,now).changes;
}
/** Preserve late verification evidence without granting approval or changing cancellation/stale state. */
export function recordFeedbackEvidence(input:{id:number;attempt:number;result:unknown}):boolean {
 const result=json(input.result),now=stamp();
 if(!Number.isSafeInteger(input.id)||input.id<=0||!Number.isSafeInteger(input.attempt)||input.attempt<=0)throw Error('feedback_schema');
 return !!handle().prepare('UPDATE learning_feedback_runs SET result=?,updated_at=? WHERE id=? AND attempts=?').run(result,now,input.id,input.attempt).changes;
}
export function listPendingFeedbackNotifications(limit=50):Array<{runId:number;phase:string}> {
 if(!Number.isSafeInteger(limit)||limit<1||limit>500)throw Error('feedback_limit');
 return handle().prepare(`SELECT run_id,phase FROM learning_feedback_notifications WHERE state='pending' OR state='working' AND lease_until<=? ORDER BY updated_at,run_id,phase LIMIT ?`).all(stamp(),limit).map(row=>({runId:Number(row.run_id),phase:String(row.phase)}));
}
export function listFeedbackPolicies():Array<{runId:number;guidance:string;revokedAt:string|null}> {
 return handle().prepare('SELECT run_id,guidance,revoked_at FROM learning_feedback_policies ORDER BY id').all().map(row=>({runId:Number(row.run_id),guidance:String(row.guidance),revokedAt:row.revoked_at as string|null}));
}
