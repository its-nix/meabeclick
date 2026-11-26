"""Deterministic feedback polling and verified replacement orchestration."""
import copy
import json
import os
from pathlib import Path
from urllib.parse import quote

import creative_verification as cv
import drive_assets
import engine
import feedback
from google_sync import _atomic


def _format(package):
    job=engine.verify(package['bundle'])['payload']['job']
    return job.get('generated',{}).get('format') or job.get('factory',{}).get('template') or job.get('post',{}).get('format')


def configure(cfg,root):
    """Persistent overrides prevent old launch seeds from resurrecting fixed bytes."""
    result=copy.deepcopy(cfg);path=Path(root)/'feedback-overrides.json'
    result['feedback_overrides']=json.loads(path.read_text()) if path.exists() else {}
    for item in result['feedback_overrides'].values():
        result.setdefault('preview_urls',{})[item['artifact_id']]=item['preview_url']
        result.setdefault('drive_receipts',{})[item['artifact_id']]=item['drive_receipt']
        result.setdefault('verification_refs',{})[item['artifact_id']]=item['creative_verification']
    return result


def ingest(google,cfg,queue):
    rows=google._release_values(cfg['spreadsheet_id'],cfg['releases_sheet_id'])
    feedback.scan(queue,rows)
    return rows


def _sheet_values(google,sid,title,end):
    rows=google._request('GET','https://sheets.googleapis.com/v4/spreadsheets/'+sid+'/values/'+quote("'"+title+"'!A1:"+end,safe='')+'?valueRenderOption=UNFORMATTED_VALUE').get('values',[])
    while rows and all(v=='' or v is False for v in rows[-1]):rows.pop()
    return rows


def _archive(google,cfg,rows,root,identity):
    sid=cfg['spreadsheet_id'];before=_sheet_values(google,sid,'History','P401')
    if not before:before=[rows[0]]
    existing={r[0] for r in before[1:] if r}
    additions=[r for r in rows[1:] if r[0] not in existing]
    if not additions:return
    if len(before)+len(additions)>401:raise ValueError('Review history capacity reached')
    desired=before+additions;start=len(before)+1
    def submit():
        if _sheet_values(google,sid,'History','P401')!=before:raise ValueError('History changed before archive')
        return google._request('POST','https://sheets.googleapis.com/v4/spreadsheets/'+sid+'/values:batchUpdate',json.dumps({'valueInputOption':'RAW','data':[{'range':f"'History'!A{start}:P{len(desired)}",'values':additions}]}).encode())
    def verify(_):
        found=_sheet_values(google,sid,'History','P401')
        if [r+['']*(16-len(r)) for r in found]!=[r+['']*(16-len(r)) for r in desired]:raise ValueError('History readback differs')
    google._write(Path(root)/'feedback-intents',{'operation':'feedback-history','feedback_id':identity,'before':before,'additions':additions},submit,verify)
    verify(None)


def _commit_rows(google,cfg,before,desired,root,identity):
    """Retire old rows and append replacements; never rewrite owner L:N cells."""
    sid=cfg['spreadsheet_id'];sheet=cfg['releases_sheet_id'];previous={r[0]:(i,r) for i,r in enumerate(before[1:],2)}
    updates=[];requests=[]
    for row in desired[1:]:
        if row[0] not in previous:continue
        index,old=previous[row[0]]
        if row[9]!=old[9]:updates.append({'range':f"'Releases'!J{index}:J{index}",'values':[[row[9]]]})
        if row[14:16]!=old[14:16]:updates.append({'range':f"'Releases'!O{index}:P{index}",'values':[row[14:16]]})
        if row[14]=='Archived':requests.append({'updateDimensionProperties':{'range':{'sheetId':sheet,'dimension':'ROWS','startIndex':index-1,'endIndex':index},'properties':{'hiddenByUser':True},'fields':'hiddenByUser'}})
    additions=[r for r in desired[1:] if r[0] not in previous]
    if len(before)+len(additions)>201:raise ValueError('Review retention capacity reached')
    if additions:updates.append({'range':f"'Releases'!A{len(before)+1}:P{len(before)+len(additions)}",'values':additions})
    def submit():
        if google._release_values(sid,sheet)!=before:raise ValueError('Owner changed review before replacement')
        return google._request('POST','https://sheets.googleapis.com/v4/spreadsheets/'+sid+'/values:batchUpdate',json.dumps({'valueInputOption':'RAW','data':updates}).encode())
    def verify(_):
        actual=google._release_values(sid,sheet);found={r[0]:r for r in actual[1:]}
        for row in desired[1:]:
            current=found[row[0]]
            if current[:11]!=row[:11] or current[14:16]!=row[14:16]:raise ValueError('Replacement readback differs')
            if row[0] not in previous and current!=row:raise ValueError('New replacement edited before completion')
    google._write(Path(root)/'feedback-intents',{'operation':'feedback-replacement','feedback_id':identity,'before':before,'desired':desired},submit,verify)
    verify(None)
    if requests:
        google._write(Path(root)/'feedback-intents',{'operation':'feedback-hide-retired','feedback_id':identity},lambda:google._request('POST','https://sheets.googleapis.com/v4/spreadsheets/'+sid+':batchUpdate',json.dumps({'requests':requests}).encode()),lambda _:None)



def sync_learnings(google,cfg,queue,root):
    directory=Path(cfg.get('knowledge_dir') or Path(root)/'knowledge')
    feedback.export_rules(queue,directory)
    if not cfg.get('learnings_sheet_id') or not cfg.get('learning_guide_file_id'):
        raise ValueError('Learnings tab and guide must be configured')
    rows=feedback.learning_rows(queue)
    # Keep full IDs/origins in authoritative JSON; show short labels on the phone.
    for row in rows[1:]:row[0]='R-'+row[0][:8];row[3]='Feedback '+row[3][:8]
    sid=cfg['spreadsheet_id'];before=_sheet_values(google,sid,'Learnings','E201')
    desired=rows
    if before!=desired:
        height=max(len(before),len(desired));values=desired+[['']*5 for _ in range(height-len(desired))]
        def submit():
            if _sheet_values(google,sid,'Learnings','E201')!=before:raise ValueError('Learnings changed before write')
            return google._request('POST','https://sheets.googleapis.com/v4/spreadsheets/'+sid+'/values:batchUpdate',json.dumps({'valueInputOption':'RAW','data':[{'range':f"'Learnings'!A1:E{height}",'values':values}]}).encode())
        def verify(_):
            if _sheet_values(google,sid,'Learnings','E201')!=desired:raise ValueError('Learnings readback differs')
        google._write(Path(root)/'feedback-intents',{'operation':'feedback-learnings','before':before,'desired':desired},submit,verify)
        verify(None)
    google.mirror_document(directory/'rules.md',cfg['learning_guide_file_id'],Path(root)/'feedback-intents')
    for job in queue.db.execute("SELECT id FROM feedback_jobs WHERE status='resolved'").fetchall():feedback.finish(queue,job[0])
    return len(rows)-1


def _replace(google,cfg,queue,root,job,item,learnings,summary,before):
    import review_queue
    cv.require(item);manifest=engine.verify(item['bundle'])
    item={**item,'artifact_id':manifest['artifact_id'],'media_sha256':manifest['payload']['media']['sha256'],'verification_status':'ready_for_human'}
    learned_ids=['R-'+feedback._hash([job['id'],r['scope'],r.get('format_id'),r['rule'].strip()])[:8] for r in learnings]
    if job.get('kind')=='policy':
        current_ids=['R-'+r['id'][:8] for r in feedback.rules(queue,_format(item))]
        summary=summary[:2500]+' Applied existing '+', '.join(current_ids)+'; see Learnings.'
    else:summary=(summary[:2500]+' Learned '+', '.join(learned_ids)+'; see Learnings.' if learned_ids else summary[:2500]+' Video only; no reusable rule added.')
    source=queue.get(job['release_id']);old_artifact=source['artifact']
    affected=[r for r in queue.rows() if r['artifact']==old_artifact]
    if any(r['status'] not in ('review','approved') for r in affected):raise ValueError('Submitted versions cannot be replaced')
    related=job.get('_related',[job]);related_ids={j['id'] for j in related}
    unresolved={r[0] for r in queue.db.execute("SELECT id FROM feedback_jobs WHERE artifact_id=? AND status IN ('pending','running','held','resolved')",(old_artifact,))}
    if unresolved-related_ids:raise ValueError('Other destination feedback requires combined correction')
    selected={r['id'] for r in affected};original=next(r for r in before[1:] if r[0]==job['release_id'])
    expected=job['source_digest'] if job.get('kind')=='policy' else job['digest']
    if feedback._hash(feedback.normalize(original[13]))!=expected:raise ValueError('Owner feedback changed before replacement')
    if google._release_values(cfg['spreadsheet_id'],cfg['releases_sheet_id'])!=before:raise ValueError('Owner review changed before replacement')
    journal=Path(root)/'feedback-replacements'/f"{job['id']}.json";journal.parent.mkdir(exist_ok=True)
    if journal.exists():raise ValueError('Prior feedback replacement needs reconciliation')
    _atomic(journal,{'status':'started','feedback_id':job['id'],'before':before,'old_jobs':affected,'item':item,'learnings':learnings,'summary':summary})
    _archive(google,cfg,[before[0]]+[r for r in before[1:] if r[0] in selected],root,job['id'])
    # No external publisher can run under this tick's process lock.
    for old in affected:queue.cancel(old['id'],'Verified owner feedback replacement '+job['id'])
    receipt=drive_assets.store(google,item,cfg,root,queue=queue)
    new_ids=[]
    batch_id=source['package'].get('review_batch_id')
    for dest in cfg['destinations']:
        package={k:item[k] for k in ('bundle','caption','cta','scheduled_at','qa','creative_verification')}
        package.update(network=dest['network'],account=dest['account'],preview_url=receipt['webViewLink'],drive_receipt=receipt)
        if batch_id:package['review_batch_id']=batch_id
        new_ids.append(queue.enqueue(package))
    exported={r[0]:r for r in review_queue.release_rows(queue)[1:]}
    desired=copy.deepcopy(before)
    for row in desired[1:]:
        if row[0] in selected:row[9]='Blocked';row[14:16]=['Archived','Replaced after verified feedback; original owner cells retained.']
    prior={(r['network'],r['account']):next(row for row in before[1:] if row[0]==r['id']) for r in affected}
    alias_pairs=[]
    for key in new_ids:
        destination=queue.get(key);old=prior.get((destination['network'],destination['account']))
        row=exported[key];row[13]=old[13] if old else '';
        if old:alias_pairs.append((old[0],key))
        row[14:16]=['Verifying','Replacement verified; persisting learned guidance.'];desired.append(row)
    _commit_rows(google,cfg,before,desired,root,job['id'])
    record={'status':'review_written','feedback_id':job['id'],'replacement_ids':new_ids,'item':item,'comment':original[13],'learnings':learnings,'summary':summary,'related':[j['id'] for j in related],'old_jobs':affected,'comments':{j['id']:j['comment'] for j in related}}
    _atomic(journal,record)
    overrides=configure(cfg,root)['feedback_overrides'];key=manifest['payload']['job']['post']['id']+'@'+item['scheduled_at']
    overrides[key]={**item,'preview_url':receipt['webViewLink'],'drive_receipt':receipt}
    _atomic(Path(root)/'feedback-overrides.json',overrides)
    for old_id,new_id in alias_pairs:
        for alias in queue.db.execute('SELECT digest,feedback_id FROM feedback_aliases WHERE release_id=?',(old_id,)).fetchall():queue.db.execute('INSERT OR IGNORE INTO feedback_aliases VALUES(?,?,?)',(new_id,alias[0],alias[1]))
    actual=google._release_values(cfg['spreadsheet_id'],cfg['releases_sheet_id'])
    originals=[r for r in actual[1:] if r[0] in selected]
    feedback.scan(queue,[actual[0]]+originals)
    for index,source_job in enumerate(related):
        owner=next(r[13] for r in originals if r[0]==source_job['release_id'])
        feedback.complete(queue,source_job['id'],replacement_ids=new_ids,current_feedback=owner,summary=summary,learnings=learnings if index==0 else [],defer_visible=True)
    record['status']='resolved';_atomic(journal,record)
    sync_learnings(google,cfg,queue,root)
    google.sync_releases(cfg['spreadsheet_id'],cfg['releases_sheet_id'],queue,Path(root)/'google-intents')
    record['status']='completed';_atomic(journal,record)
    return new_ids


def reconcile(google,cfg,queue,root):
    """Finish only a proven native replacement; never repeat a media write."""
    for path in sorted((Path(root)/'feedback-replacements').glob('*.json')):
        saved=json.loads(path.read_text())
        if saved['status']=='started':raise ValueError('Interrupted media replacement requires reconciliation; preparation and publishing held')
        if saved['status'] not in ('review_written','resolved'):continue
        rows=google._release_values(cfg['spreadsheet_id'],cfg['releases_sheet_id']);lookup={r[0]:r for r in rows[1:]}
        for key in saved['replacement_ids']:
            row=lookup[key];package=queue.validate(key)['package'];cv.require(package)
            if row[8]!=package['media_sha256'] or row[5]!=package['caption']:raise ValueError('Replacement changed before recovery')
            google.verify_preview(Path(package['bundle'])/'asset.mp4',package['preview_url'],expected_revision_id=package['drive_receipt']['revision_id'])
        for fid in saved.get('related',[saved['feedback_id']]):
            job=feedback.get(queue,fid)
            old=next(r for r in saved['old_jobs'] if r['id']==job['release_id'])
            matched=next(key for key in saved['replacement_ids'] if queue.get(key)['network']==old['network'] and queue.get(key)['account']==old['account'])
            expected=job['source_digest'] if job.get('kind')=='policy' else job['digest']
            if feedback._hash(feedback.normalize(lookup[job['release_id']][13]))!=expected or feedback._hash(feedback.normalize(lookup[matched][13]))!=expected:raise ValueError('Feedback edited during recovery')
            if job['status'] in ('completed','resolved'):continue
            if job['status'] not in ('running','held'):raise ValueError('Feedback superseded during recovery')
            with queue.transaction():queue.db.execute("UPDATE feedback_jobs SET status='running' WHERE id=?",(fid,))
            feedback.complete(queue,fid,replacement_ids=saved['replacement_ids'],current_feedback=lookup[matched][13],summary=saved['summary'],learnings=saved['learnings'] if fid==saved['feedback_id'] else [],defer_visible=True)
        package=queue.get(saved['replacement_ids'][0])['package'];item=saved['item'];manifest=engine.verify(item['bundle'])
        overrides=configure(cfg,root)['feedback_overrides'];overrides[manifest['payload']['job']['post']['id']+'@'+item['scheduled_at']]={**item,'preview_url':package['preview_url'],'drive_receipt':package['drive_receipt']}
        _atomic(Path(root)/'feedback-overrides.json',overrides)
        sync_learnings(google,cfg,queue,root)
        google.sync_releases(cfg['spreadsheet_id'],cfg['releases_sheet_id'],queue,Path(root)/'google-intents')
        saved['status']='completed';_atomic(path,saved)


def run(google,cfg,queue,root,*,processor=None):
    """Every call polls deterministically; only a new persisted job invokes processor."""
    if not cfg.get('feedback_enabled'):return {'processed':0,'held':[]}
    import feedback_repair
    feedback.recover(queue)
    reconcile(google,cfg,queue,root)
    rows=ingest(google,cfg,queue)
    feedback.ensure_rule_jobs(queue)
    # Reflect Pending before any expensive model/render operation.
    google.sync_releases(cfg['spreadsheet_id'],cfg['releases_sheet_id'],queue,Path(root)/'google-intents')
    processed=0;held=[]
    for pending in feedback.pending(queue)[:2]:
        job=feedback.claim(queue,pending['id'])
        if not job:continue
        related=[job]
        for other in feedback.pending(queue):
            if other['artifact_id']==job['artifact_id']:
                claimed=feedback.claim(queue,other['id'])
                if claimed:related.append(claimed)
        job['_related']=related
        try:
            package=queue.get(job['release_id'])['package'];rules=feedback.rules(queue,_format(package))
            combined='\n\n'.join(j['comment'] for j in related)
            result=(processor or feedback_repair.repair)(package,combined,rules,Path(root)/'feedback-corrections',feedback_id=job['id'])
            if result.get('status')!='ready_for_human':raise ValueError(result.get('summary','Correction failed verification'))
            fresh=ingest(google,cfg,queue)
            if any(feedback.get(queue,j['id'])['status']!='running' for j in related):
                for j in related:
                    if feedback.get(queue,j['id'])['status']=='running':
                        feedback.hold(queue,j['id'],'Feedback changed before any media replacement');feedback.retry(queue,j['id'])
                continue
            if job.get('kind')=='policy':
                if feedback.stale_rules(queue,result['item']):raise ValueError('Policy refresh did not satisfy current scoped guidance')
                result['learnings']=[]
            _replace(google,cfg,queue,root,job,result['item'],result.get('learnings',[]),result['summary'],fresh)
            feedback.ensure_rule_jobs(queue)
            processed+=1
        except Exception as exc:
            for j in related:feedback.hold(queue,j['id'],str(exc)[:800] if isinstance(exc,ValueError) else type(exc).__name__+'; inspect private worker state')
            held.append(job['id'])
            journal=Path(root)/'feedback-replacements'/f"{job['id']}.json"
            if journal.exists() and json.loads(journal.read_text())['status']!='completed':raise ValueError('Partial feedback replacement requires reconciliation; publishing held') from exc
    import feedback_learning
    learning=feedback_learning.review(queue,root)
    feedback.ensure_rule_jobs(queue)
    sync_learnings(google,cfg,queue,root)
    google.sync_releases(cfg['spreadsheet_id'],cfg['releases_sheet_id'],queue,Path(root)/'google-intents')
    return {'processed':processed,'held':held,'learning':learning}
