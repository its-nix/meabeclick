"""Exact human review table for a future native Releases tab.

This module performs no remote writes. release_rows is an export representation;
when refreshing existing native rows, write ONLY columns A:K. L:N belong to the
owner and must never be overwritten by an automated export. Decision imports
require a real checked boolean and (where audio requires it) listening evidence.
Preview URLs must already belong to the immutable queued publication package.
"""
import engine
import creative_verification
import feedback

HEADERS=['release_id','Exact video version','network','account','scheduled_at','caption','cta','Watch this exact video','media_sha256','technical_gate','listening_required','Approve ✓','Listened ✓','feedback','Status','Worker result']
IMMUTABLE_COLUMNS=11


def _media_ready(package, checked):
    fields = ('bundle', 'caption', 'cta', 'preview_url', 'drive_receipt', 'creative_verification')
    identity = engine.canonical({name: package.get(name) for name in fields})
    if identity not in checked:
        try:
            from machine import require_preview_binding
            require_preview_binding(package)
            creative_verification.require(package)
        except Exception:
            checked[identity] = False
        else:
            checked[identity] = True
    return checked[identity]


def _row(queue,key,*,checked=None):
    job=queue.validate(key);package=job['package'];qa=package.get('qa') or {}
    preview=package.get('preview_url')
    if not isinstance(preview,str) or not preview.strip():raise ValueError('Exact queued package needs an actual preview_url before human review')
    if not isinstance(package.get('account'),str) or not package['account'].strip():raise ValueError('Verified destination account missing')
    technical=(not feedback.blocked(queue,key) and not feedback.stale_rules(queue,package) and qa.get('technical_pass') is True and qa.get('artifact_id')==package['artifact_id'] and qa.get('media_sha256')==package['media_sha256'])
    # Missing/ambiguous listening requirement cannot silently mean silent.
    listening=qa.get('listening_required')
    technical = technical and type(listening) is bool and _media_ready(package, checked if checked is not None else {})
    title=engine.verify(package['bundle'])['payload']['job'].get('post',{}).get('title')
    version=title if isinstance(title,str) and title.strip() else package['artifact_id'].split('-')[0]
    worker=feedback.status_rows(queue).get(key,['',''])
    delivery={'approved':('Approved','Waiting for Buffer scheduling.'),'uncertain':('Needs reconciliation','Buffer outcome is uncertain; automatic retry is blocked.'),'scheduled':('Scheduled','Buffer confirmed this channel schedule.'),'published':('Published','Provider confirmed publication.'),'failed':('Failed','Provider reported failure; inspect the retained receipt.')}
    if job['status'] in delivery:
        state,message=delivery[job['status']]
        if job['status']=='failed' and not job.get('receipt'):
            message='The slot elapsed before any Buffer submission.'
        if feedback.blocked(queue,key) and job['status'] in ('scheduled','published'):state='Feedback held';message='Feedback concerns an already submitted post; provider reconciliation is required.'
        if not technical and job['status']=='approved':state='Held';message='Current verification or guidance requires a fresh check.'
        worker=[state,(worker[1]+' '+message).strip()]
    return [key,version,package['network'],package['account'],package['scheduled_at'],package['caption'],package['cta'],preview,package['media_sha256'],'Pass' if technical else 'Blocked','Yes' if listening is not False else 'No',False,False,'',*worker]


def release_rows(queue, excluded=()):
    """Return headers + deterministic exact packages; never infer human decisions.

    Owner approval/listening cells are unchecked in this representation and
    are NOT an instruction to clear corresponding existing native cells.
    """
    # Reuse only within this export. Approval and submission recheck independently.
    checked = {}
    return [HEADERS.copy()]+[_row(queue,job['id'],checked=checked) for job in sorted(queue.rows(),key=lambda r:r['id']) if job['id'] not in excluded]


def import_decisions(queue,rows):
    """Approve only unchanged queued packages explicitly checked by the owner.

    All rows and QA gates are validated before applying any approval. Existing
    exact approvals are idempotent. Unknown/duplicate IDs and malformed headers
    fail closed. The caller is responsible for obtaining rows from the owner's
    authoritative native Releases table; untrusted web text is not approval.
    """
    if not isinstance(rows,list) or not rows or rows[0]!=HEADERS:raise ValueError('Releases headers must match exact review schema')
    if len(rows)>201:raise ValueError('Review import exceeds bounded 200 releases')
    seen=set();approvals=[];holds=[]
    for supplied in rows[1:]:
        if not isinstance(supplied,list) or len(supplied)!=len(HEADERS):raise ValueError('Expected complete release review row')
        key=supplied[0]
        if not isinstance(key,str) or key in seen:raise ValueError('Missing or duplicate release ID')
        seen.add(key)
        expected=_row(queue,key)
        if supplied[:IMMUTABLE_COLUMNS]!=expected[:IMMUTABLE_COLUMNS]:raise ValueError('Release changed since human review; refresh exact package')
        if queue.get(key)['status']=='failed':continue
        decision=supplied[11]
        if type(decision) is bool:
            approved=decision
        elif isinstance(decision,str) and decision in ('','Pending','Approved','Change','Skip'):
            approved=decision=='Approved'  # Legacy explicit CLI/import decisions.
        else:raise ValueError('Unknown owner decision')
        if feedback.blocked(queue,key):
            if queue.get(key)['status']=='approved':holds.append((key,'Unresolved feedback'))
            continue
        if not approved:
            state=queue.get(key)['status']
            if state in ('uncertain','scheduled','published'):raise ValueError('Submitted release requires provider reconciliation or cancellation')
            if state=='approved':holds.append((key,decision or 'Pending'))
            continue
        if expected[9]!='Pass':raise ValueError('Approved release lacks exact passing technical QA')
        listened=supplied[12] is True or supplied[12]=='Yes'
        if expected[10]=='Yes' and not listened:raise ValueError('Audio approval requires listened Yes')
        job=queue.get(key)
        if job['status'] in ('approved','uncertain','scheduled','published'):
            if job['approval_sha']!=key or (expected[10]=='Yes' and not job['listened']):raise ValueError('Existing approval is not current')
        elif job['status']!='review':raise ValueError('Release is not awaiting review')
        approvals.append((key,listened,job['status']))
    for key,reason in holds:queue.hold(key,'native Releases: '+reason)
    for key,listened,status in approvals:
        if status=='review':queue.approve(key,'native Releases owner decision',listened=listened)
    return [key for key,_,_ in approvals]
