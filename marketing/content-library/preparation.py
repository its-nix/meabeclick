"""Bounded local preparation. No approval or remote publishing authority is implied."""
import json
import hashlib
from datetime import datetime, timezone
from pathlib import Path
import subprocess
import shutil
import tempfile
from urllib.parse import urlparse
import audio_qa
import engine
import factory
import creative_verification
import creative_projects
import content_pipeline
import render_sandbox
from ops import instant

HERE = Path(__file__).resolve().parent


def _policy_project(project, job, rules, root):
    """Prepare a reproducible policy variant without editing authored sources."""
    if not rules:
        return project, job, ''
    import feedback_repair
    key = hashlib.sha256(engine.canonical([engine.source_files(project), rules])).hexdigest()[:16]
    parent = root/'generated-policy' / job['generated']['concept_id']
    parent.mkdir(parents=True,exist_ok=True)
    variant = parent/key
    actions = feedback_repair._preference_actions(rules)
    # The author and encoded reviewers handle layout for newly designed scenes.
    actions['center'] = False
    if not variant.exists():
        with tempfile.TemporaryDirectory(prefix='.policy-', dir=parent) as raw:
            scratch = Path(raw)/'project'
            shutil.copytree(project, scratch)
            feedback_repair.apply_preferences(scratch, job, rules, actions=actions)
            scratch.rename(variant)
    return variant, feedback_repair.apply_preferences(variant, job, rules, actions=actions), '-'+key


def _attach_policy_audio(project, media, job, directory):
    if job['constraints'].get('audio') != 'music':
        return media
    import feedback_repair
    output = directory/'asset-with-score.mp4'
    if not output.exists():
        with tempfile.TemporaryDirectory(prefix='.score-', dir=directory) as raw:
            temp = Path(raw)/'asset.mp4'
            shutil.copyfile(media, temp)
            feedback_repair.render_music(project,temp,job)
            temp.replace(output)
    return output


def prepare_generated_concept(concept_id, state_dir, project_context, scheduled_at, *, project_runner=None, renderer_client=None, destinations=None, preview_urls=None, drive_receipts=None, verification_refs=None, review_batch_id=None):
    """Render one ledger concept, freeze its lineage, then pass existing review gates."""
    root=engine.physical_path(Path(state_dir).expanduser());root.mkdir(parents=True,exist_ok=True)
    store=content_pipeline.Store(root/'content-pipeline.sqlite3')
    try:
        row=store.db.execute('SELECT status,payload_json FROM concepts WHERE id=?',(concept_id,)).fetchone()
        if not row:raise ValueError('Unknown generated concept')
        if row['status']=='production_ready':store.transition_concept(concept_id,'production_ready','selected','assigned to an open review slot')
        elif row['status'] not in ('selected','producing','produced'):raise ValueError('Concept is not production-ready')
        row=store.db.execute('SELECT status,payload_json FROM concepts WHERE id=?',(concept_id,)).fetchone()
        concept=json.loads(row['payload_json']);concept={'id':concept_id,**concept}
        if row['status']=='selected':store.transition_concept(concept_id,'selected','producing','per-post project and isolated render started')
        project_result=creative_projects.create_project(concept,project_context,project_runner,root/'projects')
        project=Path(project_result['project'])
        project_manifest=project_result['manifest']
        numeric=int(hashlib.sha256(concept_id.encode()).hexdigest()[:12],16)
        job={'post':{'id':'P'+str(numeric),'title':concept['hook_he'],'caption':project_manifest['caption'],'preview':'','status':'requires-approval'},
             'constraints':{'audio':'silent'},'generated':{'concept_id':concept_id,'audience':concept['audience'],'format':concept['format'],'hook_he':concept['hook_he'],'cta_category':project_manifest['cta_category']}}
        rules = creative_projects.scoped_rules(project_context, concept['format'])
        project, job, policy_suffix = _policy_project(project, job, rules, root)
        job_id='render-'+concept_id+policy_suffix
        client=renderer_client or render_sandbox.RenderClient(root/'render-spool')
        client.stage(project,job_id)
        rendered=client.wait(job_id,timeout=1800)
        if rendered.get('status')!='ready':raise ValueError('Isolated render held: '+str(rendered.get('reason','unknown')))
        identity='concept-'+concept_id
        directory=root/'preparation'/identity;directory.mkdir(parents=True,exist_ok=True)
        media_directory=directory/('media'+policy_suffix);media_directory.mkdir(exist_ok=True)
        media=_attach_policy_audio(project,rendered['media_path'],job,media_directory)
        lineage={'concept_id':concept_id,'audience':concept['audience'],'format':concept['format'],
                 'input_sha256':rendered['input_sha256'],'source_manifest':rendered['source_manifest'],
                 'asset_manifest':rendered.get('asset_manifest',[]),'project_manifest_sha256':engine.sha(project/'project-manifest.json')}
        bundle=engine.freeze(job,project,media,root/'artifacts',lineage=lineage)
        manifest=engine.verify(bundle)
        def render_correction(p, output):
            from feedback_repair import render_music
            media = render_sandbox.render_into(p, output, spool=root/'render-spool')
            return render_music(p, media)
        result=_finish(root,directory,bundle,identity,job['post']['caption'],project_manifest['cta_category'],project_manifest['cta_category'],scheduled_at,destinations or [],preview_urls or {},drive_receipts or {},verification_refs or {},review_batch_id,generated=True,isolated_repair=render_correction)
        status='verified' if result.get('verification_status')=='ready_for_human' else 'held'
        selected_bundle = Path(result['bundle'])
        selected_manifest = engine.verify(selected_bundle)
        store.save_content_item(identity,concept_id,selected_manifest['artifact_id'],status,{'bundle':str(selected_bundle),'review_file':result.get('review_file'),'media_sha256':selected_manifest['payload']['media']['sha256'],'scheduled_at':scheduled_at,'review_batch_id':review_batch_id,'audience':concept['audience'],'format':concept['format'],'hook_he':concept['hook_he']})
        current=store.db.execute('SELECT status FROM concepts WHERE id=?',(concept_id,)).fetchone()['status']
        if current=='producing':store.transition_concept(concept_id,'producing','produced','artifact frozen and verification outcome recorded')
        return result
    except Exception as exc:
        row=store.db.execute('SELECT status FROM concepts WHERE id=?',(concept_id,)).fetchone()
        if row and row['status'] in ('selected','producing'):
            detail = str(exc) if isinstance(exc, creative_projects.ProjectValidationError) else type(exc).__name__
            store.transition_concept(concept_id,row['status'],'held','generated preparation failed: '+detail)
        raise
    finally:store.close()


def _write(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n')
    temporary.replace(path)


def render(project, media):
    """Use the pinned local CLI, never fetch a new renderer in an unattended tick."""
    executable = HERE.parents[1] / 'node_modules/.bin/hyperframes'
    if not executable.is_file(): raise ValueError('Local HyperFrames renderer missing; install repository dependencies')
    if media.exists(): raise ValueError('Unfinished render exists; inspect and move it before retrying')
    result = subprocess.run([str(executable), 'render', '--quality', 'delivery', '-o', str(media)], cwd=project, capture_output=True, text=True, timeout=1800)
    (media.parent/'render.log').write_text(result.stdout + result.stderr)
    if result.returncode or not media.is_file(): raise RuntimeError('HyperFrames render failed; inspect render.log')


def render_with_preferences(project,media):
    render(project,media)
    if (Path(project)/'preferences-applied.json').exists():
        import feedback_repair
        return feedback_repair.render_music(project,media)
    return media


def _qa(bundle):
    report = audio_qa.inspect(bundle)
    manifest = engine.verify(bundle)
    if report.get('technical_pass') is not True or report.get('artifact_id') != manifest['artifact_id'] or report.get('media_sha256') != manifest['payload']['media']['sha256']:
        raise ValueError('Exact frozen artifact must pass technical QA')
    return manifest, report


def _repair_generated_scene(*, context, **inputs):
    scope = (
        'Use the supplied timestamps to identify each affected scene. For a layout finding, '
        'adjust only that scene using an existing scene-specific literal. Preserve the placement '
        'of unaffected scenes, especially the final payoff. Avoid changing shared scene '
        'padding, alignment, or offsets when a correction applies to only some scenes.'
    )
    return creative_verification._codex_repair(context={**context, 'repair_scope': scope}, **inputs)


def _finish(root, directory, bundle, identity, caption, cta, cta_copy, scheduled, destinations, preview_urls, drive_receipts=None, verification_refs=None, review_batch_id=None, *, generated=False, isolated_repair=None):
    manifest, qa = _qa(bundle)
    if not isinstance(caption, str) or not caption.strip(): raise ValueError('Exact caption required')
    ref=(verification_refs or {}).get(manifest['artifact_id'])
    if ref:
        creative_verification.require({'bundle':str(bundle),'caption':caption,'cta':cta,'creative_verification':ref})
        verified={'status':'ready_for_human','bundle':str(bundle),'verification':ref}
    else:
        render_revision = isolated_repair if generated else render_with_preferences
        revisions = (1 if isolated_repair else 0) if generated else 2
        verification_root = root/'isolated-verification' if generated and isolated_repair else root/'verification'
        verified=creative_verification.process_candidate(
            bundle,caption,cta,verification_root,render=render_revision,validate_bundle=_qa,
            max_revisions=revisions,repairer=_repair_generated_scene if generated else None)
    if verified.get('status')!='ready_for_human':
        result={'plan_id':identity,'bundle':str(bundle),'artifact_id':manifest['artifact_id'],'jobs':[],'problems':['Creative verification held; inspect the bounded verification run before owner review.'],'verification_status':verified.get('status','needs_human'),'verification_run':verified}
        _write(directory/'review.json',result)
        return result
    bundle=Path(verified['bundle']);manifest,qa=_qa(bundle)
    preview = preview_urls.get(manifest['artifact_id'])
    parsed = urlparse(preview) if isinstance(preview,str) else None
    hosted = bool(parsed and parsed.scheme == 'https' and parsed.hostname and not parsed.username and not parsed.password)
    if not hosted: preview = (bundle/'asset.mp4').as_uri()
    problems = ['Hosted exact-artifact HTTPS preview missing; upload media and configure preview_urls before creating destination review jobs.'] if destinations and not hosted else []
    review = {'preview_url': preview, 'preview_kind': 'hosted' if hosted else 'local_file', 'problems': problems, 'plan_id': identity, 'artifact_id': manifest['artifact_id'], 'bundle': str(bundle), 'media_sha256': manifest['payload']['media']['sha256'], 'caption': caption, 'cta': cta, 'cta_copy': cta_copy, 'scheduled_at': scheduled, 'qa': qa, 'creative_verification':verified['verification'],'approval': 'required', 'destinations': destinations}
    _write(directory/'review.json', review)
    jobs = []
    if destinations and hosted:
        # Import here because machine.tick calls preparation.prepare.
        from machine import Queue
        queue = Queue(root/'queue.sqlite3')
        try:
            for dest in destinations:
                if instant(scheduled)<=datetime.now(timezone.utc):
                    existing=queue.db.execute('SELECT id FROM jobs WHERE artifact=? AND network=? AND account=?',(manifest['artifact_id'],dest['network'],dest['account'])).fetchone()
                    if existing:jobs.append(existing[0])
                    continue
                jobs.append(queue.enqueue({'bundle':str(bundle), 'caption':caption, 'cta':cta, 'network':dest['network'], 'account':dest['account'], 'scheduled_at':scheduled, 'qa':qa, 'creative_verification':verified['verification'],'preview_url':preview, 'drive_receipt':(drive_receipts or {}).get(manifest['artifact_id']), **({'review_batch_id':review_batch_id} if review_batch_id else {})}))
        finally:
            queue.db.close()
    return {**review, 'verification_status':'ready_for_human', 'review_file':str(directory/'review.json'), 'jobs':jobs}


def prepare(cfg, state_dir):
    if cfg.get('prepare_enabled') is not True:
        return {'enabled':False, 'prepared':[], 'problems':[]}
    root = engine.physical_path(Path(state_dir).expanduser()); root.mkdir(parents=True,exist_ok=True)
    destinations = cfg.get('destinations', [])
    if not isinstance(destinations,list): raise ValueError('Destinations must be an explicit list')
    seen = set()
    for dest in destinations:
        if not isinstance(dest,dict) or dest.get('network') not in ('instagram','facebook') or not isinstance(dest.get('account'),str) or not dest['account'].strip(): raise ValueError('Verified network and real account required')
        pair=(dest['network'],dest['account'])
        if pair in seen: raise ValueError('Duplicate destination')
        seen.add(pair)
    preview_urls=cfg.get('preview_urls', {})
    if not isinstance(preview_urls,dict): raise ValueError('preview_urls must map exact artifact IDs to hosted URLs')
    requests = cfg.get('requests', [])
    target_count=cfg.get('target_count',2)
    if type(target_count) is not int or not 1<=target_count<=20:raise ValueError('Review target must be 1..20')
    plans = []
    if requests:
        snapshot=json.loads(Path(cfg['snapshot_file']).expanduser().read_text())
        plans=factory.plan_batch(snapshot,requests,limit=target_count,preferences=cfg.get('creative_preferences'))
    seeds = cfg.get('seed_bundles', [])
    if not isinstance(seeds,list) or len(seeds)+len(plans)>target_count: raise ValueError('Preparation exceeds the measured review target')
    slots=cfg.get('slots', [])
    if not isinstance(slots,list) or len(slots)<len(plans): raise ValueError('Explicit scheduled slot required for every generated plan')
    for slot in slots: instant(slot)
    for seed in seeds:
        if not isinstance(seed,dict) or seed.get('cta') not in ('educational','booking','acquisition','waitlist'): raise ValueError('Explicit seed CTA category required')
        instant(seed.get('scheduled_at'))
    prepared=[]
    for index,plan in enumerate(plans):
        key=plan['job']['post']['id']+'@'+slots[index]
        if key in cfg.get('held_work_items',[]):continue
        override=cfg.get('feedback_overrides',{}).get(key)
        if override:
            seed={**override,'scheduled_at':slots[index]};directory=root/'preparation'/('override-'+override['artifact_id']);directory.mkdir(parents=True,exist_ok=True)
            prepared.append(_finish(root,directory,Path(seed['bundle']),'override-'+seed['artifact_id'],seed['caption'],seed['cta'],seed['cta'],seed['scheduled_at'],destinations,preview_urls,cfg.get('drive_receipts',{}),cfg.get('verification_refs',{})))
            continue
        identity=plan['plan_id'];directory=root/'preparation'/identity;directory.mkdir(parents=True,exist_ok=True)
        project=factory.generate_project(plan,root/'projects')
        state=directory/'state.json'
        if state.exists():
            record=json.loads(state.read_text())
            if record.get('plan_id')!=identity: raise ValueError('Preparation cache identity changed')
            bundle=engine.physical_path(record['bundle']);manifest=engine.verify(bundle)
            if manifest['payload']['job'].get('factory',{}).get('plan_id')!=identity or manifest['artifact_id']!=record.get('artifact_id'): raise ValueError('Frozen preparation cache changed')
        else:
            renders=directory/'renders';renders.mkdir(exist_ok=True);media=renders/'candidate.mp4'
            if media.exists(): raise ValueError('Unfinished render exists; inspect and move it before retrying')
            render_with_preferences(project,media)
            bundle=factory.freeze_generated(plan,project,media,root/'artifacts')
            _write(state,{'plan_id':identity,'bundle':str(bundle),'artifact_id':engine.verify(bundle)['artifact_id']})
        job=engine.verify(bundle)['payload']['job'];cta='booking' if plan['template']=='parent-paper' else 'educational'
        cta_copy=plan['copy'].get('cta',job['components'][2][4])
        prepared.append(_finish(root,directory,bundle,identity,job['post']['caption'],cta,cta_copy,slots[index],destinations,preview_urls,cfg.get('drive_receipts',{}),cfg.get('verification_refs',{})))
    for seed in seeds:
        initial=engine.verify(seed['bundle']);key=initial['payload']['job']['post']['id']+'@'+seed['scheduled_at']
        if key in cfg.get('held_work_items',[]):continue
        seed=cfg.get('feedback_overrides',{}).get(key,seed)
        bundle=engine.physical_path(Path(seed['bundle']).expanduser());manifest=engine.verify(bundle)
        caption=seed.get('caption',manifest['payload']['job']['post'].get('caption'))
        identity='seed-'+factory.digest({'artifact_id':manifest['artifact_id'],'caption':caption,'cta':seed['cta'],'scheduled_at':seed['scheduled_at']})[:24]
        directory=root/'preparation'/identity;directory.mkdir(parents=True,exist_ok=True)
        prepared.append(_finish(root,directory,bundle,identity,caption,seed['cta'],seed['cta'],seed['scheduled_at'],destinations,preview_urls,cfg.get('drive_receipts',{}),cfg.get('verification_refs',{})))
    return {'enabled':True,'prepared':prepared,'problems':[problem for item in prepared for problem in item['problems']]}
