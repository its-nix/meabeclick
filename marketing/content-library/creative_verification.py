"""Fail-closed encoded-media review. Human approval remains a separate gate."""
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from fractions import Fraction
import uuid
import engine

HERE = Path(__file__).parent
ROLES = ('correctness_motion', 'editorial')
CHECKS = ('math', 'teaching', 'motion', 'timing', 'readability', 'hebrew', 'brand', 'hook_payoff', 'audio')
CODEX_VERSION = 'codex-cli 0.149.0'
CORE_ISOLATION_FEATURES = frozenset(('apps','browser_use','code_mode','computer_use','hooks','plugins','shell_tool','unified_exec'))
DISABLED_FEATURES = ('apps', 'plugins', 'hooks', 'shell_tool', 'unified_exec', 'code_mode', 'code_mode_host', 'computer_use', 'browser_use', 'in_app_browser', 'in_app_local_automation', 'multi_agent', 'multi_agent_v2', 'memories', 'skill_search', 'tool_search', 'view_image', 'image_generation', 'goals', 'sleep_tool', 'in_app_chat', 'in_app_voice', 'in_app_dictation', 'in_app_updates', 'browser_annotation_api', 'browser_use_external', 'browser_use_full_cdp_access', 'incremental_tools', 'incremental_tools_legacy_gcp')

def _digest(value):
    return hashlib.sha256(engine.canonical(value)).hexdigest()

def _write(path, value):
    path=Path(path);path.parent.mkdir(parents=True, exist_ok=True)
    temporary=path.with_name(path.name+'.tmp-'+uuid.uuid4().hex)
    temporary.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2)+'\n')
    temporary.replace(path)

def _ref(path):
    return {'path':str(Path(path).absolute()), 'sha256':engine.sha(path)}

def _read_ref(ref):
    if not isinstance(ref,dict) or set(ref)!={'path','sha256'}:
        raise ValueError('Missing trusted verification report reference')
    path=engine.physical_path(ref['path'])
    if not path.is_file() or engine.sha(path)!=ref['sha256']:
        raise ValueError('Verification/evidence file missing or checksum mismatch')
    return json.loads(path.read_text())

def policy_hash():
    return _digest({name:engine.sha(HERE/name) for name in ('creative_verification.py','audio_qa.py','verification-policy.md','verification-prompt.md','verification-schema.json','verification-repair-schema.json','verification-repair-prompt.md')})

def context_hash(bundle, caption, cta):
    manifest=engine.verify(bundle)
    return _digest({'job':manifest['payload']['job'], 'caption':caption, 'cta':cta})

def _identity(bundle, caption, cta):
    manifest=engine.verify(bundle)
    return {'artifact_id':manifest['artifact_id'], 'media_sha256':manifest['payload']['media']['sha256'], 'context_sha256':context_hash(bundle,caption,cta), 'policy_sha256':policy_hash()}

def _run(args, **kw):
    try:
        return subprocess.run(args, check=True, capture_output=True, text=True, timeout=kw.pop('timeout',180), **kw)
    except (subprocess.SubprocessError,OSError) as exc:
        # External output may contain credential/server details; do not persist it.
        raise RuntimeError('Verification subprocess failed: '+Path(args[0]).name) from exc

def _probe(media):
    data=json.loads(_run(['ffprobe','-v','error','-count_frames','-show_streams','-of','json',str(media)]).stdout)
    streams=[s for s in data['streams'] if s['codec_type']=='video']
    if len(streams)!=1:raise ValueError('Exactly one video stream is required')
    s=streams[0];fps=Fraction(s['avg_frame_rate']);nominal=Fraction(s['r_frame_rate'])
    if fps!=nominal or not 24<=fps<=60:raise ValueError('Unsupported variable/unknown frame rate')
    count=int(s['nb_read_frames']);duration=float(s.get('duration',count/float(fps)))
    if count<2 or count>1800 or not 0<duration<=60:raise ValueError('Evidence supports 2–1800 frames and at most 60 seconds')
    return {'frame_count':count,'fps':str(fps),'duration':duration,'width':int(s['width']),'height':int(s['height']),'has_audio':any(s['codec_type']=='audio' for s in data['streams'])}


# Tiny bitmap labels keep the evidence pipeline stdlib-only, including FFmpeg builds without drawtext.
_GLYPHS=dict(zip('0123456789FTRWO-. ',(
    '111101101101111','010110010010111','111001111100111','111001111001111','101101111001001',
    '111100111001111','111100111101111','111001001001001','111101111101111','111101111001111',
    '111100110100100','111010010010010','110101110101101','101101111111101','111101101101111',
    '000000111000000','000000000000010','000000000000000')))

def _sheet_label(path, text, width):
    height=32;pixels=bytearray(width*height*3)
    for pos,char in enumerate(text):
        glyph=_GLYPHS[char]
        for row in range(5):
            for col in range(3):
                if glyph[row*3+col]!='1':continue
                for dy in range(4):
                    for dx in range(4):
                        x=8+pos*16+col*4+dx;y=6+row*4+dy
                        if x<width:
                            start=(y*width+x)*3;pixels[start:start+3]=b'\xff\xff\xff'
    Path(path).write_bytes(f'P6\n{width} {height}\n255\n'.encode()+pixels)


def _make_evidence(bundle, directory, identity):
    directory=Path(directory);directory.mkdir(parents=True,exist_ok=False)
    meta=_probe(Path(bundle)/'asset.mp4');count=meta['frame_count'];fps=float(Fraction(meta['fps']))
    dense=sorted({0,count-1}|{min(count-1,int(i*fps/5)) for i in range(math.ceil(count/fps*5))})
    if math.ceil(count/24)+math.ceil(len(dense)/2)+2>100:raise ValueError('Evidence exceeds safe reviewer attachment budget')
    frames_dir=directory/'frames';frames_dir.mkdir()
    _run(['ffmpeg','-v','error','-threads','1','-i',str(Path(bundle)/'asset.mp4'),'-fps_mode','passthrough','-start_number','0',str(frames_dir/'%06d.png')])
    frames=[{'index':i,'time_seconds':i/fps,**_ref(frames_dir/f'{i:06d}.png')} for i in range(count)]
    if len(list(frames_dir.glob('*.png')))!=count:raise ValueError('Decoded frame count mismatch')
    dense=sorted({0,count-1}|{min(count-1,int(i*fps/5)) for i in range(math.ceil(count/fps*5))})
    sheets=[]
    # Full original sequence is deliberately conservative: no inferred motion gaps.
    for group,indices,width,columns,rows in [('motion',list(range(count)),360,4,6),('dense',dense,meta['width'],2,1)]:
        for offset in range(0,len(indices),columns*rows):
            chunk=indices[offset:offset+columns*rows];seq=directory/'sequence';seq.mkdir()
            for n,index in enumerate(chunk):os.link(frames_dir/f'{index:06d}.png',seq/f'{n:06d}.png')
            target=directory/f'{group}-{offset:04d}.jpg'
            label=f'F{chunk[0]}-{chunk[-1]} T{chunk[0]/fps:.3f}-{chunk[-1]/fps:.3f} ROW'
            header=directory/'label.ppm';_sheet_label(header,label,width*columns)
            _run(['ffmpeg','-v','error','-threads','1','-framerate','1','-start_number','0','-i',str(seq/'%06d.png'),'-i',str(header),'-filter_complex',f'[0:v]scale={width}:-2,tile={columns}x{rows}:nb_frames={len(chunk)},pad=iw:ih+32:0:32:black[t];[t][1:v]overlay=0:0','-frames:v','1','-q:v','2',str(target)])
            shutil.rmtree(seq)
            sheets.append({'id':target.stem,'label':label,'original_frame_indices':chunk,'layout':{'columns':columns,'rows':rows,'frame_width':width,'frame_height':meta['height'] if group=='dense' else 2*round(meta['height']*width/meta['width']/2),'native_resolution':group=='dense'},**_ref(target)})
    audio_evidence=None
    if meta['has_audio']:
        import audio_qa
        audio_evidence=audio_qa.inspect(bundle)
    evidence={'audio_evidence':audio_evidence,'version':1,**identity,**meta,'dense_frame_indices':dense,'motion_windows':[[0,count-1]],'frames':frames,'sheets':sheets,'playback':'original-frame sequences; not continuous playback','first_frame':0,'final_frame':count-1}
    _write(directory/'evidence.json',evidence)
    return _ref(directory/'evidence.json')

def _validate_evidence(ref, identity):
    e=_read_ref(ref)
    if any(e.get(k)!=v for k,v in identity.items()):raise ValueError('Evidence identity/policy mismatch')
    count=e.get('frame_count');fps=float(Fraction(e.get('fps','0')))
    if type(count) is not int or not 2<=count<=1800 or not 24<=fps<=60:raise ValueError('Invalid frame coverage')
    expected=list(range(count))
    if [f.get('index') for f in e.get('frames',[])]!=expected or e.get('motion_windows')!=[[0,count-1]]:raise ValueError('Incomplete original motion coverage')
    dense=sorted({0,count-1}|{min(count-1,int(i*fps/5)) for i in range(math.ceil(count/fps*5))})
    if e.get('dense_frame_indices')!=dense or e.get('first_frame')!=0 or e.get('final_frame')!=count-1:raise ValueError('Incomplete dense/endpoint coverage')
    all_indices={group:[] for group in ('motion','dense')};ids=set()
    for sheet in e.get('sheets',[]):
        sid=sheet.get('id','');group=sid.split('-')[0]
        if group not in all_indices or sid in ids:raise ValueError('Invalid evidence sheet')
        if group=='dense' and (not 1<=len(sheet['original_frame_indices'])<=2 or sheet.get('layout')!={'columns':2,'rows':1,'frame_width':e['width'],'frame_height':e['height'],'native_resolution':True}):raise ValueError('Dense evidence must preserve native-resolution frame pairs')
        ids.add(sid);all_indices[group].extend(sheet['original_frame_indices'])
        p=engine.physical_path(sheet['path'])
        if not p.is_file() or engine.sha(p)!=sheet['sha256']:raise ValueError('Evidence sheet missing or tampered')
    if all_indices!={'motion':expected,'dense':dense}:raise ValueError('Missing evidence sequence')
    if len(e['sheets'])+2>100:raise ValueError('Evidence exceeds safe reviewer attachment budget')
    for f in e['frames']:
        p=engine.physical_path(f['path'])
        if not p.is_file() or engine.sha(p)!=f['sha256'] or abs(f['time_seconds']-f['index']/fps)>0.00001:raise ValueError('Original evidence frame missing or tampered')
    return e

def _procedural_audio(qa, identity):
    return (isinstance(qa,dict) and qa.get('artifact_id')==identity['artifact_id']
            and qa.get('media_sha256')==identity['media_sha256']
            and qa.get('mode')=='music' and qa.get('procedural_verified') is True
            and qa.get('technical_pass') is True and qa.get('full_decode') is True
            and qa.get('listening_required') is True and qa.get('listening_status')=='pending'
            and type(qa.get('integrated_lufs')) in (int,float) and -35<=qa['integrated_lufs']<=-18
            and type(qa.get('true_peak_dbtp')) in (int,float) and qa['true_peak_dbtp']<=-1)


def _validate_role(report, role, evidence, evidence_ref, identity):
    if not isinstance(report,dict) or report.get('role')!=role or any(report.get(k)!=v for k,v in identity.items()):raise ValueError('Reviewer identity/policy/context mismatch')
    if report.get('evidence_sha256')!=evidence_ref['sha256']:raise ValueError('Reviewer used different evidence')
    if not isinstance(report.get('session_id'),str) or not report['session_id'].strip():raise ValueError('Reviewer session identity missing')
    if report.get('verdict') not in ('pass','revise','needs_human'):raise ValueError('Reviewer verdict missing')
    checks=report.get('checks',{})
    if set(checks)!=set(CHECKS) or any(v not in ('pass','fail','unverified') for v in checks.values()):raise ValueError('Incomplete review checks')
    coverage=report.get('coverage',{})
    if coverage.get('original_frame_indices')!=list(range(evidence['frame_count'])) or coverage.get('sheet_ids')!=[s['id'] for s in evidence['sheets']] or coverage.get('motion_windows')!=evidence['motion_windows'] or coverage.get('continuous_playback') is not False:raise ValueError('Incomplete reviewer motion/evidence coverage')
    findings=report.get('findings');patches=report.get('patches')
    if not isinstance(findings,list) or not isinstance(patches,list) or len(findings)>12 or len(patches)>12:raise ValueError('Invalid findings/patches')
    for f in findings:
        if f.get('severity') not in ('P0','P1') or type(f.get('time_seconds')) not in (int,float) or not math.isfinite(f['time_seconds']) or not 0<=f['time_seconds']<=evidence['duration'] or not f.get('issue') or not f.get('change'):raise ValueError('Finding needs timestamp and repair description')
    if not isinstance(report.get('summary'),str) or not report['summary'].strip() or 'score' in report:raise ValueError('Missing summary or forbidden subjective score')
    if evidence['has_audio'] and checks['audio']=='pass' and not _procedural_audio(evidence.get('audio_evidence'),identity):raise ValueError('Audio listening is unverified')
    if report['verdict']=='pass' and (findings or patches or any(v!='pass' for v in checks.values())):raise ValueError('Unverified/failed review cannot pass')
    if report['verdict']=='revise' and not findings:raise ValueError('Revision needs findings')
    return report

def _validate_report(report, bundle, caption, cta):
    identity=_identity(bundle,caption,cta)
    if not isinstance(report,dict) or report.get('version')!=1 or any(report.get(k)!=v for k,v in identity.items()) or report.get('owner_approved') is not False:raise ValueError('Verification identity/context/policy mismatch')
    evidence=_validate_evidence(report.get('evidence'),identity)
    # Probe actual bytes as well as verifying referenced evidence; fabricated sparse metadata cannot pass.
    if any(evidence[k]!=v for k,v in _probe(Path(bundle)/'asset.mp4').items()):raise ValueError('Evidence does not describe encoded media')
    if evidence['has_audio']:
        import audio_qa
        if evidence.get('audio_evidence')!=audio_qa.inspect(bundle):raise ValueError('Audio evidence differs from encoded verification')
    roles=report.get('roles',[])
    if len(roles)!=2:raise ValueError('Two independent reviewers are required')
    for role,r in zip(ROLES,roles):_validate_role(r,role,evidence,report['evidence'],identity)
    if roles[0]['session_id']==roles[1]['session_id']:raise ValueError('Reviewer sessions are not independent')
    status='pass' if all(r['verdict']=='pass' for r in roles) else 'needs_human'
    if report.get('status')!=status:raise ValueError('Forged verification status')
    return report

def require(package):
    ref=package.get('creative_verification')
    if not ref:raise ValueError('Creative verification report reference is required')
    report=_read_ref(ref)
    _validate_report(report,package['bundle'],package['caption'],package['cta'])
    if report['status']!='pass':raise ValueError('Creative verification did not pass')
    return report



_CODE_HOST_DISABLED_WARNING = ('Code Mode is unavailable because code-mode host is disabled. '
    'Code mode will fail closed; enable `features.code_mode_host` and install `codex-code-mode-host`.')

def _cli_event_summary(events):
    counts={}
    for event in events:
        kind=event.get('type');item_kind=event.get('item',{}).get('type')
        # Persist only protocol type names, never messages, tool arguments or model output.
        def safe(value):
            return value if isinstance(value,str) and len(value)<=64 and all(c.islower() or c in '._-' for c in value) else None
        key=(safe(kind),safe(item_kind));counts[key]=counts.get(key,0)+1
    return {'cli_version':CODEX_VERSION,'event_counts':[{'event':k[0],'item_type':k[1],'count':n} for k,n in counts.items()]}

def _check_cli_events(events, disabled_features):
    summary=_cli_event_summary(events);summary['warnings']=[];turn_started=False
    for event in events:
        kind=event.get('type')
        if kind=='turn.started':turn_started=True
        if kind in ('error','turn.failed'):raise RuntimeError('Reviewer reported a runtime error')
        if kind not in ('item.started','item.updated','item.completed'):continue
        item=event.get('item',{});item_kind=item.get('type')
        if item_kind=='error':
            if not turn_started and {'code_mode','code_mode_host'}<=set(disabled_features) and item.get('message')==_CODE_HOST_DISABLED_WARNING:
                summary['warnings'].append('code_mode_host_disabled');continue
            raise RuntimeError('Reviewer reported a runtime error')
        if item_kind not in ('agent_message','reasoning'):raise RuntimeError('Reviewer attempted a forbidden tool')
    return summary


def _codex_review(*, role, evidence, context, policy, invocation_id, repair_request=False, feedback_request=False):
    home=os.environ.get('CODEX_REVIEW_HOME')
    if not home or not Path(home).is_dir():raise RuntimeError('Reviewer authorization unavailable; provision isolated CODEX_REVIEW_HOME')
    # Read no credentials. The CLI alone uses operator-provisioned authorization.
    cli=shutil.which('codex')
    if not cli:raise RuntimeError('Codex reviewer unavailable')
    env={k:v for k,v in os.environ.items() if k in ('PATH','TMPDIR','LANG','LC_ALL','SSL_CERT_FILE','SSL_CERT_DIR')}
    env.update({'CODEX_HOME':str(Path(home).absolute()),'HOME':str(evidence['_directory']),'NO_COLOR':'1'})
    if _run([cli,'--version'],env=env).stdout.strip()!=CODEX_VERSION:raise RuntimeError('Codex reviewer version is not the verified pinned version')
    help_text=_run([cli,'exec','--help'],env=env).stdout
    for flag in ('--ignore-user-config','--ignore-rules','--ephemeral','--sandbox','--output-schema'):
        if flag not in help_text:raise RuntimeError('Codex lacks required isolation flags')
    features=_run([cli,'features','list'],env=env).stdout
    available={line.split()[0] for line in features.splitlines() if line.split()}
    if not CORE_ISOLATION_FEATURES<=available:raise RuntimeError('Codex lacks required core tool isolation features')
    instructions=(HERE/('feedback-repair-prompt.md' if feedback_request else 'verification-repair-prompt.md' if repair_request else 'verification-prompt.md')).read_text()
    visible={k:v for k,v in evidence.items() if k!='_directory'}
    prompt=instructions+'\n'+json.dumps({'role':role,'policy_sha256':policy,'invocation_id':invocation_id,'context':context,'evidence':visible},ensure_ascii=False)
    with tempfile.TemporaryDirectory(prefix='encoded-review-') as scratch:
        output=Path(scratch)/'result.json'
        args=[cli,'exec','--ignore-user-config','--ignore-rules','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--cd',scratch,'--output-schema',str(HERE/('feedback-repair-schema.json' if feedback_request else 'verification-repair-schema.json' if repair_request else 'verification-schema.json')),'--output-last-message',str(output),'--json','--color','never','-c','web_search="disabled"','-c','shell_environment_policy.inherit="none"','-c','model_reasoning_effort="high"','-c','project_doc_max_bytes=0','-c','developer_instructions="Use only the supplied isolated task data. Use no tools."']
        for feature in DISABLED_FEATURES:
            if feature in available:args+=['--disable',feature]
        if not repair_request and not feedback_request:
            if len(evidence['sheets'])+2>100:raise ValueError('Evidence exceeds safe reviewer attachment budget')
            for sheet in evidence['sheets']:args+=['--image',sheet['path']]
            for i in (0,evidence['frame_count']-1):args+=['--image',evidence['frames'][i]['path']]
        args+=['-']
        result=_run(args,input=prompt,env=env,timeout=600)
        events=[json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
        diagnostic=Path(evidence['_directory'])/('reviewer-events-'+_digest(invocation_id)+'.json')
        _write(diagnostic,_cli_event_summary(events))
        _write(diagnostic,_check_cli_events(events,set(DISABLED_FEATURES)&available))
        sessions=[e.get('thread_id') for e in events if e.get('type')=='thread.started']
        if len(sessions)!=1 or not sessions[0]:raise RuntimeError('Fresh reviewer session unavailable')
        response=json.loads(output.read_text());response['session_id']=sessions[0]
        return response


def _public_rules(rules):
    """Expose preferences, never ledger origin comments or correction rationale."""
    if not isinstance(rules,list):return []
    return [{k:r[k] for k in ('id','rule_id','scope','format_id','rule') if k in r}
            for r in rules if isinstance(r,dict)]


def inspect_candidate(bundle, caption, cta, state_dir, reviewer=None):
    identity=_identity(bundle,caption,cta);key=_digest(identity);directory=Path(state_dir).absolute()/('candidate-'+key)
    report_path=directory/'report.json';failure=directory/'failure.json'
    if report_path.exists():
        report=_validate_report(json.loads(report_path.read_text()),bundle,caption,cta)
        return {'report':report,'verification':_ref(report_path)}
    if failure.exists():raise RuntimeError('Cached verification failure; operator intervention required')
    directory.mkdir(parents=True,exist_ok=True)
    # A started marker is committed before any model call. Crashes cannot silently buy new attempts.
    started=directory/'started.json'
    if started.exists():raise RuntimeError('Interrupted verification requires operator intervention')
    with started.open('x') as marker:json.dump(identity,marker)
    try:
        evidence_ref=_make_evidence(bundle,directory/'evidence',identity)
        evidence=_validate_evidence(evidence_ref,identity);evidence['_directory']=str(directory)
        manifest=engine.verify(bundle)
        # Never send implementation source, revision rationale, private references or customer data.
        job=manifest['payload']['job'];post=job.get('post',{})
        context={'caption':caption,'cta':cta,'brief':{k:post[k] for k in ('id','title','goal','audience','format') if k in post},'constraints':job.get('constraints',{}),'rule_snapshot':_public_rules(job.get('rule_snapshot',[]))}
        roles=[]
        for role in ROLES:
            r=(reviewer or _codex_review)(role=role,evidence={**evidence,'evidence_sha256':evidence_ref['sha256']},context=context,policy=identity['policy_sha256'],invocation_id=uuid.uuid4().hex)
            _validate_role(r,role,evidence,evidence_ref,identity);roles.append(r)
        report={'version':1,**identity,'created_at':datetime.now(timezone.utc).isoformat(),'evidence':evidence_ref,'roles':roles,'status':'pass' if all(r['verdict']=='pass' for r in roles) else 'needs_human','owner_approved':False}
        _validate_report(report,bundle,caption,cta);_write(report_path,report)
        return {'report':report,'verification':_ref(report_path)}
    except Exception as exc:
        _write(failure,{'error_type':type(exc).__name__,'status':'needs_human',**identity})
        raise



def _codex_repair(*, source, findings, reports, bundle, context, policy):
    # Producer alone sees the isolated HTML; none of it reaches either fresh critic.
    with tempfile.TemporaryDirectory(prefix='encoded-repair-') as scratch:
        evidence={'_directory':scratch,'artifact_id':engine.verify(bundle)['artifact_id']}
        response=_codex_review(role='repair_producer',evidence=evidence,context={**context,'source':source,'findings':findings},policy=policy,invocation_id=uuid.uuid4().hex,repair_request=True)
        return response['patches']


def process_candidate(bundle, caption, cta, state_dir, *, reviewer=None, render=None, repairer=None, validate_bundle=None, max_revisions=2):
    if type(max_revisions) is not int or not 0<=max_revisions<=2:raise ValueError('At most two revisions are allowed')
    root=Path(bundle).absolute();identity=_identity(root,caption,cta)
    directory=Path(state_dir).absolute()/('run-'+_digest(identity));directory.mkdir(parents=True,exist_ok=True)
    state_path=directory/'state.json'
    if state_path.exists():
        state=json.loads(state_path.read_text())
        if state.get('identity')!=identity or state.get('max_revisions')!=max_revisions:raise ValueError('Cached run identity/budget mismatch')
        if state.get('status') not in ('running','ready_for_human','needs_human') or state.get('owner_approved') is not False or type(state.get('revisions')) is not int or not 0<=state['revisions']<=max_revisions or not isinstance(state.get('attempts'),list) or len(state['attempts'])>max_revisions+1:
            raise ValueError('Invalid persisted verification budget/state')
        # Validate every cached attempt, even failures and earlier children.
        previous=None
        for attempt in state['attempts']:
            report=_read_ref(attempt['verification']);_validate_report(report,attempt['bundle'],caption,cta)
            m=engine.verify(attempt['bundle'])
            if previous is None and m['artifact_id']!=identity['artifact_id'] or previous is not None and m['payload']['parent_artifact']!=previous:raise ValueError('Cached revision ancestry mismatch')
            previous=m['artifact_id']
        if state.get('status')=='ready_for_human':require({'bundle':state['bundle'],'caption':caption,'cta':cta,'creative_verification':state['verification']})
        # Persisted terminal failures/interrupted rounds never restart automatically.
        if state['status']=='running':
            state['status']='needs_human';state['error']='Interrupted verification/correction requires operator intervention';_write(state_path,state)
        return state
    state={'status':'running','bundle':str(root),'verification':None,'attempts':[],'revisions':0,'max_revisions':max_revisions,'identity':identity,'owner_approved':False}
    with state_path.open('x') as initial:json.dump(state,initial,ensure_ascii=False)
    try:
        for turn in range(max_revisions+1):
            reviewed=inspect_candidate(state['bundle'],caption,cta,directory,reviewer)
            state['verification']=reviewed['verification'];state['attempts'].append({'bundle':state['bundle'],'verification':reviewed['verification']})
            if reviewed['report']['status']=='pass':state['status']='ready_for_human';break
            if turn==max_revisions or render is None:state['status']='needs_human';break
            reports=reviewed['report']['roles']
            if any(r['verdict']=='needs_human' for r in reports):state['status']='needs_human';break
            # Count the correction before invoking patching/render, including failed attempts.
            state['revisions']=turn+1;_write(state_path,state)
            current=Path(state['bundle']);project=directory/f'correction-{turn+1}'/'source'
            source=[];source_bytes=0
            for record in engine.source_files(current/'source'):
                if not record['path'].endswith('.html') or Path(record['path']).name.startswith('._'):continue
                html=(current/'source'/record['path']).read_text();source_bytes+=len(html.encode())
                if source_bytes>120000:raise ValueError('Repair source exceeds 120KiB bound')
                source.append({'path':record['path'],'html':html})
            findings=[{'role':r['role'],**f} for r in reports for f in r['findings']]
            proposed=(repairer or _codex_repair)(source=source,findings=findings,reports=reports,bundle=str(current),context={'caption':caption,'cta':cta,'constraints':engine.verify(current)['payload']['job'].get('constraints',{}),'rule_snapshot':engine.verify(current)['payload']['job'].get('rule_snapshot',[])},policy=identity['policy_sha256'])
            patches=proposed.get('patches') if isinstance(proposed,dict) else proposed
            if not isinstance(patches,list) or not 1<=len(patches)<=12:raise ValueError('Repair producer must return 1–12 bounded patches')
            engine.apply_patches(current/'source',project,patches)
            output=directory/f'correction-{turn+1}'/'render.mp4'
            media=render(project,output)
            manifest=engine.verify(current)
            child=engine.freeze(manifest['payload']['job'],project,media or output,directory/'artifacts',parent=manifest['artifact_id'])
            state['bundle']=str(child);_write(state_path,state)
            if validate_bundle is not None:validate_bundle(child)
        if state['status']=='running':state['status']='needs_human'
    except Exception as exc:
        state['status']='needs_human';state['error']=type(exc).__name__+': verification/correction failed; inspect private worker logs'
    _write(state_path,state)
    return state
