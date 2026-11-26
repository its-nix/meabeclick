"""Deterministic controller for idea inventory, generated projects, and review batches."""
from datetime import datetime, timezone, timedelta
import json
from pathlib import Path
from zoneinfo import ZoneInfo

import content_pipeline
import idea_generation
import planner
import ops


def _now(value=None):
    current=value or datetime.now(timezone.utc)
    if current.tzinfo is None:raise ValueError('Autonomous controller time must include a timezone')
    return current.astimezone(timezone.utc).isoformat()


def _idea_context(cfg,snapshot,weekly_target,store,queue):
    context=dict(cfg.get('ideation_context') or {})
    context['ready_per_week']=weekly_target
    recent = [json.loads(row['payload_json']) for row in store.db.execute(
        "SELECT payload_json FROM concepts WHERE status IN ('production_ready','selected','producing','produced','held') "
        "ORDER BY created_at DESC,id DESC LIMIT 40")]
    retained = [concept.get('hook_he') for concept in recent]
    context['recent_hooks'] = list(dict.fromkeys(
        hook for hook in [*context.get('recent_hooks', []), *retained] if isinstance(hook, str) and hook
    ))[-40:]
    fields = ('audience', 'format', 'hook_he', 'premise', 'payoff')
    context['recent_concepts'] = [
        {field: concept[field][:240] for field in fields if isinstance(concept.get(field), str)}
        for concept in recent[:20]
    ]
    rows=snapshot.get('ideas',[])
    context['historical_ideas']=[{'hook_he':str(row[2])[:100]} for row in rows if isinstance(row,list) and len(row)>2 and row[2]]
    context['active_rules']=cfg.get('creative_preferences',context.get('active_rules',[]))
    evidence={row['artifact_id']:{**json.loads(row['payload_json']),'concept_id':row['concept_id']} for row in store.db.execute('SELECT concept_id,artifact_id,payload_json FROM content_items WHERE artifact_id IS NOT NULL')}
    observations=[]
    for row in queue.db.execute('SELECT payload FROM observations ORDER BY id DESC LIMIT 40'):
        record=json.loads(row['payload']);lineage=evidence.get(record.get('artifact_id'),{})
        observed=ops.summarize_results([record])['posts'][0]
        observations.append({'concept_id':lineage.get('concept_id'),'audience':lineage.get('audience'),'format':lineage.get('format'),
                             'artifact_id':observed['artifact_id'],'window_start':observed['window_start'],'window_end':observed['window_end'],
                             'metrics':observed['metrics'],'conversion_attribution':observed['conversion_attribution'],'gaps':observed['gaps']})
    context['outcome_summary']=observations
    try:
        rows=queue.db.execute("SELECT scope,format_id,count(*) AS n FROM feedback_rules WHERE state='active' GROUP BY scope,format_id ORDER BY scope,format_id").fetchall()
        context['completed_feedback_summary']=[{'scope':row['scope'],'format':row['format_id'],'active_rule_count':row['n']} for row in rows]
    except Exception:context.setdefault('completed_feedback_summary',[])
    return context


def _batch_records(store,queue,now,*,held_artifacts=()):
    jobs_by_batch = {}
    queue_rows = [job for job in queue.rows() if job['artifact'] not in held_artifacts and
                  (job['status'] != 'failed' or job.get('approval_sha') == job['id'])]
    for job in queue_rows:
        jobs_by_batch.setdefault(job['package'].get('review_batch_id'), []).append(job)
    backlog = len({job['artifact'] for job in queue_rows if job['status']=='review'})
    records = []
    for row in store.db.execute('SELECT * FROM review_batches ORDER BY observed_at,batch_id').fetchall():
        jobs = jobs_by_batch.get(row['batch_id'], [])
        queued = len({job['artifact'] for job in jobs})
        planned = row['planned_count']
        minutes = row['review_minutes']
        complete = queued >= planned and all(
            job['status'] != 'review' and job.get('approval_sha') == job['id']
            for job in jobs
        )
        completed_at = row['observed_at'] if row['completed'] else now if complete else ''
        if complete:
            note = 'Owner decisions complete'
            if minutes is not None and minutes > 30:
                note += f'; review exceeded 30 minutes ({minutes} recorded)'
        else:
            note = f'{queued}/{planned} videos queued; awaiting exact owner decisions'
        note += f'; outstanding review backlog: {backlog}'
        records.append({'batch_id':row['batch_id'],'planned_count':planned,'completed_at':completed_at,'worker_note':note})
        store.record_review(row['batch_id'],minutes,complete,now,planned_count=planned,backlog=backlog)
    return records


def daily_calendar(store, now, jobs, *, held_artifacts=(), review_days=()):
    """Retain assignments across ticks and keep a stable concept per upcoming day."""
    days = planner.upcoming_days(now)
    zone = planner.CALENDAR_ZONE
    active = set()
    held_posts = set()
    for job in jobs:
        slot = ops.instant(job['package']['scheduled_at']).astimezone(zone)
        if job['status'] in ('review', 'approved') and job['artifact'] in held_artifacts:
            held_posts.add(job['artifact'].partition('-')[0])
        elif job['status'] in ('review', 'approved', 'uncertain', 'scheduled', 'published'):
            active.add(slot.date())
    calendar = {}
    review_days = set(review_days)
    first_eligible_day = min(review_days, default=days[0])
    with store.transaction():
        store.db.execute(
            "DELETE FROM calendar_slots WHERE scheduled_at < ? AND concept_id IN (SELECT id FROM concepts WHERE status='production_ready')",
            (planner.daily_slot(first_eligible_day),)
        )
        assigned = {row['scheduled_at']: row for row in store.db.execute(
            "SELECT s.scheduled_at, s.concept_id, c.status, c.payload_json, i.artifact_id "
            "FROM calendar_slots s JOIN concepts c ON c.id=s.concept_id "
            "LEFT JOIN content_items i ON i.id='concept-' || c.id"
        )}
        available = iter(store.db.execute(
            """SELECT id,payload_json FROM concepts WHERE status='production_ready'
            AND id NOT IN (SELECT concept_id FROM calendar_slots) ORDER BY created_at,id"""
        ).fetchall())
        last_review_slot = planner.daily_slot(max(review_days)) if review_days else None
        later_ideas = iter(
            (slot, row) for slot, row in sorted(assigned.items())
            if last_review_slot and slot > last_review_slot and row['status']=='production_ready'
        )
        for day in sorted(days, key=lambda day: (day not in review_days, day)):
            slot = planner.daily_slot(day)
            if day in active:
                calendar[day] = {'date': day.isoformat(), 'scheduled_at': slot, 'state': 'queued'}
                continue
            previous = assigned.get(slot)
            candidate = None
            previous_post = (previous['artifact_id'] or '').partition('-')[0] if previous else None
            if previous and previous['status'] in ('production_ready', 'selected', 'producing', 'produced') and previous_post not in held_posts:
                concept_id = previous['concept_id']
            else:
                if day >= first_eligible_day:
                    candidate = next(available, None)
                if candidate is None and day in review_days:
                    later = next(later_ideas, None)
                    if later:
                        later_slot, idea = later
                        del assigned[later_slot]
                        store.db.execute('DELETE FROM calendar_slots WHERE scheduled_at=?', (later_slot,))
                        candidate = {'id':idea['concept_id'],'payload_json':idea['payload_json']}
                concept_id = candidate['id'] if candidate else None
                if concept_id:
                    store.db.execute(
                        'INSERT INTO calendar_slots(scheduled_at,concept_id) VALUES(?,?) ON CONFLICT(scheduled_at) DO UPDATE SET concept_id=excluded.concept_id',
                        (slot, concept_id)
                    )
            calendar[day] = {'date': day.isoformat(), 'scheduled_at': slot, 'concept_id': concept_id,
                             'state': 'planned' if concept_id else 'unfilled',
                             'hook_he': json.loads(previous['payload_json']).get('hook_he', '') if previous and concept_id == previous['concept_id'] else json.loads(candidate['payload_json']).get('hook_he', '') if candidate else ''}
    return [calendar[day] for day in days]


def run(cfg,root,google,snapshot,queue,*,now=None,ideator=None,project_runner=None,renderer_client=None,asset_store=None,preparer=None,on_review_ready=None):
    """Run one 15-minute poll. No call is made when ideation cadence and inventory are satisfied."""
    root=Path(root);current=_now(now);store=content_pipeline.Store(root/'content-pipeline.sqlite3')
    try:
        default=cfg.get('initial_review_target',2)
        policy=content_pipeline.review_target(store,default=default,budget_minutes=30,max_items=20)
        daily = cfg.get('daily_calendar_enabled') is True
        target = planner.POSTS_PER_REVIEW if daily else policy['target']
        context = _idea_context(cfg, snapshot, target, store, queue)
        idea_policy = dict(cfg.get('idea_policy', {}))
        local = datetime.fromisoformat(current).astimezone(planner.CALENDAR_ZONE)
        if daily:
            idea_policy['calendar_floor'] = len(planner.upcoming_days(local))
            idea_policy['reserve_count'] = idea_policy['calendar_floor'] + target
        generation = idea_generation.generate_due(store, context, ideator, now=current, policy=idea_policy)
        concept_mirror={'status':'not_configured','appended':0}
        if google and generation.get('accepted') and not daily:
            concepts=store.ready_concepts(200)
            concept_mirror=google.append_generated_ideas(cfg['spreadsheet_id'],concepts,root/'google-intents')
        review_days = planner.next_review_week(local) if daily else []
        batch_date = ops.instant(planner.daily_slot(review_days[0])) if daily else local
        batch_id = planner.review_batch_id(batch_date)
        batch_exists=store.db.execute('SELECT 1 FROM review_batches WHERE batch_id=?',(batch_id,)).fetchone() is not None
        if daily and not batch_exists:
            store.record_review(batch_id,None,False,current,planned_count=target)
            batch_exists = True
        ready=store.ready_concepts(target)
        holds = queue.db.execute("SELECT artifact_id,kind FROM feedback_jobs WHERE status='held'").fetchall() if daily else []
        held_artifacts = {row['artifact_id'] for row in holds}
        policy_holds = {row['artifact_id'] for row in holds if row['kind']=='policy'}
        calendar = daily_calendar(store, local, queue.rows(), held_artifacts=policy_holds, review_days=review_days) if daily else []
        review_dates = {day.isoformat() for day in review_days}
        assignments = [(slot['concept_id'], slot['scheduled_at'])
                       for slot in calendar if slot['date'] in review_dates and slot.get('concept_id')]
        if daily:
            # Leave time for approvals and feedback between long model/render runs.
            assignments = assignments[:2]
        prepared=[];receipts=[]
        if cfg.get('prepare_enabled') is True and (assignments if daily else not batch_exists and ready):
            selected=ready[:target]
            occupied=[job['package']['scheduled_at'] for job in queue.rows()]
            if not daily:
                slots=planner.concept_slots(len(selected),local,occupied)
                assignments=[(concept['id'], slot) for concept, slot in zip(selected, slots)]
            project_context=dict(cfg.get('creative_context') or {})
            if 'verified_features' not in project_context:project_context['verified_features']=[]
            project_context['active_rules']=cfg.get('creative_preferences',project_context.get('active_rules',[]))
            prepare=preparer
            if prepare is None:
                from preparation import prepare_generated_concept as prepare
            for concept_id,slot in assignments:
                try:
                    initial=prepare(concept_id,root,project_context,slot,project_runner=project_runner,
                                    renderer_client=renderer_client,review_batch_id=batch_id)
                except (ValueError, RuntimeError, TimeoutError) as exc:
                    if not daily:
                        raise
                    prepared.append({'verification_status':'held','problems':[f'{concept_id} held during preparation: {type(exc).__name__}']})
                    continue
                if initial.get('verification_status')!='ready_for_human':
                    if daily:
                        store.db.execute('DELETE FROM calendar_slots WHERE scheduled_at=? AND concept_id=?',
                                         (slot, concept_id))
                    prepared.append(initial);continue
                if google is None or not cfg.get('drive_posts_folder_id'):
                    raise ValueError('Verified generated candidates need Google Drive storage before owner review')
                if asset_store is None:
                    import drive_assets
                    store_asset=drive_assets.store
                else:store_asset=asset_store
                receipt=store_asset(google,initial,cfg,root,queue=queue)
                item=prepare(concept_id,root,project_context,slot,project_runner=project_runner,
                             renderer_client=renderer_client,destinations=cfg.get('destinations',[]),
                             preview_urls={initial['artifact_id']:receipt['webViewLink']},
                             drive_receipts={initial['artifact_id']:receipt},
                             verification_refs={initial['artifact_id']:initial['creative_verification']},
                             review_batch_id=batch_id)
                prepared.append(item);receipts.append(receipt)
                if on_review_ready and item.get('jobs'):
                    on_review_ready()
            reviewed=[item for item in prepared if item.get('verification_status')=='ready_for_human']
            if reviewed and not batch_exists:
                store.record_review(batch_id,None,False,current,planned_count=target if daily else len(reviewed),backlog=sum(j['status']=='review' for j in queue.rows()))
        if daily:
            calendar = daily_calendar(store, local, queue.rows(), held_artifacts=policy_holds, review_days=review_days)
        log_sync={'status':'not_configured'}
        if google:
            batches=_batch_records(store,queue,current,held_artifacts=held_artifacts)
            log_sync=google.sync_review_log(cfg['spreadsheet_id'],batches,root/'google-intents',cfg.get('review_log_sheet_id'))
            for row in log_sync['rows'][1:]:
                if row[2] not in ('',None):
                    db=store.db.execute('SELECT completed FROM review_batches WHERE batch_id=?',(row[0],)).fetchone()
                    if db:
                        store.record_review(row[0],int(row[2]),bool(db['completed']),current,planned_count=int(row[1]),backlog=sum(j['status']=='review' for j in queue.rows()))
        problems=[problem for item in prepared for problem in item.get('problems',[])]
        latest=store.db.execute("SELECT status,updated_at,result_json FROM stage_runs WHERE stage='ideation' ORDER BY updated_at DESC,id DESC LIMIT 1").fetchone()
        backlog=len({job['artifact'] for job in queue.rows()
                     if job['status']=='review' and job['artifact'] not in held_artifacts})
        next_trigger=(datetime.fromisoformat(current)+timedelta(seconds=int(cfg.get('poll_interval_seconds',900)))).isoformat()
        return {'enabled':True,'target':target,'target_reason':policy['reason'],'generation':generation,
                'idea_mirror':concept_mirror,'review_batch_id':batch_id,'review_log':log_sync,
                'prepared':prepared,'drive_receipts':receipts,'calendar':calendar,'inventory':store.snapshot(current),'problems':problems,
                'last_ideation_run':dict(latest) if latest else None,'review_backlog':backlog,'next_poll_at':next_trigger}
    finally:store.close()
