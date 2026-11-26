"""Durable exact-package review and publication ledger. Runtime data stays local."""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
import hashlib
import json
from pathlib import Path
import sqlite3
from urllib.parse import urlsplit
import engine
import ops
import creative_verification
import feedback
from zoneinfo import ZoneInfo


DOCUMENT_SOURCES={'mea-beclick-kb/content-library.md','mea-beclick-kb/creative-video-machine.md','mea-beclick-kb/gtm-operating-model.md','marketing/content-library/AUDIO-WORKFLOW.md','marketing/content-library/AUTOMATION-ROADMAP.md','marketing/content-library/MACHINE.md','marketing/content-library/GOOGLE-SYNC.md'}

def now():return datetime.now(timezone.utc).isoformat()
def digest(value):return hashlib.sha256(engine.canonical(value)).hexdigest()

def require_preview_binding(package):
    preview=urlsplit(package.get('preview_url',''))
    if preview.netloc!='drive.google.com':return
    receipt=package.get('drive_receipt') or {}
    file_id=receipt.get('file_id') or receipt.get('id')
    manifest=engine.verify(package['bundle']);media=Path(package['bundle'])/'asset.mp4'
    if (not file_id or preview.path!='/file/d/'+file_id+'/view' or
        not receipt.get('revision_id') or receipt.get('needs_verification') is not False or
        receipt.get('sha256')!=manifest['payload']['media']['sha256'] or
        receipt.get('md5Checksum')!=hashlib.md5(media.read_bytes()).hexdigest()):
        raise ValueError('Exact Drive revision receipt is required')


class Queue:
    def __init__(self,path,policy=None):
        self.policy=dict(policy or {})
        path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
        self.db=sqlite3.connect(path,timeout=30,isolation_level=None)
        self.db.row_factory=sqlite3.Row
        self.db.executescript('''PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, artifact TEXT NOT NULL, network TEXT NOT NULL, account TEXT NOT NULL, package TEXT NOT NULL, status TEXT NOT NULL, approval_sha TEXT, approver TEXT, listened INTEGER DEFAULT 0, receipt TEXT, updated TEXT NOT NULL, UNIQUE(artifact,network,account));
        CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, job TEXT, action TEXT, detail TEXT, created TEXT);
        CREATE TABLE IF NOT EXISTS observations (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
        ''')
        feedback.init(self)
    def close(self):
        if getattr(self,'db',None) is not None:self.db.close();self.db=None
    def __del__(self):
        self.close()

    @contextmanager
    def transaction(self):
        self.db.execute('BEGIN IMMEDIATE')
        try:yield;self.db.execute('COMMIT')
        except BaseException:self.db.execute('ROLLBACK');raise
    def event(self,key,action,detail=''):
        self.db.execute('INSERT INTO events(job,action,detail,created) VALUES(?,?,?,?)',(key,action,detail,now()))
    def get(self,key):
        row=self.db.execute('SELECT * FROM jobs WHERE id=?',(key,)).fetchone()
        if row is None:raise ValueError('Unknown job')
        result=dict(row);result['package']=json.loads(result['package'])
        if result['receipt']:result['receipt']=json.loads(result['receipt'])
        return result
    def enqueue(self,package):
        package=dict(package)
        required={'bundle','caption','cta','network','account','scheduled_at'}
        if not required<=package.keys():raise ValueError('Incomplete publication package')
        if package['network'] not in ('instagram','facebook'):raise ValueError('Unsupported network')
        if not all(isinstance(package[k],str) and package[k].strip() for k in required):raise ValueError('Empty publication field')
        instant=datetime.fromisoformat(package['scheduled_at'])
        if instant.tzinfo is None:raise ValueError('Schedule must include timezone')
        bundle=Path(package['bundle']).resolve();manifest=engine.verify(bundle)
        package.update(bundle=str(bundle),artifact_id=manifest['artifact_id'],media_sha256=manifest['payload']['media']['sha256'])
        key=digest(package)
        with self.transaction():
            existing=self.db.execute('SELECT id FROM jobs WHERE artifact=? AND network=? AND account=?',(package['artifact_id'],package['network'],package['account'])).fetchone()
            if existing:
                if existing['id']!=key:raise ValueError('Artifact already queued with a different package; cancel explicitly first')
                return key
            self.db.execute('INSERT INTO jobs(id,artifact,network,account,package,status,updated) VALUES(?,?,?,?,?,?,?)',(key,package['artifact_id'],package['network'],package['account'],json.dumps(package,ensure_ascii=False),'review',now()))
            self.event(key,'enqueued')
        return key
    def validate(self,key):
        job=self.get(key);p=job['package'];manifest=engine.verify(p['bundle'])
        if digest(p)!=key or manifest['artifact_id']!=p['artifact_id'] or manifest['payload']['media']['sha256']!=p['media_sha256']:raise ValueError('Package changed')
        return job
    def approve(self,key,approver,listened=False):
        if not isinstance(approver,str) or not approver.strip():raise ValueError('Approver required')
        with self.transaction():
            job=self.validate(key)
            if job['status']!='review':raise ValueError('Only review packages may be approved')
            if feedback.blocked(self,key) or feedback.stale_rules(self,job['package']):raise ValueError('Unresolved owner feedback or current guidance blocks approval')
            require_preview_binding(job['package'])
            creative_verification.require(job['package'])
            report=job['package'].get('qa')
            if not report or report.get('technical_pass') is not True:raise ValueError('Technical QA required')
            if report and (report.get('artifact_id')!=job['artifact'] or report.get('media_sha256')!=job['package']['media_sha256']):raise ValueError('QA identity mismatch')
            mode=engine.verify(job['package']['bundle'])['payload']['job'].get('constraints',{}).get('audio','silent')
            if type(report.get('listening_required')) is not bool or (mode!='silent' and report['listening_required'] is not True):raise ValueError('Audio listening gate disagrees with frozen manifest')
            if report and report.get('listening_required') and not listened:raise ValueError('Human listening required')
            self.db.execute('UPDATE jobs SET status=?,approval_sha=?,approver=?,listened=?,updated=? WHERE id=?',('approved',key,approver,int(listened),now(),key));self.event(key,'approved',approver)
    def cancel(self,key,reason):
        if not reason.strip():raise ValueError('Cancellation reason required')
        with self.transaction():
            job=self.get(key)
            if job['status'] not in ('review','approved'):raise ValueError('Submitted releases require provider cancellation and reconciliation')
            self.event(key,'cancelled',json.dumps({'reason':reason,'archived_job':job},ensure_ascii=False))
            self.db.execute('DELETE FROM jobs WHERE id=?',(key,))

    def expire_unsent(self, current):
        """Terminally record elapsed slots with no provider submission intent."""
        with self.transaction():
            for job in self.rows():
                if job['status'] in ('review','approved') and ops.instant(job['package']['scheduled_at']) <= current:
                    self.db.execute("UPDATE jobs SET status='failed',updated=? WHERE id=?", (now(),job['id']))
                    self.event(job['id'], 'schedule_expired', 'No provider submission before the approved slot elapsed.')

    def hold(self,key,reason):
        with self.transaction():
            job=self.get(key)
            if job['status']=='approved':
                self.db.execute('UPDATE jobs SET status=?,approval_sha=NULL,approver=NULL,listened=0,updated=? WHERE id=?',('review',now(),key));self.event(key,'approval_revoked',reason)
            elif job['status'] not in ('review','failed'):raise ValueError('Already submitted release requires provider reconciliation/cancellation')

    def submission_package(self,key):
        """Read-only preflight before public staging; begin_submission rechecks it."""
        job=self.validate(key)
        if job['status']!='approved' or job['approval_sha']!=key:raise ValueError('Submission requires a current exact approval; uncertain intents cannot retry')
        if feedback.blocked(self,key) or feedback.stale_rules(self,job['package']):raise ValueError('Unresolved owner feedback or current guidance blocks submission')
        require_preview_binding(job['package'])
        creative_verification.require(job['package'])
        slot=ops.instant(job['package']['scheduled_at']).astimezone(ZoneInfo('Asia/Jerusalem'))
        if slot<=datetime.now(ZoneInfo('Asia/Jerusalem')):raise ValueError('Scheduled time has passed; create a newly reviewed package')
        active=[r for r in self.rows() if r['status'] in ('uncertain','scheduled','published')]
        dates=[ops.instant(r['package']['scheduled_at']).astimezone(ZoneInfo('Asia/Jerusalem')) for r in active]
        if self.policy.get('content_review_sheet_id') is not None:
            from content_review import content_id
            current=content_id(job['package'])
            copies={content_id(r['package']):r['package']['scheduled_at'] for r in active if content_id(r['package'])!=current}
            dates=[ops.instant(value).astimezone(ZoneInfo('Asia/Jerusalem')) for value in copies.values()]
        gate=ops.submission_gate(paused=self.policy.get('paused',False),credentials_healthy=self.policy.get('credentials_healthy',False),approved=True,reconciliation_clear=not any(r['status']=='uncertain' for r in active),daily_deliveries=sum(d.date()==slot.date() for d in dates),monthly_deliveries=sum((d.year,d.month)==(slot.year,slot.month) for d in dates),daily_limit=self.policy.get('daily_limit',1 if self.policy.get('daily_calendar_enabled') else 2),monthly_limit=self.policy.get('monthly_limit',31 if self.policy.get('daily_calendar_enabled') else 20),cta=job['package']['cta'],capacity=self.policy.get('capacity'))
        if not gate['allowed']:raise ValueError('Submission blocked: '+','.join(gate['reasons']))
        return job['package']
    def begin_submission(self,key):
        with self.transaction():
            package=self.submission_package(key)
            self.db.execute('UPDATE jobs SET status=?,updated=? WHERE id=?',('uncertain',now(),key));self.event(key,'submission_intent')
        return package
    def receipt(self,key,receipt):
        if receipt.get('status') not in ('scheduled','published','failed') or not receipt.get('id') or not receipt.get('provider'):raise ValueError('Verified provider receipt required')
        with self.transaction():
            job=self.get(key)
            if job['status'] not in ('uncertain','scheduled'):raise ValueError('No submission intent to reconcile')
            if any(receipt.get(k)!=v for k,v in {'package_sha256':key,'network':job['network'],'account':job['account']}.items()):raise ValueError('Receipt destination/package mismatch')
            for other in self.rows():
                old=other['receipt']
                if other['id']!=key and old and (old['provider'],old['id'])==(receipt['provider'],receipt['id']):raise ValueError('Provider receipt already bound')
            if job['receipt'] and job['receipt']['provider']!=receipt['provider']:raise ValueError('Provider changed')
            if job['receipt'] and job['receipt']['id']!=receipt['id']:raise ValueError('Provider post ID changed')
            self.db.execute('UPDATE jobs SET status=?,receipt=?,updated=? WHERE id=?',(receipt['status'],json.dumps(receipt),now(),key));self.event(key,'provider_receipt',receipt['status'])
    def rows(self):return [self.get(r[0]) for r in self.db.execute('SELECT id FROM jobs ORDER BY updated')]


def _buffer_cooldown(path, error):
    delay = getattr(error, 'retry_after', None)
    if type(delay) is not int or delay < 1:
        return None
    retry_at = datetime.now(timezone.utc) + timedelta(seconds=delay)
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps({'retry_at':retry_at.isoformat()}))
    temp.replace(path)
    return retry_at


def _due_buffer_jobs(queue, current, limit=4):
    """Only check deliveries after their times and give transient states six hours."""
    cutoff = current - timedelta(hours=1)
    eligible = []
    for job in queue.rows():
        if job['status'] != 'scheduled' or ops.instant(job['package']['scheduled_at']) > cutoff:
            continue
        last = queue.db.execute(
            "SELECT created FROM events WHERE action='buffer_delivery_poll' AND job=? ORDER BY id DESC LIMIT 1",
            (job['id'],)
        ).fetchone()
        if last is None or (current-ops.instant(last[0])) >= timedelta(hours=6):
            eligible.append(job)
        if len(eligible) == limit:
            break
    return eligible


def tick(config):
    """Run bounded preparation and report real external readiness under one process lock."""
    import fcntl
    import google_sync
    config_path=Path(config).resolve();cfg=json.loads(config_path.read_text());root=Path(cfg['state_dir']).expanduser().resolve();root.mkdir(parents=True,exist_ok=True)
    with (root/'runner.lock').open('a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:return {'ready':False,'blocker_codes':['runner_busy'],'problems':['Another preparation run holds the lock']}
        import feedback_workflow
        cfg=feedback_workflow.configure(cfg,root)
        problems=[];codes=[];prepared=None;google=None;snapshot={};feedback_report=None;content_reviews=None;autonomous_report=None
        q=Queue(root/'queue.sqlite3',policy=cfg)
        if cfg.get('daily_calendar_enabled'):
            q.expire_unsent(datetime.now(timezone.utc))
        def blocked(code,message):codes.append(code);problems.append(message)
        if cfg.get('paused',False):blocked('paused','Paused by owner')
        if cfg.get('google_credentials'):
            try:
                google=google_sync.GoogleSync(google_sync.load_credentials(cfg['google_credentials']))
                snapshot=google.snapshot(cfg['spreadsheet_id'],cfg.get('bounds',{'Queue':40,'Components':80,'Recipes':40,'References':40,'Ideas':50}),cfg.get('batch','weekly'))
                path=root/'native-snapshot.json';path.write_text(json.dumps(snapshot,ensure_ascii=False,indent=2)+'\n');cfg['snapshot_file']=str(path)
            except Exception as exc:
                google=None;blocked('google_auth_or_sync','Google background access failed ('+type(exc).__name__+'); restore consent/access and inspect retained intents.')
        else:blocked('google_credentials_missing','Unattended Google credentials missing; current local catalog can still prepare the launch.')
        if google and cfg.get('content_review_sheet_id') is not None:
            try:
                import content_review
                content_reviews=content_review.attach(google,cfg,q,root)
                content_reviews.sync()
            except Exception as exc:
                cfg['prepare_enabled']=False;blocked('content_review_failed','Content approval sync failed ('+type(exc).__name__+'); exact owner decisions are preserved.')
        today=datetime.now(ZoneInfo('Asia/Jerusalem')).date()
        if cfg.get('auto_plan') and cfg.get('autonomous_content_enabled') is not True and str(today)>cfg.get('launch_through',''):
            if google is None:
                cfg['prepare_enabled']=False;blocked('fresh_catalog_required','Next weekly batch waits for a fresh native catalog; launch seeds will not be recycled with past dates.')
            else:
                import planner
                previous=Queue(root/'queue.sqlite3')
                observations=[json.loads(row[0]) for row in previous.db.execute('SELECT payload FROM observations')];previous.close()
                weekly=planner.weekly_plan(snapshot,str(today),observations)
                (root/'weekly-proposal.json').write_text(json.dumps(weekly,ensure_ascii=False,indent=2)+'\n')
                snapshot['batch']=weekly['batch'];path.write_text(json.dumps(snapshot,ensure_ascii=False,indent=2)+'\n')
                cfg.update(requests=weekly['requests'],slots=weekly['slots'],seed_bundles=[])
                if not weekly['requests']:blocked('planner_attention','No compatible weekly recipes available; inspect weekly-proposal.json')
        publisher_configs=cfg.get('publishers',[cfg.get('publisher',{})]);publisher_verified=False;publisher_identity=None;verified_publishers={};publisher_identities=[]
        pause_file = root/'buffer-read-cooldown.json'
        check_buffer = True
        due_deliveries = []
        due_reconciliations = []
        if cfg.get('daily_calendar_enabled'):
            current = datetime.now(timezone.utc)
            due_deliveries = _due_buffer_jobs(q, current)
            due_reconciliations = [q.get(row[0]) for row in q.db.execute(
                """SELECT jobs.id FROM jobs WHERE status='uncertain'
                AND EXISTS (SELECT 1 FROM events WHERE job=jobs.id AND action='buffer_response')
                AND NOT EXISTS (SELECT 1 FROM events WHERE job=jobs.id
                    AND action='buffer_reconcile_poll' AND created>?)
                ORDER BY jobs.updated LIMIT 4""",
                ((current - timedelta(hours=6)).isoformat(),),
            )]
            pending_release = any(row['status']=='approved' and ops.instant(row['package']['scheduled_at'])>current for row in q.rows())
            check_buffer = cfg.get('buffer_create_enabled', True) and not cfg.get('paused') and bool(
                pending_release or due_deliveries or due_reconciliations)
            if pause_file.exists():
                retry_at = ops.instant(json.loads(pause_file.read_text())['retry_at'])
                if retry_at > datetime.now(timezone.utc):
                    check_buffer = False
                    blocked('buffer_rate_limited', 'Buffer retry after '+retry_at.isoformat())
        if check_buffer:
            try:
                import buffer_scheduler
                if cfg.get('auto_discover_publishers'):
                    publisher_configs=buffer_scheduler.discover_publishers(publisher_configs)
                    cfg['destinations']=[{'network':p['network'],'account':p['channel_id']} for p in publisher_configs]
                if not isinstance(publisher_configs,list) or not 1<=len(publisher_configs)<=20:raise ValueError('Bounded Buffer destinations required')
                for publisher in publisher_configs:
                    network=publisher.get('network','instagram')
                    identity=buffer_scheduler.verify_connection(publisher)
                    destination=(network,identity['id'])
                    if destination in verified_publishers:raise ValueError('Duplicate publishing destination')
                    verified_publishers[destination]=publisher
                    publisher_identities.append({'network':network,'account':identity['id'],'name':identity.get('name')})
                publisher_verified=True;publisher_identity=publisher_identities[0]
            except Exception as exc:
                retry_at = _buffer_cooldown(pause_file, exc) if cfg.get('daily_calendar_enabled') else None
                if retry_at:
                    blocked('buffer_rate_limited', 'Buffer retry after '+retry_at.isoformat())
                else:
                    blocked('publisher_unverified','Buffer destination authorization failed ('+type(exc).__name__+'); inspect the configured accounts.')
        expected_destinations={(i['network'],i['account']) for i in publisher_identities}
        if publisher_verified and (not cfg.get('destinations') or {(d.get('network'),d.get('account')) for d in cfg['destinations']}!=expected_destinations):
            cfg['prepare_enabled']=False
            blocked('destination_mismatch','Configure only the independently verified Buffer channels.')
        q.policy={**cfg,'credentials_healthy':publisher_verified}
        if google and cfg.get('feedback_enabled') and not cfg.get('paused'):
            try:
                feedback_report=feedback_workflow.run(google,cfg,q,root)
                if content_reviews:content_reviews.sync()
                if feedback_report.get('learning',{}).get('status') in ('held','running'):blocked('learning_review_held','Feedback correction completed but reusable guidance requires reconciliation; retained learning evidence is preserved.')
                cfg=feedback_workflow.configure(cfg,root)
                cfg['creative_preferences']=[r for r in feedback.export_rules(q,root/'knowledge')['rules'] if r['state']=='active']
                cfg['held_work_items']=[engine.verify(j['package']['bundle'])['payload']['job']['post']['id']+'@'+j['package']['scheduled_at'] for j in q.rows() if feedback.blocked(q,j['id']) or feedback.stale_rules(q,j['package'])]
            except Exception as exc:
                cfg['prepare_enabled']=False
                blocked('feedback_sync_failed','Feedback workflow requires attention ('+type(exc).__name__+'); retained jobs and write intents are preserved.')
        retained=root/'uploaded-previews.json'
        if retained.exists():cfg['preview_urls']={**json.loads(retained.read_text()),**cfg.get('preview_urls',{})}
        if not cfg.get('paused',False):
            try:
                if cfg.get('autonomous_content_enabled') is True:
                    import autonomous
                    autonomous_report=autonomous.run(cfg,root,google,snapshot,q,
                                                     on_review_ready=content_reviews.sync if content_reviews else None)
                    prepared={'enabled':True,'prepared':autonomous_report['prepared'],'problems':autonomous_report['problems']}
                    if autonomous_report['prepared'] and not google:blocked('asset_store_unavailable','Autonomous candidates need Google Drive storage before owner review.')
                    if google:
                        previews = dict(cfg.get('preview_urls', {}))
                        previews.update({item['artifact_id']: item['preview_url'] for item in autonomous_report['prepared'] if item.get('preview_kind')=='hosted'})
                        (root/'uploaded-previews.json').write_text(json.dumps(previews,indent=2)+'\n')
                else:
                    import preparation
                    prepared=preparation.prepare({**cfg,'destinations':[]},root)
                    if google and cfg.get('drive_posts_folder_id'):
                        import drive_assets
                        previews=dict(cfg.get('preview_urls',{}));receipts={}
                        asset_queue=Queue(root/'queue.sqlite3')
                        try:
                            for item in prepared.get('prepared',[]):
                                if item.get('verification_status')!='ready_for_human':continue
                                receipt=drive_assets.store(google,item,cfg,root,queue=asset_queue)
                                previews[item['artifact_id']]=receipt['webViewLink']
                                receipts[item['artifact_id']]=receipt
                        finally:asset_queue.close()
                        cfg.update(preview_urls=previews,drive_receipts=receipts)
                        (root/'uploaded-previews.json').write_text(json.dumps(previews,indent=2)+'\n')
                        prepared=preparation.prepare(cfg,root)
                    elif prepared.get('prepared'):
                        blocked('asset_store_unavailable','Verified previews require the per-post Drive asset store before owner review.')
                if autonomous_report is None or not cfg.get('daily_calendar_enabled'):
                    for problem in prepared.get('problems',[]):blocked('preparation_attention',problem)
            except Exception as exc:blocked('preparation_failed','Preparation failed ('+type(exc).__name__+'): '+str(exc)[:240])
        q.policy={**cfg,'credentials_healthy':publisher_verified}
        has_release_tab=type(cfg.get('releases_sheet_id')) is int and cfg['releases_sheet_id']>=0
        if publisher_verified and not has_release_tab:
            blocked('owner_review_unavailable','Configure the verified native Releases tab before automatic Buffer submission; fresh owner decisions are required.')
        if google:
            try:
                for row in q.rows():
                    if row['status'] not in ('review','approved'):continue
                    job=q.validate(row['id']);package=job['package']
                    require_preview_binding(package)
                    if not package.get('drive_receipt'):raise ValueError('Legacy preview requires explicit verified revision migration')
                    google.verify_preview(Path(package['bundle'])/'asset.mp4',package['preview_url'],**({'expected_revision_id':package['drive_receipt']['revision_id']} if package.get('drive_receipt') else {}))
            except Exception as exc:
                blocked('preview_mismatch','Exact Drive review video verification failed ('+type(exc).__name__+'); owner approval import and scheduling are held.')
        if google and has_release_tab and 'preview_mismatch' not in codes:
            try:
                if content_reviews:content_reviews.sync()
                google.sync_releases(cfg['spreadsheet_id'],cfg['releases_sheet_id'],q,root/'google-intents')
            except Exception as exc:blocked('release_review_sync','Native release review sync failed ('+type(exc).__name__+'); inspect preserved decisions and retained intents.')
        if google and cfg.get('feedback_enabled') and has_release_tab:
            try:feedback_workflow.ingest(google,cfg,q)
            except Exception as exc:blocked('feedback_refresh_failed','Final feedback refresh failed ('+type(exc).__name__+'); no submission attempted.')
        reconciliations = []
        if publisher_verified:
            for job in due_reconciliations:
                destination = (job['network'], job['account'])
                if destination not in verified_publishers:
                    continue
                try:
                    q.event(job['id'], 'buffer_reconcile_poll')
                    receipt = buffer_scheduler.reconcile_saved_post(q, job['id'], verified_publishers[destination])
                    reconciliations.append(receipt)
                    if receipt['status'] == 'failed':
                        blocked('buffer_delivery_failed', 'Buffer reported a failed delivery on '+job['network']+'.')
                except Exception as exc:
                    retry_at = _buffer_cooldown(pause_file, exc)
                    if retry_at:
                        blocked('buffer_rate_limited', 'Buffer retry after '+retry_at.isoformat())
                        break
        submissions=[]
        if publisher_verified and any(r['status']=='uncertain' for r in q.rows()):blocked('reconciliation_required','A Buffer submission is uncertain; reconcile its retained response before any further write.')
        if publisher_verified and google and not codes and cfg.get('buffer_create_enabled', True):
            if cfg.get('daily_calendar_enabled'):
                import planner
                last_release_day = planner.upcoming_days(datetime.now(timezone.utc))[6]
            for job in q.rows():
                if job['status']!='approved' or feedback.blocked(q,job['id']):continue
                destination=(job['network'],job['account'])
                if destination not in verified_publishers:continue
                slot = ops.instant(job['package']['scheduled_at'])
                if cfg.get('daily_calendar_enabled') and slot.astimezone(planner.CALENDAR_ZONE).date() > last_release_day:
                    continue
                if slot<=datetime.now(timezone.utc):
                    blocked('schedule_expired','An approved content schedule has passed; choose a new time and review that version. Other future schedules can continue.')
                    continue
                try:
                    if content_reviews:content_reviews.refresh_decisions(job['id'])
                    if cfg.get('feedback_enabled'):
                        feedback_workflow.ingest(google,cfg,q)
                        feedback.ensure_rule_jobs(q)
                        if q.get(job['id'])['status']!='approved' or feedback.blocked(q,job['id']) or feedback.stale_rules(q,job['package']):continue
                    if q.get(job['id'])['status']!='approved':continue
                    submissions.append(buffer_scheduler.schedule(q,job['id'],verified_publishers[destination]))
                except Exception as exc:
                    retry_at = _buffer_cooldown(pause_file, exc) if cfg.get('daily_calendar_enabled') else None
                    if retry_at:
                        blocked('buffer_rate_limited', 'Buffer retry after '+retry_at.isoformat())
                    blocked('submission_attention','Buffer submission needs attention ('+type(exc).__name__+'); inspect retained state before any retry.')
                    break
        deliveries = []
        if publisher_verified and 'buffer_rate_limited' not in codes:
            for job in due_deliveries:
                destination = (job['network'], job['account'])
                if destination not in verified_publishers:
                    continue
                try:
                    # Persist the poll time before the read, so crashes cannot cause rapid retries.
                    q.event(job['id'], 'buffer_delivery_poll')
                    receipt = buffer_scheduler.verify_delivery(q, job['id'], verified_publishers[destination])
                    if receipt:
                        deliveries.append(receipt)
                    if receipt and receipt['status'] == 'failed':
                        blocked('buffer_delivery_failed', 'Buffer reported a failed delivery on '+job['network']+'.')
                except Exception as exc:
                    retry_at = _buffer_cooldown(pause_file, exc)
                    if retry_at:
                        blocked('buffer_rate_limited', 'Buffer retry after '+retry_at.isoformat())
                        break
                    blocked('buffer_delivery_unverified', 'Buffer delivery readback failed ('+type(exc).__name__+').')
        if google and has_release_tab and (submissions or deliveries or reconciliations):
            try:
                google.sync_releases(cfg['spreadsheet_id'],cfg['releases_sheet_id'],q,root/'google-intents')
                if content_reviews:content_reviews.sync()
            except Exception as exc:blocked('post_status_sync_failed','Buffer receipt is retained; native status writeback failed ('+type(exc).__name__+').')
        if publisher_verified:
            if 'reconciliation_required' not in codes and any(r['status']=='uncertain' for r in q.rows()):blocked('reconciliation_required','A Buffer submission is uncertain; reconcile its retained response before any further write.')
            if any(r['status']=='review' for r in q.rows()):blocked('approval_missing','Exact content versions await owner approval; nothing unapproved is scheduled.')
        if autonomous_report and cfg.get('daily_calendar_enabled'):
            import planner
            days = planner.upcoming_days(datetime.now(timezone.utc))
            gaps = planner.publishing_gaps(days[:7], q.rows(), cfg.get('destinations', []))
            autonomous_report['buffer_gaps'] = gaps
            if google:
                try:
                    google.sync_daily_calendar(cfg['spreadsheet_id'], autonomous_report['calendar'],
                                               gaps, root/'google-intents')
                except Exception as exc:
                    blocked('calendar_sync_failed', 'Daily Calendar sync failed ('+type(exc).__name__+')')
            if gaps:blocked('daily_calendar_gaps', 'Missing verified Buffer slots: ' + ', '.join(gaps))
            for problem in (prepared or {}).get('problems', []):blocked('preparation_attention', problem)
        document_sync=[]
        if google and cfg.get('document_mirrors'):
            try:
                entries=cfg['document_mirrors']
                if not isinstance(entries,list) or len(entries)>len(DOCUMENT_SOURCES):raise ValueError('Use only the bounded workflow document list')
                if len({e['source'] for e in entries})!=len(entries):raise ValueError('Duplicate document source')
                for entry in entries:
                    if entry['source'] not in DOCUMENT_SOURCES:raise ValueError('Document source outside workflow allowlist')
                    document_sync.append(google.mirror_document(Path(__file__).resolve().parents[2]/entry['source'],entry['file_id'],root/'google-intents'))
            except Exception as exc:blocked('document_sync_failed','Workflow mirror sync failed ('+type(exc).__name__+'); inspect source and independent Drive edits.')
        report={'checked_at':now(),'ready':not problems,'preparation_ready':bool(prepared and prepared.get('enabled') and prepared.get('prepared') and not prepared.get('problems')),'publisher_verified':publisher_verified,'publisher_identity':publisher_identity,'publisher_identities':publisher_identities,'feedback':feedback_report,'autonomous_content':autonomous_report,'submissions':submissions,'deliveries':deliveries,'blocker_codes':codes,'problems':problems,'document_sync':document_sync,'google_sync_ready':bool(google and not any(c in codes for c in ('google_auth_or_sync','release_review_sync','document_sync_failed','preparation_failed','preview_mismatch'))),'preparation':prepared,'jobs':[{'id':r['id'],'artifact':r['artifact'],'network':r['network'],'status':r['status'],'scheduled_at':r['package']['scheduled_at']} for r in q.rows()]}
        report['reconciliations'] = reconciliations
        q.close()
        dest=root/'health.json';tmp=dest.with_suffix('.tmp');tmp.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');tmp.replace(dest)
        return report


def import_results(queue,records):
    result=ops.summarize_results(records)
    normalized=[]
    for record in records:
        value=dict(record)
        for k in ('window_start','window_end'):value[k]=ops.instant(value[k]).isoformat()
        identity={k:value.get(k) for k in ('provider','network','account','provider_post_id','artifact_id','window_start','window_end')}
        normalized.append((digest(identity),value))
    with queue.transaction():
        for identity,record in normalized:
            known=[r for r in queue.rows() if r['receipt'] and r['receipt']['id']==record['provider_post_id'] and r['artifact']==record['artifact_id'] and r['network']==record.get('network') and r['account']==record.get('account') and r['receipt']['provider']==record.get('provider')]
            if len(known)!=1:raise ValueError('Result does not match one actual provider receipt')
            existing=queue.db.execute('SELECT payload FROM observations WHERE id=?',(identity,)).fetchone()
            if existing and json.loads(existing[0])!=record:raise ValueError('Observation window already stored with different metrics; reconcile the correction explicitly')
            queue.db.execute('INSERT OR IGNORE INTO observations VALUES(?,?)',(identity,json.dumps(record,ensure_ascii=False)))
    result['next_experiment']=ops.next_experiment(records)
    return result


def main():
    parser=argparse.ArgumentParser();sub=parser.add_subparsers(dest='command',required=True)
    for name in ('tick','status'):
        p=sub.add_parser(name);p.add_argument('--config',required=True)
    p=sub.add_parser('approve');p.add_argument('--db',required=True);p.add_argument('--id',action='append',required=True);p.add_argument('--approver',required=True);p.add_argument('--listened',action='store_true')
    p=sub.add_parser('import-decisions');p.add_argument('--db',required=True);p.add_argument('--rows',required=True)
    p=sub.add_parser('cancel');p.add_argument('--db',required=True);p.add_argument('--id',required=True);p.add_argument('--reason',required=True)
    p=sub.add_parser('receipt');p.add_argument('--db',required=True);p.add_argument('--id',required=True);p.add_argument('--file',required=True)
    p=sub.add_parser('results');p.add_argument('--db',required=True);p.add_argument('--file',required=True)
    args=parser.parse_args()
    if args.command=='tick':result=tick(args.config)
    elif args.command=='status':
        cfg=json.loads(Path(args.config).read_text());result=json.loads((Path(cfg['state_dir'])/'health.json').read_text())
    elif args.command=='approve':
        queue=Queue(args.db)
        # Prevalidate every record before applying the batch.
        for key in args.id:
            job=queue.validate(key)
            if job['status']!='review':raise ValueError('Batch contains a non-review package')
            qa=job['package'].get('qa',{})
            if not qa.get('technical_pass') or (qa.get('listening_required') and not args.listened):raise ValueError('Technical/listening gate pending')
        for key in args.id:queue.approve(key,args.approver,args.listened)
        result={'approved':args.id}
    elif args.command=='import-decisions':
        import review_queue
        result={'approved':review_queue.import_decisions(Queue(args.db),json.loads(Path(args.rows).read_text()))}
    elif args.command=='cancel':
        Queue(args.db).cancel(args.id,args.reason);result={'cancelled':args.id}
    elif args.command=='receipt':
        import publisher
        publisher.import_receipt(Queue(args.db),args.id,json.loads(Path(args.file).read_text()));result={'reconciled':args.id}
    else:
        result=import_results(Queue(args.db),json.loads(Path(args.file).read_text()))
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
