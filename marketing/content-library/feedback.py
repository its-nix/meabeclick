"""Durable owner-feedback ledger. No models, network calls, or machine imports.

Native owner cells are inputs only. The caller owns verified replacement and
readback, then supplies the freshly read owner comment to complete().
"""
from datetime import datetime, timezone
import hashlib
import json
import sqlite3
from pathlib import Path
import unicodedata

MAX_COMMENT = 12000
MAX_ATTEMPTS = 2


def _now():
    return datetime.now(timezone.utc).isoformat()


def _hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def normalize(text):
    if not isinstance(text, str) or len(text) > MAX_COMMENT:
        raise ValueError('Feedback must be text of at most 12000 characters')
    return unicodedata.normalize('NFC', text.replace('\r\n', '\n').replace('\r', '\n')).strip()


def _db(queue):
    db = queue.db
    schema = '''
    CREATE TABLE IF NOT EXISTS feedback_jobs (
      id TEXT PRIMARY KEY, release_id TEXT NOT NULL, artifact_id TEXT NOT NULL,
      media_sha256 TEXT NOT NULL, comment TEXT NOT NULL, digest TEXT NOT NULL,
      status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      summary TEXT NOT NULL DEFAULT '', created TEXT NOT NULL, updated TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS feedback_sources (
      release_id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL, media_sha256 TEXT NOT NULL,
      digest TEXT NOT NULL, comment TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS feedback_aliases (
      release_id TEXT NOT NULL, digest TEXT NOT NULL, feedback_id TEXT NOT NULL,
      PRIMARY KEY(release_id,digest));
    CREATE TABLE IF NOT EXISTS feedback_rules (
      id TEXT PRIMARY KEY, scope TEXT NOT NULL, format_id TEXT, rule TEXT NOT NULL,
      origin TEXT NOT NULL, state TEXT NOT NULL, revision INTEGER NOT NULL);
    '''
    for statement in schema.split(';'):
        if statement.strip(): db.execute(statement)
    columns={r[1] for r in db.execute('PRAGMA table_info(feedback_jobs)')}
    if 'kind' not in columns:
        db.execute("ALTER TABLE feedback_jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'owner'")
    if 'source_digest' not in columns:
        db.execute("ALTER TABLE feedback_jobs ADD COLUMN source_digest TEXT NOT NULL DEFAULT ''")
        db.execute("UPDATE feedback_jobs SET source_digest=digest WHERE kind='owner'")
    return db


def _owner_digest(job):
    return job['source_digest'] if job.get('kind')=='policy' else job['digest']


def _revoke_artifact(queue, artifact, reason):
    for sibling in queue.db.execute("SELECT id FROM jobs WHERE artifact=? AND status='approved'",(artifact,)).fetchall():
        queue.db.execute("UPDATE jobs SET status='review',approval_sha=NULL,approver=NULL,listened=0,updated=? WHERE id=?",(_now(),sibling['id']))
        queue.event(sibling['id'],'approval_revoked',reason)


def _job(row):
    return dict(row) if row is not None else None


def init(queue):
    """Create feedback tables; call when opening a queue, before transactions."""
    _db(queue)


def get(queue, feedback_id):
    row = _db(queue).execute('SELECT * FROM feedback_jobs WHERE id=?', (feedback_id,)).fetchone()
    if row is None:
        raise ValueError('Unknown feedback job')
    return _job(row)


def scan(queue, rows):
    """Persist new exact feedback and revoke approval before any producer runs.

    Accept native Releases A:N or A:P. Archived source rows remain recognizable
    after replacement. Edited comments are separate jobs; prior work is retained.
    """
    db = _db(queue)
    if not isinstance(rows, list) or not rows or not isinstance(rows[0], list):
        raise ValueError('Native Releases rows required')
    header = rows[0]
    if len(header) not in (14, 16) or header[0] != 'release_id' or header[8] != 'media_sha256' or header[13] != 'feedback':
        raise ValueError('Expected Releases A:N or A:P schema')
    if len(rows) > 201:
        raise ValueError('Feedback scan exceeds 200 releases')
    checked, seen = [], set()
    for row in rows[1:]:
        if not isinstance(row, list) or len(row) < 14 or len(row) > 16:
            raise ValueError('Incomplete feedback row')
        key = row[0]
        if not isinstance(key, str) or not key or key in seen:
            raise ValueError('Missing or duplicate release ID')
        seen.add(key)
        comment = normalize(row[13])
        source = db.execute('SELECT * FROM feedback_sources WHERE release_id=?', (key,)).fetchone()
        try:
            queued = queue.get(key)
        except ValueError:
            if source is None:
                raise ValueError('Unknown feedback release')
            queued = None
        artifact = queued['package']['artifact_id'] if queued else source['artifact_id']
        sha = queued['package']['media_sha256'] if queued else source['media_sha256']
        if row[8] != sha:
            raise ValueError('Feedback media identity changed; refresh Releases')
        checked.append((key, artifact, sha, comment, queued))
    created = []
    with queue.transaction():
        for key, artifact, sha, comment, queued in checked:
            if queued is not None:
                queued = queue.get(key)
                if queued['package']['artifact_id'] != artifact or queued['package']['media_sha256'] != sha:
                    raise ValueError('Feedback package changed during scan')
            digest = _hash(comment)
            previous = db.execute('SELECT * FROM feedback_sources WHERE release_id=?', (key,)).fetchone()
            db.execute('INSERT OR REPLACE INTO feedback_sources VALUES(?,?,?,?,?)', (key, artifact, sha, digest, comment))
            if previous is not None and previous['digest'] != digest:
                db.execute("UPDATE feedback_jobs SET status='superseded',updated=? WHERE release_id=? AND (status IN ('pending','running','held') OR (kind='policy' AND status='resolved'))", (_now(), key))
            if not comment:
                continue
            if db.execute('SELECT 1 FROM feedback_aliases WHERE release_id=? AND digest=?', (key, digest)).fetchone():
                continue
            fid = _hash([key, artifact, digest])
            submitted = queued is None or queued['status'] not in ('review', 'approved', 'failed')
            status = 'held' if submitted else 'pending'
            reason = 'Submitted or archived release requires reconciliation' if submitted else ''
            cursor = db.execute('INSERT OR IGNORE INTO feedback_jobs(id,release_id,artifact_id,media_sha256,comment,digest,status,summary,created,updated,kind,source_digest) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', (fid,key,artifact,sha,comment,digest,status,reason,_now(),_now(),'owner',digest))
            if not cursor.rowcount:
                old = get(queue, fid)
                if old['status'] == 'superseded':
                    status = 'held' if submitted or old['attempts'] else 'pending'
                    reason = 'Previously attempted repair requires reconciliation' if old['attempts'] else reason
                    db.execute('UPDATE feedback_jobs SET status=?,summary=?,updated=? WHERE id=?', (status,reason,_now(),fid))
                    created.append(get(queue,fid))
            _revoke_artifact(queue,artifact,'Owner feedback '+fid)
            if cursor.rowcount:
                created.append(get(queue, fid))
    return created


def pending(queue):
    return [_job(r) for r in _db(queue).execute("SELECT * FROM feedback_jobs WHERE status='pending' ORDER BY created,id")]


def blocked(queue, release_id):
    try:
        return queue.db.execute("SELECT 1 FROM feedback_jobs j WHERE (j.status IN ('pending','running','held','resolved') AND (j.release_id=? OR j.artifact_id=(SELECT artifact FROM jobs WHERE id=?))) OR (j.status='resolved' AND EXISTS (SELECT 1 FROM feedback_aliases a WHERE a.feedback_id=j.id AND (a.release_id=? OR a.release_id IN (SELECT id FROM jobs WHERE artifact=(SELECT artifact FROM jobs WHERE id=?)))))", (release_id,release_id,release_id,release_id)).fetchone() is not None
    except sqlite3.OperationalError as exc:
        if 'no such table: feedback_jobs' in str(exc):
            return False
        raise


def claim(queue, feedback_id):
    db = _db(queue)
    with queue.transaction():
        job = get(queue, feedback_id)
        if job['status'] != 'pending':
            return None
        if job['attempts'] >= MAX_ATTEMPTS:
            db.execute("UPDATE feedback_jobs SET status='held',summary='Correction budget exhausted',updated=? WHERE id=?", (_now(),feedback_id))
            return None
        db.execute("UPDATE feedback_jobs SET status='running',attempts=attempts+1,updated=? WHERE id=?", (_now(),feedback_id))
    return get(queue, feedback_id)


def hold(queue, feedback_id, reason):
    if not isinstance(reason,str) or not reason.strip():
        raise ValueError('Hold reason required')
    db = _db(queue)
    with queue.transaction():
        job = get(queue, feedback_id)
        if job['status'] not in ('completed','superseded','resolved'):
            db.execute("UPDATE feedback_jobs SET status='held',summary=?,updated=? WHERE id=?", (reason[:4000],_now(),feedback_id))
    return get(queue, feedback_id)


def recover(queue):
    """Call once at process startup, never during another worker's active repair."""
    db = _db(queue)
    with queue.transaction():
        cursor = db.execute("UPDATE feedback_jobs SET status='held',summary='Interrupted repair requires reconciliation',updated=? WHERE status='running'", (_now(),))
    return cursor.rowcount


def retry(queue, feedback_id):
    """Explicitly requeue only after caller reconciles a known safe failure."""
    db = _db(queue)
    with queue.transaction():
        job = get(queue, feedback_id)
        if job['status'] != 'held' or job['attempts'] >= MAX_ATTEMPTS:
            raise ValueError('Feedback cannot retry')
        source = db.execute('SELECT digest FROM feedback_sources WHERE release_id=?',(job['release_id'],)).fetchone()
        if source is None or source['digest'] != _owner_digest(job):
            raise ValueError('Feedback changed')
        db.execute("UPDATE feedback_jobs SET status='pending',updated=? WHERE id=?", (_now(),feedback_id))
    return get(queue, feedback_id)


def rules(queue, format_id=None):
    result=[]
    for row in _db(queue).execute("SELECT * FROM feedback_rules WHERE state='active' ORDER BY revision,id"):
        rule=dict(row)
        if rule['scope']=='global' or (format_id is not None and rule['format_id']==format_id):
            rule['origin']=json.loads(rule['origin']);result.append(rule)
    return result


def snapshot(queue, format_id=None):
    selected=rules(queue,format_id)
    return {'revision':_hash(selected),'rules':selected}


def learning_rows(queue):
    rows=[['rule_id','scope','rule','origin','state']]
    for r in _db(queue).execute('SELECT * FROM feedback_rules ORDER BY revision,id'):
        origin=json.loads(r['origin'])
        rows.append([r['id'],r['scope'] if r['scope']=='global' else 'format:'+r['format_id'],r['rule'],origin['feedback_id'],r['state']])
    return rows


def export_rules(queue, state_dir):
    root=Path(state_dir);root.mkdir(parents=True,exist_ok=True)
    all_rules=[]
    for r in _db(queue).execute('SELECT * FROM feedback_rules ORDER BY revision,id'):
        r=dict(r);r['origin']=json.loads(r['origin']);all_rules.append(r)
    payload={'revision':_hash(all_rules),'rules':all_rules}
    markdown='# Learned creative rules\n\n'+''.join('- '+r['id']+' ['+r['scope']+(':'+r['format_id'] if r['format_id'] else '')+'; '+r['state']+'] '+r['rule']+' (feedback '+r['origin']['feedback_id']+')\n' for r in all_rules)
    for name, data in [('rules.json',json.dumps(payload,ensure_ascii=False,indent=2)+'\n'),('rules.md',markdown)]:
        temporary=root/(name+'.tmp');temporary.write_text(data,encoding='utf-8');temporary.replace(root/name)
    return payload


def _frozen_job(package):
    import engine
    return engine.verify(package['bundle'])['payload']['job']


def _semantic_rules(values):
    if isinstance(values,dict):values=values.get('rules')
    if not isinstance(values,list):raise ValueError('Rule snapshot must be a list')
    result=set()
    for rule in values:
        if not isinstance(rule,dict) or rule.get('scope') not in ('global','format') or not isinstance(rule.get('rule'),str):
            raise ValueError('Malformed frozen rule')
        scope=rule['scope'];fmt=rule.get('format_id') if scope=='format' else None
        if scope=='format' and (not isinstance(fmt,str) or not fmt):raise ValueError('Missing rule format')
        result.add((scope,fmt,normalize(rule['rule'])))
    return sorted(result,key=lambda item:(item[0],item[1] or '',item[2]))


def _job_format(job):
    return job.get('generated',{}).get('format') or job.get('factory',{}).get('template')


def stale_rules(queue, package):
    """Require exact active semantic guidance, ignoring provenance and rule IDs."""
    try:
        job=_frozen_job(package)
        fmt=_job_format(job)
        return _semantic_rules(rules(queue,fmt)) != _semantic_rules(job.get('rule_snapshot',[]))
    except (ValueError,KeyError,TypeError,AttributeError,OSError):
        return True


def ensure_rule_jobs(queue):
    """Create a bounded refresh once per stale artifact/current semantic policy."""
    db=_db(queue);created=[]
    with queue.transaction():
        # A deterministic representative keeps simultaneous IG/FB artifacts one job.
        for row in db.execute("SELECT id FROM jobs WHERE status IN ('review','approved') ORDER BY id").fetchall():
            release=queue.get(row['id']);package=release['package']
            if blocked(queue,release['id']) or not stale_rules(queue,package):continue
            artifact=package['artifact_id']
            try:
                frozen=_frozen_job(package)
                semantics=_semantic_rules(rules(queue,_job_format(frozen)))
            except (ValueError,KeyError,TypeError,AttributeError,OSError):
                # Without verified frozen context there is no safe scoped repair.
                continue
            digest=_hash(['policy',artifact,semantics]);fid=_hash(['policy',artifact,digest])
            source=db.execute('SELECT * FROM feedback_sources WHERE release_id=?',(release['id'],)).fetchone()
            source_digest=source['digest'] if source is not None else _hash('')
            if source is None:
                db.execute('INSERT INTO feedback_sources VALUES(?,?,?,?,?)',(release['id'],artifact,package['media_sha256'],source_digest,''))
            cursor=db.execute('INSERT OR IGNORE INTO feedback_jobs(id,release_id,artifact_id,media_sha256,comment,digest,status,summary,created,updated,kind,source_digest) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
                (fid,release['id'],artifact,package['media_sha256'],
                 'Apply current persisted creative guidance to this exact video. Do not add new learnings.',
                 digest,'pending','Current scoped guidance requires fresh validation',_now(),_now(),'policy',source_digest))
            if cursor.rowcount:
                _revoke_artifact(queue,artifact,'Creative guidance changed '+fid)
                created.append(get(queue,fid))
    return created


def _prepare_learnings(learnings):
    if not isinstance(learnings,(list,tuple)) or len(learnings)>20:
        raise ValueError('At most 20 scoped learnings allowed')
    prepared=[]
    for learning in learnings:
        if not isinstance(learning,dict) or set(learning)-{'scope','format_id','rule','supersedes'}:
            raise ValueError('Invalid learning fields')
        scope=learning.get('scope');fmt=learning.get('format_id');text=learning.get('rule')
        supersedes=learning.get('supersedes',[])
        if scope not in ('global','format') or (scope=='format' and (not isinstance(fmt,str) or not fmt.strip() or len(fmt)>200)) or (scope=='global' and fmt is not None):
            raise ValueError('Explicit global or format scope required')
        if not isinstance(text,str) or not text.strip() or len(text)>2000 or not isinstance(supersedes,list) or any(not isinstance(s,str) for s in supersedes):
            raise ValueError('Bounded rule and supersedes IDs required')
        prepared.append((scope,fmt,text.strip(),supersedes))
    return prepared


def complete(queue, feedback_id, *, replacement_ids, current_feedback, summary, learnings=(), state_dir=None, defer_visible=False):
    """Commit after verified Drive and native replacement readbacks, never before.

    current_feedback is the freshly read original N cell. New release IDs must
    exist in queue and be unchecked review packages. Caller verifies media/QA.
    """
    db=_db(queue)
    if not isinstance(summary,str) or not summary.strip() or len(summary)>4000:
        raise ValueError('Bounded verified result summary required')
    if not isinstance(replacement_ids,(list,tuple)) or not replacement_ids or len(set(replacement_ids))!=len(replacement_ids):
        raise ValueError('Distinct verified replacement IDs required')
    prepared=_prepare_learnings(learnings)
    with queue.transaction():
        job=get(queue,feedback_id)
        if job['status']!='running':raise ValueError('Feedback is not running')
        if job.get('kind')=='policy' and prepared:raise ValueError('Policy refresh cannot add learnings')
        source=db.execute('SELECT * FROM feedback_sources WHERE release_id=?',(job['release_id'],)).fetchone()
        if source is None or source['digest']!=_owner_digest(job) or _hash(normalize(current_feedback))!=_owner_digest(job):
            raise ValueError('Owner feedback changed during repair')
        for key in replacement_ids:
            replacement=queue.get(key)
            if key==job['release_id'] or replacement['status']!='review' or replacement.get('approval_sha') or replacement.get('listened'):
                raise ValueError('Replacement must await fresh exact owner approval')
        origin={k:job[k] for k in ('release_id','artifact_id','comment','digest')};origin['feedback_id']=feedback_id
        revision=db.execute('SELECT COALESCE(MAX(revision),0)+1 FROM feedback_rules').fetchone()[0]
        for scope,fmt,text,supersedes in prepared:
            rid=_hash([feedback_id,scope,fmt,text])
            for old in supersedes:
                existing=db.execute('SELECT * FROM feedback_rules WHERE id=?',(old,)).fetchone()
                if existing is None or existing['scope']!=scope or existing['format_id']!=fmt:
                    raise ValueError('Supersession must name an existing same-scope rule')
                db.execute("UPDATE feedback_rules SET state='superseded' WHERE id=?",(old,))
            db.execute('INSERT OR IGNORE INTO feedback_rules VALUES(?,?,?,?,?,?,?)',(rid,scope,fmt,text,json.dumps(origin,ensure_ascii=False),'active',revision))
        for key in [job['release_id'],*replacement_ids]:
            db.execute('INSERT OR REPLACE INTO feedback_aliases VALUES(?,?,?)',(key,_owner_digest(job),feedback_id))
        status='resolved' if defer_visible else 'completed'
        db.execute('UPDATE feedback_jobs SET status=?,summary=?,updated=? WHERE id=?',(status,summary,_now(),feedback_id))
    if state_dir is not None:export_rules(queue,state_dir)
    return get(queue,feedback_id)


def record_learnings(queue, feedback_id, learnings, *, related_feedback_ids=()):
    """Promote a verified completed owner-feedback scope review into guidance.

    No producer is invoked here. Caller owns the once-per-new-feedback batch
    marker and external guide/Learnings synchronization before policy refresh.
    """
    db=_db(queue);prepared=_prepare_learnings(learnings)
    if not isinstance(related_feedback_ids,(list,tuple)) or len(related_feedback_ids)>20 or any(not isinstance(value,str) for value in related_feedback_ids):
        raise ValueError('Bounded completed feedback origins required')
    ids=list(dict.fromkeys([feedback_id,*related_feedback_ids]));result=[]
    with queue.transaction():
        jobs=[]
        for fid in ids:
            job=get(queue,fid)
            if job['status']!='completed' or job.get('kind')!='owner':
                raise ValueError('Learning review requires completed owner feedback')
            source=db.execute('SELECT digest FROM feedback_sources WHERE release_id=?',(job['release_id'],)).fetchone()
            if source is None or source['digest']!=job['digest']:
                raise ValueError('Completed owner feedback source changed')
            jobs.append(job)
        primary=jobs[0]
        origin={key:primary[key] for key in ('release_id','artifact_id','comment','digest')}
        origin.update(feedback_id=feedback_id,feedback_ids=ids,reason='completed-feedback scope review')
        # Retain each owner comment, even when its source row is archived later.
        origin['feedback_origins']=[{key:job[key] for key in ('id','release_id','artifact_id','comment','digest')} for job in jobs]
        revision=db.execute('SELECT COALESCE(MAX(revision),0)+1 FROM feedback_rules').fetchone()[0]
        for scope,fmt,text,supersedes in prepared:
            for old in supersedes:
                existing=db.execute('SELECT * FROM feedback_rules WHERE id=?',(old,)).fetchone()
                if existing is None or existing['scope']!=scope or existing['format_id']!=fmt:
                    raise ValueError('Supersession must name an existing same-scope rule')
            active=db.execute("SELECT * FROM feedback_rules WHERE state='active' AND scope=? AND format_id IS ? ORDER BY revision,id",(scope,fmt)).fetchall()
            match=next((rule for rule in active if normalize(rule['rule'])==normalize(text)),None)
            rid=match['id'] if match is not None else _hash(['completed-feedback scope review',feedback_id,scope,fmt,text])
            for old in supersedes:
                if old!=rid:db.execute("UPDATE feedback_rules SET state='superseded' WHERE id=?",(old,))
            if match is None:
                db.execute('INSERT OR IGNORE INTO feedback_rules VALUES(?,?,?,?,?,?,?)',(rid,scope,fmt,text,json.dumps(origin,ensure_ascii=False),'active',revision))
            result.append(rid)
    return result


def resolved(queue):
    """Verified replacements awaiting external learning/guide synchronization."""
    return [_job(row) for row in _db(queue).execute("SELECT * FROM feedback_jobs WHERE status='resolved' ORDER BY created,id")]


def finish(queue, feedback_id):
    """Expose Fixed only after caller's external rule/guide readbacks succeed."""
    db=_db(queue)
    with queue.transaction():
        job=get(queue,feedback_id)
        if job['status'] != 'resolved':
            raise ValueError('Feedback is not awaiting synchronization')
        source=db.execute('SELECT digest FROM feedback_sources WHERE release_id=?',(job['release_id'],)).fetchone()
        if source is None or source['digest'] != _owner_digest(job):
            raise ValueError('Owner feedback changed during synchronization')
        db.execute("UPDATE feedback_jobs SET status='completed',updated=? WHERE id=?",(_now(),feedback_id))
    return get(queue,feedback_id)


def status_rows(queue):
    """Worker O:P values keyed by original release; never includes owner cells."""
    result={}
    labels={'pending':'Pending','running':'Fixing','held':'Held','completed':'Fixed','superseded':'Superseded','resolved':'Syncing'}
    for row in _db(queue).execute('SELECT * FROM feedback_jobs ORDER BY created,id'):
        result[row['release_id']]=[labels[row['status']],row['summary'].replace('Video only; no reusable rule added.','Existing guidance applied; see Learnings.') if row['kind']=='policy' else row['summary']]
    for alias in queue.db.execute("SELECT a.release_id,j.summary,j.status,j.kind FROM feedback_aliases a JOIN feedback_jobs j ON a.feedback_id=j.id WHERE j.status IN ('completed','resolved') ORDER BY j.created DESC,j.id DESC"):
        result.setdefault(alias['release_id'],[labels[alias['status']],alias['summary'].replace('Video only; no reusable rule added.','Existing guidance applied; see Learnings.') if alias['kind']=='policy' else alias['summary']])
    for release in queue.db.execute('SELECT id,artifact FROM jobs').fetchall():
        blocking=queue.db.execute("SELECT j.status,j.summary FROM feedback_jobs j WHERE j.status IN ('pending','running','held','resolved') AND (j.artifact_id=? OR (j.status='resolved' AND EXISTS (SELECT 1 FROM feedback_aliases a WHERE a.feedback_id=j.id AND a.release_id=?))) ORDER BY j.created DESC,j.id DESC LIMIT 1",(release['artifact'],release['id'])).fetchone()
        if blocking:result[release['id']]=[labels[blocking['status']],blocking['summary']]
    return result
