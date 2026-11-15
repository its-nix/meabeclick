import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
process.env.DB_PATH=join(mkdtempSync(join(tmpdir(),'learning-feedback-')),'db.sqlite');
const S=await import('../../src/lib/server/learning-feedback/store.ts');
const {handle}=await import('../../src/lib/server/db.ts');
const E=await import('../../src/lib/server/entities.ts');
let serial=0;
function file(bookingId=null){const fileId=`feedback-file-${++serial}`;S.registerFeedbackArtifact({fileId,title:'Synthetic lesson',kind:'slides',mimeType:'application/vnd.google-apps.presentation',bookingId,sourceVersion:'source-v1'});S.ingestFeedbackComments(fileId,[{id:'comment1',content:'Explain the bridge more clearly',quotedText:'100%',replies:[]}]);return fileId;}
const proposal={summary:'Clarified the worked bridge',patches:[{targetId:'slide1:text1',oldText:'Old sentence',newText:'Clear sentence'}],policySuggestion:'Show a worked example before asking the learner to work independently.'};
function ready(id){return S.queueFeedbackReview(id,'revision1','content-hash1');}
function reviewed(id){const q=ready(id),c=S.claimFeedbackReview({id:q.id});assert.ok(c);return S.completeFeedbackReview({id:c.id,attempt:c.attempts,proposal,validation:{status:'pass',model:'synthetic-reviewer'}});}
function accept(r){const a=S.beginFeedbackApply({id:r.id,sourceRevision:r.sourceRevision,contentHash:r.contentHash});assert.ok(a);return S.finishFeedbackApply({id:a.id,attempt:a.attempts,result:{revision:'revision2',verified:true}});}
test('registration and Ready are replay safe, and ordinary acceptance never activates policy',()=>{
 const id=file();const a=S.getFeedbackArtifact(id);S.registerFeedbackArtifact({...a});assert.equal(S.listFeedbackArtifacts().filter(a=>a.fileId===id).length,1);
 const q=ready(id);assert.equal(ready(id).id,q.id);assert.equal(S.listFeedbackReviews(id).length,1);
 const c=S.claimFeedbackReview({id:q.id});assert.equal(c.state,'working');assert.equal(S.claimFeedbackReview({id:q.id}),null);
 const r=S.completeFeedbackReview({id:c.id,attempt:c.attempts,proposal,validation:{status:'pass'}});assert.equal(r.state,'awaiting-review');assert.throws(()=>S.approveFeedbackPolicy(r.id),/policy_state/);
 assert.equal(accept(r).state,'accepted');assert.equal(S.acceptedFeedbackRules().guidance.length,0);assert.equal(ready(id).id,q.id);assert.equal(S.getFeedbackReview(q.id).state,'accepted');
 const policy=S.approveFeedbackPolicy(q.id);assert.deepEqual(policy.guidance,[proposal.policySuggestion]);assert.equal(S.approveFeedbackPolicy(q.id).hash,policy.hash);
});
test('edited, deleted and new human replies reopen feedback but preserve accepted audits',()=>{
 const id=file();const original=reviewed(id);accept(original);
 S.ingestFeedbackComments(id,[{id:'comment1',content:'Actually show TWO worked examples',quotedText:'100%'}]);assert.equal(S.getFeedbackArtifact(id).state,'collecting');assert.equal(S.getFeedbackReview(original.id).state,'accepted');
 const q=ready(id);assert.notEqual(q.id,original.id);const active=S.claimFeedbackReview({id:q.id});
 S.ingestFeedbackComments(id,[{id:'comment1',content:'Actually show TWO worked examples',quotedText:'100%',replies:[{id:'reply1',content:'The group-size example is the missing step',author:'Tutor'}]}]);
 assert.equal(S.getFeedbackReview(q.id).state,'stale');assert.equal(S.completeFeedbackReview({id:q.id,attempt:active.attempts,proposal,validation:{status:'pass'}}),null);
 S.ingestFeedbackComments(id,[]);assert.equal(S.listFeedbackComments(id)[0].deleted,true);assert.throws(()=>ready(id),/feedback_empty/);
});
test('agent replies and collection timestamps cannot trigger another review',()=>{
 const id=file();const q=ready(id),before=S.getFeedbackArtifact(id).feedbackHash;
 S.ingestFeedbackComments(id,[{id:'comment1',content:'Explain the bridge more clearly',quotedText:'100%',modifiedTime:'later',replies:[{id:'agentReply1',content:'Proposed fix ready',agent:true}]}]);
 assert.equal(S.getFeedbackArtifact(id).feedbackHash,before);assert.equal(ready(id).id,q.id);assert.equal(S.getFeedbackReview(q.id).state,'queued');
});
test('expired leases recover without allowing a stale worker to save a proposal or application',()=>{
 const id=file(),q=ready(id),first=S.claimFeedbackReview({id:q.id});
 handle().prepare("UPDATE learning_feedback_runs SET lease_until='2000-01-01T00:00:00.000Z' WHERE id=?").run(q.id);
 const second=S.claimFeedbackReview({id:q.id});assert.equal(second.attempts,first.attempts+1);
 assert.equal(S.completeFeedbackReview({id:q.id,attempt:first.attempts,proposal,validation:{status:'pass'}}),null);
 const review=S.completeFeedbackReview({id:q.id,attempt:second.attempts,proposal,validation:{status:'pass'}});
 const apply=S.beginFeedbackApply({id:q.id,sourceRevision:review.sourceRevision,contentHash:review.contentHash});
 handle().prepare("UPDATE learning_feedback_runs SET lease_until='2000-01-01T00:00:00.000Z' WHERE id=?").run(q.id);
 const resumed=S.beginFeedbackApply({id:q.id,sourceRevision:review.sourceRevision,contentHash:review.contentHash});assert.ok(resumed.attempts>apply.attempts);
 assert.equal(S.finishFeedbackApply({id:q.id,attempt:apply.attempts,result:{wrong:true}}),null);
 assert.equal(S.finishFeedbackApply({id:q.id,attempt:resumed.attempts,result:{reconciled:true}}).state,'accepted');
});
test('acceptance rejects stale native revisions, new comments and failed validation',()=>{
 const id=file(),r=reviewed(id);
 assert.throws(()=>S.beginFeedbackApply({id:r.id,sourceRevision:'changed-revision',contentHash:r.contentHash}),/conflict/);
 assert.throws(()=>S.beginFeedbackApply({id:r.id,sourceRevision:r.sourceRevision,contentHash:'changed-hash'}),/conflict/);
 S.ingestFeedbackComments(id,[{id:'comment1',content:'New feedback while approval was pending'}]);assert.equal(S.beginFeedbackApply({id:r.id,sourceRevision:r.sourceRevision,contentHash:r.contentHash}),null);
 const q=ready(id),c=S.claimFeedbackReview({id:q.id});const blocked=S.completeFeedbackReview({id:q.id,attempt:c.attempts,proposal,validation:{status:'revise'}});assert.equal(blocked.state,'blocked');assert.throws(()=>S.beginFeedbackApply({id:q.id,sourceRevision:q.sourceRevision,contentHash:q.contentHash}),/validation/);
 assert.equal(ready(id).state,'blocked');assert.equal(S.queueFeedbackReview(id,q.sourceRevision,q.contentHash,{retry:true}).state,'queued');
});
test('cancellation fences claims, reviewer completion, acceptance and future collection',()=>{
 const account=E.createAccount({name:'Synthetic',credential:'feedback-test'}),student=E.createStudent({code:'feedback-test',name:'Synthetic',accountId:account.id,credential:'feedback-test'});
 const bookingId=E.reserveBooking({studentId:student.id,start:'2028-10-01T10:00:00.000Z',end:'2028-10-01T11:30:00.000Z',durationMin:90});
 const id=file(bookingId),q=ready(id),c=S.claimFeedbackReview({id:q.id});E.cancelBooking(bookingId);
 assert.equal(S.getFeedbackArtifact(id).state,'cancelled');assert.equal(S.getFeedbackReview(q.id).state,'cancelled');assert.equal(S.claimFeedbackReview({id:q.id}),null);
 assert.equal(S.completeFeedbackReview({id:q.id,attempt:c.attempts,proposal,validation:{status:'pass'}}),null);assert.throws(()=>S.ingestFeedbackComments(id,[]),/cancelled/);
 assert.equal(handle().prepare('SELECT count(*) n FROM learning_progress').get().n,0);
});
test('source identity changes invalidate a pending proposal and mismatched ownership is rejected',()=>{
 const id=file(),r=reviewed(id),a=S.getFeedbackArtifact(id);
 assert.throws(()=>S.registerFeedbackArtifact({...a,kind:'homework',mimeType:'application/vnd.google-apps.document'}),/conflict/);
 S.registerFeedbackArtifact({...a,sourceVersion:'source-v2'});assert.equal(S.getFeedbackReview(r.id).state,'stale');assert.equal(S.getFeedbackArtifact(id).state,'collecting');
});
test('malformed proposals and unsafe persisted errors fail before durable state changes',()=>{
 const id=file(),q=ready(id),c=S.claimFeedbackReview({id:q.id});
 assert.throws(()=>S.completeFeedbackReview({id:q.id,attempt:c.attempts,proposal:{...proposal,patches:[{targetId:'x',oldText:'same',newText:'same'}]},validation:{status:'pass'}}),/schema/);
 assert.throws(()=>S.failFeedbackReview({id:q.id,attempt:c.attempts,code:'private provider error text'}),/schema/);
 assert.equal(S.failFeedbackReview({id:q.id,attempt:c.attempts,code:'engine-quota'}).state,'blocked');assert.equal(S.claimFeedbackReview({id:q.id}),null);
});

test('explicit request-changes retries rejected work, while failed application resumes its accepted proposal',()=>{
 const id=file(),r=reviewed(id);assert.equal(S.rejectFeedbackReview(r.id).state,'rejected');
 assert.equal(ready(id).state,'rejected');assert.equal(S.queueFeedbackReview(id,r.sourceRevision,r.contentHash,{retry:true}).state,'queued');
 const c=S.claimFeedbackReview({id:r.id});const again=S.completeFeedbackReview({id:r.id,attempt:c.attempts,proposal,validation:{status:'pass'}});
 const applied=S.beginFeedbackApply({id:r.id,sourceRevision:again.sourceRevision,contentHash:again.contentHash});
 assert.throws(()=>S.rejectFeedbackReview(r.id),/apply_pending/);
 assert.equal(S.failFeedbackReview({id:r.id,attempt:applied.attempts,code:'google'}).state,'blocked');assert.throws(()=>S.rejectFeedbackReview(r.id),/apply_pending/);
 assert.throws(()=>S.queueFeedbackReview(id,r.sourceRevision,r.contentHash,{retry:true}),/apply_pending/);
 const resumed=S.beginFeedbackApply({id:r.id,sourceRevision:r.sourceRevision,contentHash:r.contentHash});assert.equal(resumed.state,'applying');assert.deepEqual(resumed.proposal,proposal);
 assert.equal(S.finishFeedbackApply({id:r.id,attempt:resumed.attempts,result:{reconciled:true}}).state,'accepted');
});

test('explicit policy revocation preserves the approval audit and does not silently reactivate on replay',()=>{
 const id=file(),q=ready(id),c=S.claimFeedbackReview({id:q.id}),suggestion='Keep percentage labels visible beside every group-count step.';
 const saved=S.completeFeedbackReview({id:q.id,attempt:c.attempts,proposal:{...proposal,policySuggestion:suggestion,sourceSnapshot:{revision:'revision1',targets:[{id:'slide1:text1',text:'Old sentence'}]},reviewBundle:{version:'synthetic'}},validation:{status:'pass'}});
 assert.equal(saved.proposal.sourceSnapshot.revision,'revision1');assert.equal(saved.proposal.reviewBundle.version,'synthetic');accept(saved);
 const before=S.acceptedFeedbackRules(),approved=S.approveFeedbackPolicy(q.id);assert.ok(approved.guidance.includes(suggestion));assert.notEqual(approved.hash,before.hash);
 const revoked=S.revokeFeedbackPolicy(q.id);assert.equal(revoked.hash,before.hash);assert.ok(!revoked.guidance.includes(suggestion));assert.equal(S.revokeFeedbackPolicy(q.id).hash,revoked.hash);
 assert.ok(handle().prepare('SELECT revoked_at FROM learning_feedback_policies WHERE run_id=?').get(q.id).revoked_at);
 assert.equal(S.approveFeedbackPolicy(q.id).hash,revoked.hash);
});

test('resolving accepted feedback preserves its accepted state; new open feedback still reopens it',()=>{
 const id=file(),r=reviewed(id);accept(r);const before=S.getFeedbackArtifact(id).feedbackHash;
 S.ingestFeedbackComments(id,[{id:'comment1',content:'Explain the bridge more clearly',quotedText:'100%',resolved:true,replies:[{id:'acceptedReply1',content:'Verified and applied',agent:true}]}]);
 assert.equal(S.getFeedbackArtifact(id).state,'accepted');assert.notEqual(S.getFeedbackArtifact(id).feedbackHash,before);assert.equal(S.getFeedbackReview(r.id).state,'accepted');
 S.ingestFeedbackComments(id,[{id:'comment1',content:'Explain the bridge more clearly',quotedText:'100%',resolved:true},{id:'comment2',content:'Now clarify the reverse bridge'}]);
 assert.equal(S.getFeedbackArtifact(id).state,'collecting');assert.equal(S.getFeedbackReview(r.id).state,'accepted');assert.notEqual(ready(id).id,r.id);
});

test('notification outbox survives phase completion and fences retries without rerunning the model',()=>{
 const id=file(),r=reviewed(id),phase='proposal-'+r.attempts;
 assert.equal(S.claimFeedbackNotification(999999,'policy'),null);
 const first=S.claimFeedbackNotification(r.id,phase);assert.equal(first.attempt,1);assert.equal(S.claimFeedbackNotification(r.id,phase),null);
 handle().prepare("UPDATE learning_feedback_notifications SET lease_until='2000-01-01T00:00:00.000Z' WHERE run_id=? AND phase=?").run(r.id,phase);
 const resumed=S.claimFeedbackNotification(r.id,phase);assert.equal(resumed.attempt,2);assert.equal(S.finishFeedbackNotification(r.id,phase,first.attempt),false);assert.equal(S.finishFeedbackNotification(r.id,phase,resumed.attempt),true);assert.equal(S.claimFeedbackNotification(r.id,phase),null);
 const accepted=accept(r),delivery=S.claimFeedbackNotification(r.id,'accepted-'+accepted.attempts);assert.equal(delivery.attempt,1);
 S.ingestFeedbackComments(id,[{id:'comment1',content:'Explain the bridge more clearly',quotedText:'100%',resolved:true}]);
 assert.equal(S.finishFeedbackNotification(r.id,'accepted-'+accepted.attempts,delivery.attempt),true);assert.equal(S.getFeedbackReview(r.id).state,'accepted');assert.equal(S.listFeedbackReviews(id).length,1);
 const policy=S.claimFeedbackNotification(r.id,'policy');assert.equal(policy.attempt,1);assert.equal(S.finishFeedbackNotification(r.id,'policy',policy.attempt),true);
 assert.throws(()=>S.claimFeedbackNotification(r.id,'../unsafe'),/schema/);assert.throws(()=>S.claimFeedbackNotification(r.id,'policy',600001),/lease/);
});

test('late verification evidence is auditable after staling but cannot overwrite a reclaimed attempt',()=>{
 const id=file(),q=ready(id),first=S.claimFeedbackReview({id:q.id});
 S.ingestFeedbackComments(id,[{id:'comment1',content:'Changed while the reviewer was running'}]);assert.equal(S.getFeedbackReview(q.id).state,'stale');
 assert.equal(S.recordFeedbackEvidence({id:q.id,attempt:first.attempts,result:{stage:'applied-native-feedback',validation:{status:'revise'},contentHash:'actual-native-hash'}}),true);
 assert.equal(S.getFeedbackReview(q.id).state,'stale');assert.equal(S.getFeedbackReview(q.id).result.validation.status,'revise');
 const next=ready(id),claimed=S.claimFeedbackReview({id:next.id});
 handle().prepare("UPDATE learning_feedback_runs SET lease_until='2000-01-01T00:00:00.000Z' WHERE id=?").run(next.id);
 const recovered=S.claimFeedbackReview({id:next.id});assert.ok(recovered.attempts>claimed.attempts);
 assert.equal(S.recordFeedbackEvidence({id:next.id,attempt:recovered.attempts,result:{providerFailure:'engine-quota'}}),true);
 assert.equal(S.recordFeedbackEvidence({id:next.id,attempt:claimed.attempts,result:{wrong:'late old worker'}}),false);
 assert.deepEqual(S.getFeedbackReview(next.id).result,{providerFailure:'engine-quota'});assert.equal(S.getFeedbackReview(next.id).state,'working');
 handle().prepare("UPDATE learning_feedback_runs SET state='cancelled' WHERE id=?").run(next.id);
 assert.equal(S.recordFeedbackEvidence({id:next.id,attempt:recovered.attempts,result:{audit:'cancelled return'}}),true);assert.equal(S.getFeedbackReview(next.id).state,'cancelled');
 assert.throws(()=>S.recordFeedbackEvidence({id:next.id,attempt:recovered.attempts,result:{tooLarge:'x'.repeat(1024*1024)}}),/limit/);
});

test('pending notification scan includes historical phases and policy list retains revoked approvals',()=>{
 const id=file(),r=reviewed(id);accept(r);S.approveFeedbackPolicy(r.id);
 const first=S.claimFeedbackNotification(r.id,'policy');assert.ok(first);
 assert.ok(!S.listPendingFeedbackNotifications().some(n=>n.runId===r.id&&n.phase==='policy'));
 handle().prepare("UPDATE learning_feedback_notifications SET lease_until='2000-01-01T00:00:00.000Z' WHERE run_id=? AND phase='policy'").run(r.id);
 assert.ok(S.listPendingFeedbackNotifications().some(n=>n.runId===r.id&&n.phase==='policy'));
 S.claimFeedbackNotification(r.id,'proposal-old');handle().prepare("UPDATE learning_feedback_notifications SET state='pending',lease_until=NULL WHERE run_id=? AND phase='proposal-old'").run(r.id);
 assert.ok(S.listPendingFeedbackNotifications().some(n=>n.runId===r.id&&n.phase==='proposal-old'));assert.equal(S.listPendingFeedbackNotifications(1).length,1);
 const policy=S.listFeedbackPolicies().find(p=>p.runId===r.id);assert.equal(policy.guidance,proposal.policySuggestion);assert.equal(policy.revokedAt,null);
 S.revokeFeedbackPolicy(r.id);assert.ok(S.listFeedbackPolicies().find(p=>p.runId===r.id).revokedAt);
 assert.throws(()=>S.listPendingFeedbackNotifications(501),/limit/);assert.throws(()=>S.listPendingFeedbackNotifications(0),/limit/);
});

test('proposal scope is explicit bounded data, including manual generator requests',()=>{
 const id=file(),q=ready(id),c=S.claimFeedbackReview({id:q.id});
 assert.throws(()=>S.completeFeedbackReview({id:q.id,attempt:c.attempts,proposal:{...proposal,scope:'execute-code'},validation:{status:'pass'}}),/schema/);
 const blocked=S.completeFeedbackReview({id:q.id,attempt:c.attempts,proposal:{...proposal,scope:'generator-change'},validation:{status:'blocked'}});assert.equal(blocked.proposal.scope,'generator-change');assert.equal(blocked.state,'blocked');
});
