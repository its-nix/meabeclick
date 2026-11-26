"""Generate and validate isolated per-post HyperFrames project source."""
import ast
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from html.parser import HTMLParser

import engine

HERE=Path(__file__).resolve().parent
ASSET_SOURCE=HERE/'posts'/'ad-parent-paper-sfx'/'assets'
FILES={'html','caption','alt_text','cta_category','timeline','math_assertions','claims_evidence','remote_assets'}
ASSETS=('logo.svg','fonts/heebo-hebrew-wght-normal.woff2','fonts/heebo-latin-wght-normal.woff2','gsap.min.js')
ALLOWED_URLS=set('assets/'+name for name in ASSETS)
MAX_PROJECT_BYTES=512_000


class ProjectValidationError(ValueError):
    """The model returned a project that failed the local render contract."""


def _load_json(value):
    if isinstance(value,dict):return value
    if isinstance(value,str):
        try:return json.loads(value)
        except json.JSONDecodeError as exc:raise ValueError('Malformed project JSON') from exc
    raise ValueError('Project output must be a JSON object')


def _number(node):
    if isinstance(node,ast.Expression):return _number(node.body)
    if isinstance(node,ast.Constant) and type(node.value) in (int,float):return node.value
    if isinstance(node,ast.UnaryOp) and isinstance(node.op,(ast.UAdd,ast.USub)):
        value=_number(node.operand);return value if isinstance(node.op,ast.UAdd) else -value
    if isinstance(node,ast.BinOp):
        left,right=_number(node.left),_number(node.right)
        ops={ast.Add:lambda:left+right,ast.Sub:lambda:left-right,ast.Mult:lambda:left*right,ast.Div:lambda:left/right}
        for kind,fn in ops.items():
            if isinstance(node.op,kind):return fn()
    raise ValueError('Unsupported math expression')


def _check_math(assertions):
    if not isinstance(assertions,list):raise ValueError('Malformed math assertions')
    for item in assertions:
        if not isinstance(item,dict) or set(item)!={'expression','result'} or not isinstance(item['expression'],str):raise ValueError('Malformed math assertion')
        try:value=_number(ast.parse(item['expression'],mode='eval'))
        except (SyntaxError,ZeroDivisionError,ValueError) as exc:raise ValueError('Invalid math assertion') from exc
        if not isinstance(item['result'],(int,float)) or not math.isfinite(value) or not math.isfinite(item['result']) or abs(value-item['result'])>1e-9:raise ValueError('Math assertion result mismatch')


class _Markup(HTMLParser):
    def __init__(self,allowed=None):super().__init__();self.html=False;self.root=False;self.bad=[];self.has_script=False;self.allowed=allowed or ALLOWED_URLS
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if tag=='html':self.html=attrs.get('lang')=='he' and attrs.get('dir')=='rtl'
        if attrs.get('id')=='root':self.root=all(attrs.get(k)==v for k,v in {'data-composition-id':'main','data-start':'0','data-width':'1080','data-height':'1920','data-fps':'30'}.items()) and attrs.get('data-duration')=='15'
        if tag in ('iframe','object','embed','form','base'):self.bad.append('external-capable markup')
        if tag=='script':
            self.has_script=True
            if attrs.get('src') and attrs['src'] not in self.allowed:self.bad.append('external script')
        for key in ('src','href','poster'):
            value=attrs.get(key,'')
            if value and value not in self.allowed and not value.startswith('#') and not value.startswith('data:image/svg+xml,'):
                self.bad.append('external asset reference')
        for key,value in attrs.items():
            if key.startswith('on') and key not in ('onload',):self.bad.append('unexpected event handler')
    def handle_data(self,data):
        if re.search(r'\b(fetch|XMLHttpRequest|WebSocket|EventSource|importScripts)\s*\(|\bimport\s*\(',data):self.bad.append('network-capable script')


def _validate(manifest,concept,context):
    if set(manifest)!=FILES:raise ValueError('Project manifest fields changed')
    if not all(isinstance(manifest.get(k),str) and manifest[k].strip() for k in ('html','caption','alt_text')):raise ValueError('Caption or alt text missing')
    if len(manifest['html'].encode())>MAX_PROJECT_BYTES:raise ValueError('Generated project exceeds size limit')
    if manifest['cta_category'] not in ('educational','booking','acquisition','waitlist','participation'):raise ValueError('Invalid CTA category')
    remote=manifest['remote_assets']
    if not isinstance(remote,list) or len(remote)>5:raise ValueError('Malformed remote assets')
    remote_paths=set()
    for asset in remote:
        if not isinstance(asset,dict) or set(asset)!={'url','license','purpose','path'} or not all(isinstance(asset[k],str) and asset[k].strip() for k in asset):raise ValueError('Remote asset source/license/purpose required')
        if not asset['url'].startswith('https://') or not re.fullmatch(r'assets/remote-[1-5]\.(png|jpe?g|webp)',asset['path']):raise ValueError('Remote asset must use HTTPS and an allowlisted local raster path')
        if asset['path'] in remote_paths:raise ValueError('Duplicate remote asset path')
        remote_paths.add(asset['path'])
    parser=_Markup(ALLOWED_URLS|remote_paths);parser.feed(manifest['html']);parser.close()
    if not parser.html or not parser.root or not parser.has_script:raise ValueError('HyperFrames Hebrew/RTL composition is incomplete')
    if parser.bad:raise ValueError(parser.bad[0])
    if 'window.__timelines.main' not in manifest['html'] or 'gsap.timeline' not in manifest['html']:raise ValueError('Timed main GSAP timeline required')
    if re.search(r'(?:drawSVG|morphSVG|DrawSVGPlugin|MorphSVGPlugin)', manifest['html']):
        raise ValueError('Project requires an unavailable GSAP extension')
    for forbidden in ('https://','http://','@import','url(//','file://','document.cookie','localStorage','process.env'):
        if forbidden in manifest['html']:raise ValueError('Forbidden external or environment reference')
    timeline=manifest['timeline']
    if not isinstance(timeline,list) or len(timeline)<2:raise ValueError('Timeline needs at least two beats')
    previous=0
    for beat in timeline:
        if not isinstance(beat,dict) or set(beat)!={'start','end','action'} or type(beat['start']) not in (int,float) or type(beat['end']) not in (int,float) or not isinstance(beat['action'],str):raise ValueError('Malformed timeline beat')
        if beat['start']<previous or beat['end']<=beat['start'] or beat['end']>15:raise ValueError('Timeline bounds or order invalid')
        previous=beat['end']
    _check_math(manifest['math_assertions'])
    planned_math = concept.get('math_spec', {}).get('assertions', [])
    if any(assertion not in manifest['math_assertions'] for assertion in planned_math):
        raise ValueError('Project dropped a verified concept calculation')
    if not isinstance(manifest['claims_evidence'],list):raise ValueError('Malformed claim evidence')
    verified=context.get('verified_features',[])
    ids={x.get('id') for x in verified if isinstance(x,dict)}
    for item in manifest['claims_evidence']:
        if not isinstance(item,dict) or set(item)!={'claim','evidence_id'} or item['evidence_id'] not in ids:
            raise ValueError('Claim evidence is missing or unverified')
    required=set(concept.get('claims',[]))
    listed={x['claim'] for x in manifest['claims_evidence']}
    if not required<=listed:raise ValueError('Concept claim lacks project evidence')
    for asset_path in re.findall(r'assets/remote-[1-5]\.(?:png|jpe?g|webp)',manifest['html']):
        if asset_path not in remote_paths:raise ValueError('HTML uses an undeclared remote asset')
    return manifest


def run_codex(prompt):
    cli=shutil.which('codex');home=os.environ.get('CODEX_CREATIVE_HOME')
    if not cli or not home or not Path(home).is_dir():raise RuntimeError('Creative project model authorization unavailable')
    env={k:v for k,v in os.environ.items() if k in ('PATH','TMPDIR','LANG','LC_ALL','SSL_CERT_FILE','SSL_CERT_DIR')}
    env.update(CODEX_HOME=str(Path(home).absolute()),HOME='/tmp',NO_COLOR='1')
    with tempfile.TemporaryDirectory(prefix='creative-project-') as scratch:
        output=Path(scratch)/'result.json'
        args=[cli,'exec','--ignore-user-config','--ignore-rules','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--cd',scratch,'--output-schema',str(HERE/'creative-project-schema.json'),'--output-last-message',str(output),'--json','--color','never','-c','web_search="disabled"','-c','shell_environment_policy.inherit="none"','-c','developer_instructions="Use supplied task data only. Use no tools."','-']
        result=subprocess.run(args,input=prompt,text=True,capture_output=True,timeout=600,env=env)
        if result.returncode or not output.is_file():raise RuntimeError('Creative project generation failed')
        return output.read_text()


def scoped_rules(context, format_id):
    """Retain only rules for this format and strip private feedback provenance."""
    rules = (context or {}).get('active_rules') or []
    return [{key: rule[key] for key in ('scope','format_id','rule') if key in rule}
            for rule in rules if isinstance(rule,dict) and isinstance(rule.get('rule'),str)
            and (rule.get('scope') == 'global'
                 or (rule.get('scope') == 'format' and rule.get('format_id') == format_id))]


def create_project(concept,context,runner,root):
    if not isinstance(concept,dict) or not isinstance(concept.get('id'),str) or not re.fullmatch(r'C[A-Za-z0-9_-]{1,64}',concept.get('id','')):raise ValueError('Stable safe concept ID required')
    root=engine.physical_path(root);root.mkdir(parents=True,exist_ok=True)
    project=root/concept['id']
    if project.exists():
        try:record=json.loads((project/'project-manifest.json').read_text())
        except (OSError,json.JSONDecodeError) as exc:raise ValueError('Existing project requires manual reconciliation') from exc
        actual={item['path']:item['sha256'] for item in engine.source_files(project) if item['path']!='project-manifest.json'}
        if record.get('concept_id')!=concept['id'] or record.get('files')!=actual:raise ValueError('Existing project changed; inspect/reconcile before retry')
        return {'status':'ready','project':str(project),'manifest':record,'remote_assets':record.get('remote_assets',[])}
    context=context if isinstance(context,dict) else {}
    instruction=(HERE/'creative-project-prompt.md').read_text()
    bounded={'concept':concept,'verified_features':context.get('verified_features',[]),'style_rules':scoped_rules(context,concept['format']),'style':'paper/blue/orange; silent-first; Hebrew RTL; mobile readable'}
    prompt=instruction+'\n\nTASK DATA:\n'+json.dumps(bounded,ensure_ascii=False,sort_keys=True)
    try:
        raw=(runner or run_codex)(prompt)
        manifest=_validate(_load_json(raw),concept,context)
        html=manifest['html']
        if any('assets/'+asset not in html for asset in ASSETS if asset != 'logo.svg'):
            raise ValueError('Project must use pinned Hebrew and Latin fonts and local GSAP')
    except ValueError as exc:
        raise ProjectValidationError(str(exc)) from exc
    scratch=Path(tempfile.mkdtemp(prefix='.project-',dir=root))
    try:
        assets=scratch/'assets';assets.mkdir()
        for relative in ASSETS:
            source=ASSET_SOURCE/relative;target=assets/relative;target.parent.mkdir(parents=True,exist_ok=True)
            if source.is_symlink() or not source.is_file():raise ValueError('Pinned brand asset missing or symlinked')
            shutil.copyfile(source,target)
        (scratch/'index.html').write_text(html)
        (scratch/'meta.json').write_text(json.dumps({'id':'meabeclick-'+concept['id'],'name':'meabeclick-'+concept['id']},ensure_ascii=False,indent=2)+'\n')
        (scratch/'hyperframes.json').write_text(json.dumps({'authoringSkill':'hyperframes','paths':{'assets':'assets','blocks':'compositions','components':'compositions/components'}},indent=2)+'\n')
        hashes={p.relative_to(scratch).as_posix():engine.sha(p) for p in sorted(scratch.rglob('*')) if p.is_file()}
        record={'version':1,'concept_id':concept['id'],'audience':concept.get('audience'),'caption':manifest['caption'],'alt_text':manifest['alt_text'],'cta_category':manifest['cta_category'],'timeline':manifest['timeline'],'math_assertions':manifest['math_assertions'],'claims_evidence':manifest['claims_evidence'],'remote_assets':manifest['remote_assets'],'source_sha256':hashlib.sha256(html.encode()).hexdigest(),'files':hashes}
        (scratch/'project-manifest.json').write_text(json.dumps(record,ensure_ascii=False,sort_keys=True,indent=2)+'\n')
        if sum(p.stat().st_size for p in scratch.rglob('*') if p.is_file())>MAX_PROJECT_BYTES*5:raise ValueError('Project with pinned assets exceeds size limit')
        scratch.rename(project)
    finally:
        if scratch.exists():shutil.rmtree(scratch)
    return {'status':'ready','project':str(project),'manifest':record,'remote_assets':manifest['remote_assets']}
