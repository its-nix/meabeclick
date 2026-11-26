"""Isolated owner-feedback corrections, bounded producers and original instrumental music."""
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import uuid
from html.parser import HTMLParser
import audio_qa
import creative_verification as cv
import engine


def digest(value):
    return hashlib.sha256(engine.canonical(value)).hexdigest()


def _rules(rules):
    if isinstance(rules,dict): rules=rules.get('rules',[])
    if not isinstance(rules,list) or len(rules)>200:raise ValueError('Invalid rule snapshot')
    if len(engine.canonical(rules))>60000:raise ValueError('Rule snapshot too large')
    return copy.deepcopy(rules)


CENTER_RULE = 'Center the full visible content horizontally and vertically in the portrait canvas.'
MUSIC_RULE = 'Use light original procedural instrumental music; human listening remains required.'
CAPTION_RULE = 'Do not end the caption with the business name מאה בקליק.'


def _preference_actions(rules):
    values={r.get('rule') for r in rules if isinstance(r,dict)}
    return {'center':CENTER_RULE in values,'music':'add' if MUSIC_RULE in values else 'preserve',
            'caption_suffix':'remove' if CAPTION_RULE in values else 'preserve'}


def _actions(value):
    if not isinstance(value,dict) or set(value)!={'center','music','caption_suffix'} or type(value['center']) is not bool or value['music'] not in ('add','remove','preserve') or value['caption_suffix'] not in ('remove','preserve'):
        raise ValueError('Invalid deterministic primitive actions')
    return value


class _Children(HTMLParser):
    def __init__(self,text):
        super().__init__();self.stack=[];self.selectors=set();self.feed(text)
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if self.stack and self.stack[-1][1]=='root':
            if attrs.get('id'):self.selectors.add('#'+attrs['id'])
            self.selectors.update('.'+c for c in attrs.get('class','').split())
        if tag not in ('img','br','meta','link','input','hr','source','wbr'):
            self.stack.append((tag,attrs.get('id')))
    def handle_endtag(self,tag):
        for i in range(len(self.stack)-1,-1,-1):
            if self.stack[i][0]==tag:self.stack=self.stack[:i];break


def center_layout(project, offset=(30,210)):
    """Move outer layout CSS literals only. Never change GSAP transforms/paths."""
    changed=0
    for record in engine.source_files(project):
        if not record['path'].endswith('.html') or Path(record['path']).name.startswith('._'):continue
        path=Path(project)/record['path'];text=path.read_text();selectors=_Children(text).selectors
        def block(m):
            nonlocal changed
            if not any(s.strip() in selectors for s in m[1].split(',')):return m[0]
            def literal(n):
                nonlocal changed
                delta=offset[0 if n[1]=='left' else 1];changed+=1
                return n[1]+':'+f'{float(n[2])+delta:g}'+'px'
            return m[1]+'{'+re.sub(r'\b(left|top):(-?\d+(?:\.\d+)?)px',literal,m[2])+'}'
        after=re.sub(r'([^{}]+)\{([^{}]*)\}',block,text)
        if not engine.safe_html_change(text,after):raise ValueError('Unsafe deterministic layout edit')
        path.write_text(after)
    if not changed:raise ValueError('No supported outer layout coordinates')


def measure_center(media):
    """Estimate encoded foreground union against corner background, at 2 fps."""
    import subprocess
    result=subprocess.run(['ffmpeg','-v','error','-i',str(media),'-vf','fps=2,scale=108:192','-f','rawvideo','-pix_fmt','rgb24','-'],capture_output=True,timeout=180,check=True)
    data=result.stdout;size=108*192*3;xs=[];ys=[]
    if len(data)>size*121 or not data or len(data)%size:raise ValueError('Invalid centering evidence')
    for start in range(0,len(data),size):
        frame=data[start:start+size];bg=frame[:3]
        for y in range(16,173):
            for x in range(7,101):
                at=(y*108+x)*3
                if max(abs(frame[at+c]-bg[c]) for c in range(3))>45:xs.append(x);ys.append(y)
    if not xs:raise ValueError('No measurable foreground')
    dx=540-(min(xs)+max(xs))*5;dy=960-(min(ys)+max(ys))*5
    if abs(dx)>100 or abs(dy)>350:raise ValueError('Unsupported centering displacement')
    return (dx,dy)


def apply_preferences(project,job,rules,*,offset=None,actions=None):
    """Apply supported data rules once to an isolated project; return resolved job."""
    project=engine.physical_path(project);rules=_rules(rules);marker=project/'preferences-applied.json';key=digest(rules)
    if (project.parent/'manifest.json').exists():raise ValueError('Cannot modify frozen source')
    if marker.exists():
        record=json.loads(marker.read_text())
        if record['rules_sha256']!=key:raise ValueError('Preferences already applied with another snapshot')
        return copy.deepcopy(record['job'])
    job=copy.deepcopy(job);job['rule_snapshot']=rules
    inherited_actions=actions is None
    actions=_actions(actions) if actions is not None else _preference_actions(rules)
    if actions['center']:
        try: center_layout(project,offset or (30,210))
        except ValueError as exc:
            if not inherited_actions or str(exc)!='No supported outer layout coordinates':raise
            job.setdefault('constraints',{})['centering_review_required']=True
    if actions['caption_suffix']=='remove':
        caption=job.get('post',{}).get('caption','')
        job.setdefault('post',{})['caption']=re.sub(r'[\s.\-–—]*מאה בקליק[\s.!]*$','',caption).rstrip()
    if actions['music']=='remove':
        job.setdefault('constraints',{})['audio']='silent';job.pop('audio_assets',None);job.pop('audio_plan',None)
        for record in engine.source_files(project):
            if record['path'].endswith('.html') and not Path(record['path']).name.startswith('._'):
                path=project/record['path'];path.write_text(re.sub(r'<audio\b[^>]*>.*?</audio>','',path.read_text(),flags=re.S))
    if actions['music']=='add':
        root=(project/'index.html').read_text();match=re.search(r'data-duration="([\d.]+)"',root)
        if not match:raise ValueError('Explicit duration required for original music')
        duration=float(match[1]);wav=project/'assets/audio/original-light.wav';wav.parent.mkdir(parents=True,exist_ok=True)
        provenance=audio_qa.synthesize(wav,duration);provenance['path']='assets/audio/original-light.wav'
        job.setdefault('constraints',{})['audio']='music';job['audio_assets']=[provenance]
        job['audio_plan']={'duration':duration,'cues':[{'id':'original-light','asset':wav.name,'at':0,'source_start':0,'duration':duration,'gain_db':0}]}
    cv._write(marker,{'rules_sha256':key,'job':job,'offset':offset})
    return job


def render_music(project,media,job=None):
    project=Path(project);media=Path(media)
    if job is None:
        marker=project/'preferences-applied.json'
        if not marker.exists():return media
        job=json.loads(marker.read_text())['job']
    if job.get('constraints',{}).get('audio')!='music':return media
    assets=job.get('audio_assets',[])
    if len(assets)!=1 or assets[0].get('kind')!='original_procedural':raise ValueError('Only original procedural music can be muxed')
    relative=Path(assets[0]['path'])
    if relative.is_absolute() or '..' in relative.parts:raise ValueError('Unsafe original music path')
    wav=project/relative
    if engine.sha(wav)!=assets[0]['sha256']:raise ValueError('Original music source changed')
    with tempfile.TemporaryDirectory(prefix='music-mux-',dir=media.parent) as scratch:
        encoded=Path(scratch)/'music.m4a';output=Path(scratch)/'output.mp4'
        audio_qa.encode_music(wav,encoded)
        audio_qa.command(['ffmpeg','-v','error','-y','-i',media,'-i',encoded,'-map','0:v:0','-map','1:a:0','-c','copy','-movflags','+faststart',output])
        output.replace(media)
    return media


def _interpret(*,source,feedback_text,rules,package):
    with tempfile.TemporaryDirectory(prefix='feedback-producer-') as scratch:
        return cv._codex_review(role='feedback_producer',evidence={'_directory':scratch},
            context={'source':source,'feedback':feedback_text,'rules':rules,'caption':package['caption'],'cta':package['cta'],'format_id':engine.verify(package['bundle'])['payload']['job'].get('factory',{}).get('template') or engine.verify(package['bundle'])['payload']['job'].get('post',{}).get('format','unknown')},
            policy=cv.policy_hash(),invocation_id=uuid.uuid4().hex,feedback_request=True)


def repair(package,feedback_text,rules,state_dir,*,feedback_id,interpreter=None,renderer=None):
    if not isinstance(feedback_text,str) or not feedback_text.strip() or len(feedback_text)>12000:raise ValueError('Invalid feedback')
    if not isinstance(feedback_id,str) or not feedback_id or len(feedback_id)>200:raise ValueError('Invalid feedback identity')
    rules=_rules(rules);manifest=engine.verify(package['bundle'])
    identity={'artifact':manifest['artifact_id'],'caption':package['caption'],'cta':package['cta'],
              'feedback_id':feedback_id,'feedback':feedback_text,'rules':rules,'policy':cv.policy_hash(),
              'implementation':engine.sha(Path(__file__)),
              'producer_policy':{name:engine.sha(Path(__file__).parent/name) for name in ('feedback-repair-prompt.md','feedback-repair-schema.json')}}
    directory=engine.physical_path(state_dir)/('feedback-'+digest(identity));directory.mkdir(parents=True,exist_ok=True);state=directory/'result.json'
    if state.exists():
        result=json.loads(state.read_text())
        if result['status']=='ready_for_human':
            cv.require(result['item']);audio_qa.inspect(result['item']['bundle'])
        return result
    started=directory/'started.json'
    if started.exists():return {'status':'held','item':None,'learnings':[],'summary':'Interrupted feedback correction requires operator review.'}
    with started.open('x') as out:json.dump(identity,out,ensure_ascii=False)
    try:
        source=Path(package['bundle'])/'source';learnings=[]
        sources=[{'path':r['path'],'html':(source/r['path']).read_text()} for r in engine.source_files(source) if r['path'].endswith('.html') and not Path(r['path']).name.startswith('._')]
        if sum(len(r['html'].encode()) for r in sources)>120000:raise ValueError('Feedback source too large')
        proposed=(interpreter or _interpret)(source=sources,feedback_text=feedback_text,rules=rules,package=package)
        if proposed.get('status')!='repair':raise ValueError('Feedback requires unsupported correction')
        actions=_actions(proposed.get('actions'));patches=proposed.get('patches',[]);caption=proposed.get('caption',package['caption'])
        if not isinstance(patches,list) or len(patches)>12 or not isinstance(caption,str) or not caption.strip() or len(caption)>5000:raise ValueError('Invalid bounded correction')
        proposed_learnings=proposed.get('learnings',[])
        if not isinstance(proposed_learnings,list) or len(proposed_learnings)>20:raise ValueError('Too many learnings')
        for learning in proposed_learnings:
            if not isinstance(learning,dict) or set(learning)-{'scope','format_id','rule','supersedes'}:raise ValueError('Invalid learning fields')
            if learning.get('scope')=='global':learning={k:v for k,v in learning.items() if k!='format_id'}
            if learning.get('scope') not in ('global','format') or not isinstance(learning.get('rule'),str) or not 1<=len(learning['rule'])<=2000:raise ValueError('Invalid learning scope')
            if learning['scope']=='format' and not learning.get('format_id'):raise ValueError('Missing learning format')
            supersedes=learning.get('supersedes',[])
            if not isinstance(supersedes,list) or any(not isinstance(r,str) for r in supersedes):raise ValueError('Invalid superseded rule IDs')
            learnings.append(learning)
        engine.verify(package['bundle'])
        project=directory/'source'
        if patches:engine.apply_patches(source,project,patches)
        else:
            project.mkdir()
            for record in engine.source_files(source):
                dest=project/record['path'];dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source/record['path'],dest)
        (project/'preferences-applied.json').unlink(missing_ok=True)
        job=copy.deepcopy(manifest['payload']['job']);job.setdefault('post',{})['caption']=caption
        superseded={i for r in learnings for i in r.get('supersedes',[])}
        combined=[r for r in rules if r.get('rule_id',r.get('id')) not in superseded]+learnings
        offset=None
        if actions['center']:
            try:offset=measure_center(Path(package['bundle'])/'asset.mp4')
            except (ValueError,RuntimeError,OSError):
                if (source/'preferences-applied.json').exists():raise ValueError('Cannot remeasure previously corrected layout')
                offset=(30,210)
        job=apply_preferences(project,job,combined,offset=offset,actions=actions)
        job.setdefault('constraints',{})['feedback_actions']=copy.deepcopy(actions)
        job['feedback_origin']={'feedback_id':feedback_id,'parent_artifact':manifest['artifact_id'],'comment_sha256':digest(feedback_text)}
        caption=job['post']['caption']
        from preparation import render as default_render
        if job.get('generated'):
            import render_sandbox
            def default_render(project_path, output_path):
                spool = Path(os.environ.get('RENDER_SPOOL') or Path(state_dir).parent/'render-spool')
                return render_sandbox.render_into(project_path, output_path, spool=spool)
        def render(p,out):
            returned=(renderer or default_render)(p,out)
            return render_music(p,returned or out)
        media=directory/'render.mp4';render(project,media)
        child=engine.freeze(job,project,media,directory/'artifacts',parent=manifest['artifact_id']);audio_qa.inspect(child)
        verified=cv.process_candidate(child,caption,package['cta'],directory/'verification',render=render,validate_bundle=audio_qa.inspect,max_revisions=1)
        if verified['status']!='ready_for_human':raise ValueError('Fresh encoded critics held correction')
        bundle=Path(verified['bundle']);qa=audio_qa.inspect(bundle)
        final=engine.verify(bundle);engine.verify(package['bundle'])
        item={**package,'bundle':str(bundle),'artifact_id':final['artifact_id'],'media_sha256':final['payload']['media']['sha256'],'caption':caption,'qa':qa,'creative_verification':verified['verification'],'verification_status':'ready_for_human'}
        for key in ('approval','approved','release_id','package_hash','drive_receipt','preview_url'):item.pop(key,None)
        change_summary=proposed.get('summary','')
        if not isinstance(change_summary,str) or not change_summary.strip():
            changes=[]
            if actions['center']:changes.append('Centered visible content')
            if actions['music']=='add':changes.append('Added original light instrumental music')
            if actions['music']=='remove':changes.append('Removed audio')
            if actions['caption_suffix']=='remove':changes.append('Removed business-name caption ending')
            if patches:changes.append('Applied bounded source corrections')
            change_summary='; '.join(changes) or 'Updated caption'
        change_summary=' '.join(change_summary.split())[:600]
        result={'status':'ready_for_human','item':item,'learnings':learnings,'summary':change_summary.rstrip('. ') + '. Encoded technical QA and two independent critics passed; owner review'+(' and listening' if qa['listening_required'] else '')+' required.'}
    except Exception as exc:
        cv._write(directory/'failure.json',{'error_type':type(exc).__name__,'reason':str(exc)[:1000] if isinstance(exc,ValueError) else 'Correction operation failed; inspect worker logs'})
        result={'status':'held','item':None,'learnings':[],'summary':'Correction held: '+type(exc).__name__+'; inspect private correction state.'}
    cv._write(state,result);return result
