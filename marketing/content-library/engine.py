"""Content jobs, reference retrieval and write-once render bundles (stdlib only)."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
from datetime import datetime, timezone
from html.parser import HTMLParser
import math

CRITERIA=('math','hebrew','readability','brand','hook_payoff')
IGNORED={'.git','.hyperframes','.thumbnails','.waveform-cache','renders','node_modules','outputs','__pycache__'}


def canonical(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()


def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for part in iter(lambda:f.read(1024*1024),b''):h.update(part)
    return h.hexdigest()


def unique(rows,key):
    result={}
    for row in rows:
        k=key(row)
        if not k or k in result:raise ValueError(f'Missing or duplicate ID: {k}')
        result[k]=row
    return result


def snapshot_from_cells(payload,batch,asset_keys=None):
    payload=payload.get('structuredContent',payload);tables={}
    limits={'Queue':11,'Components':9,'Recipes':11,'References':10,'Ideas':7}
    for sheet in payload['sheets']:
        title=sheet['properties']['title']
        if title not in limits:continue
        blocks=[d for d in sheet.get('data',[]) if d.get('startRow',0)==4]
        if len(blocks)!=1:raise ValueError('Read each table starting at row5, with headers')
        rows=[]
        for row in blocks[0].get('rowData',[]):
            values=[]
            for c in row.get('values',[])[:limits[title]]:
                value=c.get('userEnteredValue',{})
                if 'formulaValue' in value:
                    if 'formattedValue' not in c:raise ValueError('Formula-backed input needs a displayed value')
                    values.append(c['formattedValue'])
                else:values.append(value.get('stringValue',value.get('numberValue',value.get('boolValue',''))))
            if values and values[0]:rows.append(values)
        if not rows:raise ValueError('Missing table headers')
        tables[title]=rows[1:]
    for title in ('Queue','Components','Recipes'):
        if title not in tables:raise ValueError(f'Missing required native table: {title}')
    queue=[]
    for row in tables['Queue']:
        if len(row)<11:raise ValueError('Incomplete Queue record')
        q=dict(zip(('id','title','preview','caption','decision','feedback','slot','goal','status','alt','format'),row[:11]))
        q['asset']=(asset_keys or {}).get(q['id'],q['id']);queue.append(q)
    snapshot={'batch':batch,'queue':queue,'components':tables['Components'],'recipes':tables['Recipes'],'queue_guard':tables['Queue']}
    if 'Ideas' in tables:
        ideas=tables['Ideas']
        if any(len(row)!=7 for row in ideas):raise ValueError('Incomplete Ideas record')
        unique(ideas,lambda row:row[0])
        snapshot['ideas']=ideas
    if 'References' in tables:
        refs=[]
        for row in tables['References']:
            if len(row)<10:raise ValueError('Incomplete reference record')
            ref=dict(zip(('id','title','source','timestamp','audience','mechanism','use','avoid','owner_reaction'),row[:9]));ref['components']=[s.strip() for s in row[9].split(',') if s.strip()];refs.append(ref)
        snapshot['references']=refs
    return snapshot


def resolve_job(data,post_id,references,recipe_id=None):
    if not isinstance(post_id,str) or not re.fullmatch(r'P\d+',post_id):raise ValueError('Invalid post ID')
    posts=unique(data['queue'],lambda r:r['id'])
    components=unique(data['components'],lambda r:r[0])
    recipes=unique(data['recipes'],lambda r:r[0])
    refs=unique(references,lambda r:r['id'])
    if post_id not in posts:raise ValueError(f'Unknown post: {post_id}')
    candidates=[r for r in recipes.values() if r[1]==post_id]
    if recipe_id:
        candidates=[recipes[recipe_id]] if recipe_id in recipes and recipes[recipe_id][1].split()[0]==post_id else []
    if len(candidates)!=1:raise ValueError('Select exactly one primary recipe for the post')
    recipe=candidates[0];selected=[]
    for pinned,kind in zip(recipe[3:6],['Hook','Body','CTA']):
        bits=pinned.split('@')
        if len(bits)!=2 or bits[0] not in components:raise ValueError(f'Missing component: {pinned}')
        component=components[bits[0]]
        if str(component[6])!=bits[1] or component[1]!=kind:raise ValueError(f'Invalid pinned revision/type: {pinned}')
        if component[7] not in ('Review','Approved'):raise ValueError(f'Component not verified for a preview: {pinned}')
        selected.append(component)
    hook,body,cta=selected
    for a,b in [(hook,body),(body,hook),(body,cta),(cta,body)]:
        if b[0] not in re.findall(r'\b[HBC]\d+\b',a[5]):raise ValueError(f'Incompatible components: {a[0]} / {b[0]}')
    for c in selected:
        if c[2]!=recipe[2]:raise ValueError('Recipe/component audience mismatch')
    if len(recipe)>10 and recipe[10].strip():
        ids=[s.strip() for s in recipe[10].split(',') if s.strip()]
        if any(i not in refs for i in ids):raise ValueError('Missing explicitly linked reference')
        chosen=[refs[i] for i in ids]
    else:
        ids={r[0] for r in selected};ranked=[]
        words=set(re.findall(r'\w+',str(recipe[8]).lower()))
        for r in references:
            score=10*len(ids&set(r.get('components',[])))
            if r.get('audience')==recipe[2]:score+=1
            score+=min(2,len(words&set(re.findall(r'\w+',r.get('mechanism','').lower()))))
            if score:ranked.append((-score,r['id'],r))
        chosen=[r for _,_,r in sorted(ranked)[:3]]
    post={k:v for k,v in posts[post_id].items() if k not in ('decision','feedback','status','slot')}
    result={'batch':data['batch'],'post':post,'recipe':recipe[:10],
            'components':selected,'references':chosen,
            'constraints':{'brand':'מאה בקליק / MeaBeclick','no_people':True,
                           'no_tutor_names':True,'no_ai_novelty_claim':True,
                           'audio':'silent','human_review_budget_minutes':30}}
    if posts[post_id].get('feedback'):result['owner_feedback']=posts[post_id]['feedback']
    return result


def physical_path(path):
    path=Path(path)
    if '..' in path.parts:raise ValueError('Parent traversal is not a supported input path')
    path=path if path.is_absolute() else Path.cwd()/path
    current=Path(path.anchor)
    for part in path.parts[1:]:
        current/=part
        if current.is_symlink():raise ValueError(f'Symlink input/ancestor is not supported: {current.name}')
    return path


def source_files(project):
    project=physical_path(project)
    if project.is_symlink():raise ValueError('Symlink project is not supported')
    files=[]
    for current,dirs,names in os.walk(project,followlinks=False):
        dirs[:]=sorted(d for d in dirs if d not in IGNORED)
        for d in dirs:
            if (Path(current)/d).is_symlink():raise ValueError('Symlink source directory')
        for name in sorted(names):
            if name=='.DS_Store':continue
            f=Path(current)/name
            if f.is_symlink():raise ValueError('Symlink source file')
            if f.is_file():files.append({'path':f.relative_to(project).as_posix(),'sha256':sha(f)})
    if not any(f['path']=='index.html' for f in files):raise ValueError('Project index.html is missing')
    return sorted(files,key=lambda f:f['path'])


def artifact_identity(payload):
    post=payload['job']['post']['id']
    if not isinstance(post,str) or not re.fullmatch(r'P\d+',post):raise ValueError('Invalid artifact post ID')
    return post+'-'+hashlib.sha256(canonical(payload)).hexdigest()[:20]


def verify(bundle):
    bundle=Path(bundle);manifest=json.loads((bundle/'manifest.json').read_text())
    payload=manifest['payload']
    if artifact_identity(payload)!=manifest['artifact_id']:raise ValueError('Manifest identity mismatch')
    if not bundle.name.startswith('.freeze-') and bundle.name!=manifest['artifact_id']:raise ValueError('Artifact directory identity mismatch')
    if sha(bundle/'asset.mp4')!=payload['media']['sha256']:raise ValueError('Frozen media was modified')
    actual=source_files(bundle/'source')
    if actual!=payload['source_files']:raise ValueError('Frozen source was modified')
    return manifest


def freeze(job,project,media,output,parent=None,lineage=None):
    project,media,output=physical_path(project),physical_path(media),physical_path(output)
    if (project.parent/'manifest.json').exists():verify(project.parent)
    if media.is_symlink():raise ValueError('Symlink media is not supported')
    files=source_files(project)
    payload={'version':1,'job':job,'parent_artifact':parent,'source_files':files,
             'media':{'path':'asset.mp4','sha256':sha(media),'bytes':media.stat().st_size}}
    if lineage is not None:
        if not isinstance(lineage,dict) or not lineage.get('concept_id') or not isinstance(lineage.get('source_manifest'),list):
            raise ValueError('Generated artifact lineage requires concept and source manifests')
        payload['lineage']=lineage
    identity=artifact_identity(payload);output.mkdir(parents=True,exist_ok=True);target=output/identity
    if target.exists():
        if verify(target)['payload']!=payload:raise ValueError('Conflicting frozen artifact')
        return target
    scratch=Path(tempfile.mkdtemp(prefix='.freeze-',dir=output))
    try:
        for record in files:
            dest=scratch/'source'/record['path'];dest.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(project/record['path'],dest)
        shutil.copyfile(media,scratch/'asset.mp4')
        manifest={'artifact_id':identity,'created_at':datetime.now(timezone.utc).isoformat(),'payload':payload}
        (scratch/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,sort_keys=True,indent=2)+'\n')
        verify(scratch)
        try:scratch.rename(target)
        except OSError:
            if not target.exists() or verify(target)['payload']!=payload:raise
        return target
    finally:
        if scratch.exists():shutil.rmtree(scratch)


class HtmlTokens(HTMLParser):
    def __init__(self,text):
        super().__init__(convert_charrefs=False);self.tokens=[];self.context=[];self.feed(text)
    def handle_starttag(self,tag,attrs):
        self.tokens.append(('tag',tag,attrs))
        if tag in ('script','style'):self.context.append(tag)
    def handle_startendtag(self,tag,attrs):self.tokens.append(('empty',tag,attrs))
    def handle_endtag(self,tag):
        self.tokens.append(('end',tag))
        if self.context and self.context[-1]==tag:self.context.pop()
    def handle_data(self,data):self.tokens.append((self.context[-1] if self.context else 'text',data))
    def handle_entityref(self,name):self.tokens.append(('entity',name))
    def handle_charref(self,name):self.tokens.append(('char',name))
    def handle_comment(self,data):self.tokens.append(('comment',data))
    def handle_decl(self,decl):self.tokens.append(('decl',decl))


CSS_PROPERTIES={'font-size','line-height','font-weight','top','left','right','bottom','width','height','padding','padding-top','padding-bottom','padding-left','padding-right','margin','margin-top','margin-bottom','opacity','border-radius','stroke-width','stroke-dasharray','stroke-dashoffset','color','background-color'}
CSS_VALUE=re.compile(r'(?:[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:px|em|rem|%|s|ms)?\s*)+|#[0-9a-fA-F]{3,8}|normal|bold|white|black|transparent')


def css_signature(text):
    def replace(m):
        prop=m[2].split(':')[0].strip();value=m[3].strip()
        return m[1]+m[2]+'<literal>' if prop in CSS_PROPERTIES and CSS_VALUE.fullmatch(value) else m[0]
    return re.sub(r'(^|[;{])(\s*[\w-]+\s*:\s*)([^;{}]*)(?=[;}])',replace,text,flags=re.M)


JS_LITERAL=re.compile(r'''"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|//[^\n]*|/\*.*?\*/|(?<![\w$])-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?''',re.S)


def js_signature(text):
    def replace(m):
        v=m[0]
        if v[0] in ('"',"'",'`') or v.startswith(('/', '*')):return v
        number=float(v)
        if not math.isfinite(number) or abs(number)>10000:raise ValueError('Tween literal is outside the supported range')
        return '<number>'
    return JS_LITERAL.sub(replace,text)


def safe_html_change(before,after):
    old,new=HtmlTokens(before).tokens,HtmlTokens(after).tokens
    if len(old)!=len(new):return False
    for a,b in zip(old,new):
        if a[0]!=b[0]:return False
        if a[0]=='text':continue
        if a[0]=='style':
            if css_signature(a[1])!=css_signature(b[1]):return False
        elif a[0]=='script':
            if js_signature(a[1])!=js_signature(b[1]):return False
        elif a!=b:return False
    return True


def apply_patches(source,destination,patches):
    source,destination=physical_path(source),physical_path(destination)
    if destination.exists():raise ValueError('Revision destination already exists')
    files={f['path'] for f in source_files(source)};updates={};total=0
    for patch in patches:
        name=patch.get('path','');rel=Path(name)
        if rel.is_absolute() or '..' in rel.parts or name not in files or rel.suffix!='.html':raise ValueError('Patch path must be an existing project HTML file')
        before,after=patch.get('before'),patch.get('after')
        if not isinstance(before,str) or not isinstance(after,str) or not before or len(before)>6000 or len(after)>6000:raise ValueError('Invalid or oversized patch')
        total+=len(before)+len(after)
        if total>20000:raise ValueError('Oversized replacement')
        text=updates.get(name,(source/name).read_text())
        if text.count(before)!=1:raise ValueError('Replacement must match exactly once')
        updates[name]=text.replace(before,after,1)
    if not updates:raise ValueError('Revision needs an exact patch')
    for name,text in updates.items():
        if not safe_html_change((source/name).read_text(),text):raise ValueError('Only text, approved CSS literals and existing JS numeric literals may change')
    destination.mkdir(parents=True)
    for record in source_files(source):
        dest=destination/record['path'];dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source/record['path'],dest)
    for name,text in updates.items():(destination/name).write_text(text)


def validate_review(report,artifact_id):
    if not isinstance(report,dict) or report.get('artifact_id')!=artifact_id:raise ValueError('Review artifact identity mismatch')
    verdict=report.get('verdict');checks=report.get('checks');findings=report.get('findings');patches=report.get('patches')
    if verdict not in ('pass','revise','needs_human') or not isinstance(checks,dict) or set(checks)!=set(CRITERIA):raise ValueError('Incomplete review checks')
    if any(v not in ('pass','fail','not_applicable','unverified') for v in checks.values()):raise ValueError('Unknown review outcome')
    if not isinstance(findings,list) or not isinstance(patches,list) or len(findings)>12 or len(patches)>12:raise ValueError('Invalid review findings')
    for f in findings:
        if f.get('severity') not in ('P0','P1') or not isinstance(f.get('time_seconds'),(int,float)) or not 0<=f['time_seconds']<=600 or not f.get('issue') or not f.get('change'):raise ValueError('Invalid timestamped finding')
    if verdict=='pass' and (findings or patches or any(v not in ('pass','not_applicable') for v in checks.values())):raise ValueError('A failed/unverified review cannot pass')
    if verdict=='revise' and (not findings or not patches):raise ValueError('Revision requires findings and patches')
    if not isinstance(report.get('summary'),str) or not report['summary'].strip():raise ValueError('Review summary is missing')
    return report


def queue_patch(row,artifact_id,manifest,references,gate,candidate_id='',candidate_preview=''):
    if not row or not re.fullmatch(r'P\d+',row[0]):raise ValueError('Invalid queue post ID')
    if len(row)>11 and row[11] and row[11]!=artifact_id:
        if not candidate_preview:raise ValueError('A new version needs a separate candidate preview; the reviewed binding stays frozen')
        return {'post_id':row[0],'start_column':11,'values':row[11:15]+[artifact_id,candidate_preview]}
    return {'post_id':row[0],'start_column':11,'values':[artifact_id,manifest,','.join(references),gate,candidate_id,candidate_preview]}


def check_queue_guard(before,current):
    if before[:11]!=current[:11]:raise ValueError('Queue changed since snapshot; refresh before applying writeback')


def review_loop(artifact,review,revise,max_revisions=2):
    if type(max_revisions) is not int or not 0<=max_revisions<=2:raise ValueError('At most two revisions are allowed')
    attempts=[]
    for turn in range(max_revisions+1):
        try:
            report=validate_review(review(artifact),artifact)
            attempts.append({'artifact_id':artifact,'review':report})
            if report['verdict']=='pass':return {'status':'ready_for_human','artifact_id':artifact,'revisions':turn,'attempts':attempts}
            if report['verdict']=='needs_human' or turn==max_revisions:break
            artifact=revise(artifact,report)
        except (ValueError,OSError,TimeoutError,RuntimeError) as exc:
            return {'status':'needs_human','artifact_id':artifact,'revisions':turn,'attempts':attempts,'error':str(exc)}
    return {'status':'needs_human','artifact_id':artifact,'revisions':len(attempts)-1,'attempts':attempts}


def validate_result(result,root,policy,budget,lookup):
    if not isinstance(result,dict) or result.get('root_artifact')!=root or result.get('policy_sha256')!=policy or result.get('max_revisions')!=budget or result.get('owner_approved') is not False:raise ValueError('Cached review identity/policy/budget mismatch')
    status=result.get('status');attempts=result.get('attempts');count=result.get('revisions')
    if status not in ('ready_for_human','needs_human') or not isinstance(attempts,list) or len(attempts)>budget+1 or type(count) is not int or not 0<=count<=budget:raise ValueError('Invalid cached aggregate')
    previous=None
    for i,attempt in enumerate(attempts):
        identity=attempt['artifact_id'];manifest=lookup(identity)
        if manifest['artifact_id']!=identity or (i==0 and identity!=root) or (i>0 and manifest['payload']['parent_artifact']!=previous):raise ValueError('Cached artifact chain mismatch')
        report=validate_review(attempt['review'],identity)
        if i<len(attempts)-1 and report['verdict']!='revise':raise ValueError('Cached sequence continues after a final verdict')
        previous=identity
    identity=result.get('artifact_id');manifest=lookup(identity)
    if manifest['artifact_id']!=identity:raise ValueError('Cached final identity mismatch')
    if not attempts:
        if status!='needs_human' or not result.get('error') or identity!=root or count!=0:raise ValueError('Empty cached pass is invalid')
    elif identity!=previous:
        if status!='needs_human' or not result.get('error') or manifest['payload']['parent_artifact']!=previous or count!=len(attempts):raise ValueError('Invalid unreviewed cached candidate')
    elif count!=len(attempts)-1:raise ValueError('Cached revision count mismatch')
    if status=='ready_for_human' and (not attempts or attempts[-1]['review']['verdict']!='pass' or identity!=previous):raise ValueError('Cached ready status has no final passing review')
    if status=='needs_human' and attempts and attempts[-1]['review']['verdict']=='pass':raise ValueError('Cached result contradicts its final review')
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['capture','brief','freeze','verify'])
    parser.add_argument('--cells',type=Path);parser.add_argument('--batch',default='W001')
    parser.add_argument('--snapshot',type=Path)
    parser.add_argument('--references',type=Path)
    parser.add_argument('--post');parser.add_argument('--project',type=Path);parser.add_argument('--media',type=Path)
    parser.add_argument('--output',type=Path);parser.add_argument('--bundle',type=Path)
    a=parser.parse_args()
    if a.command=='capture':
        if not a.cells or not a.output:parser.error('capture requires --cells and --output')
        keys={q['id']:q['asset'] for q in json.loads(Path(__file__).with_name('library.json').read_text())['queue']}
        result=snapshot_from_cells(json.loads(a.cells.read_text()),a.batch,keys)
        a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'snapshot':str(a.output),'posts':len(result['queue'])}));return
    if a.command=='verify':print(json.dumps({'verified':verify(a.bundle)['artifact_id']}));return
    if not a.snapshot or not a.post:parser.error('--snapshot and --post are required')
    snapshot=json.loads(a.snapshot.read_text())
    references=json.loads(a.references.read_text()) if a.references else snapshot.get('references',json.loads(Path(__file__).with_name('references.json').read_text()))
    job=resolve_job(snapshot,a.post,references)
    if a.command=='brief':print(json.dumps(job,ensure_ascii=False,indent=2));return
    if not a.project or not a.media or not a.output:parser.error('freeze requires --project --media --output')
    bundle=freeze(job,a.project,a.media,a.output);print(json.dumps({'artifact_id':bundle.name,'bundle':str(bundle)}))

if __name__=='__main__':main()
