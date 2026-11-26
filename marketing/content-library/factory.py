"""Bounded, explicit recipe plans over existing accepted layouts (stdlib only).

plan_batch(snapshot, requests, references=None, limit=2) never expands combinations.
Each request names post_id, recipe_id and template, with optional parameters,
copy (title/cta/hint) and series. Generated copy/media always needs fresh approval.
Geometry is deliberately fixed: 3x2 rectangles, +18 via +20-2, or -17 via -10-7.
Only integer starting values vary; this keeps proportional motion truthful.
"""
import copy
import hashlib
from html import escape
import json
from pathlib import Path
import re
import shutil
import tempfile
import engine

HERE=Path(__file__).resolve().parent
TEMPLATES={
    'parent-paper':{'source':'ad-parent-paper-sfx','post':('P001','P004'),'audience':'Parents','start':42,'series':('parent-support',)},
    'rectangle-v2':{'source':'riddle-rectangles-v2','post':'P002','audience':'Families','series':('counting-challenge','worked-challenge')},
    'add18-v2':{'source':'tip-add18-v2','post':'P003','audience':'Families','start':27,'series':('mental-addition','worked-challenge')},
}
SLOTS={
 'parent-paper':{'title':('index.html','שוב נתקעים'),'hint':('index.html','בכל פעם.'),'cta':('index.html','לתיאום שיעור')},
 'rectangle-v2':{'title':('compositions/lesson.html','כמה מלבנים<br>מסתתרים כאן?'),'hint':('compositions/lesson.html','קחו רגע. ספרו גם את הגדולים.'),'cta':('compositions/lesson.html','כתבו בתגובות כמה ריבועים מצאתם')},
 'add18-v2':{'hint':('compositions/lesson.html','קפיצה גדולה. תיקון קטן.'),'cta':('compositions/lesson.html','שמרו לחיבור הבא')},
}

def digest(value):return hashlib.sha256(engine.canonical(value)).hexdigest()

def plan_batch(snapshot, requests, references=None, limit=2, preferences=None):
    """Return <=limit unique explicit plans, preserving caller order; max 20 inputs.

    Source hashes and resolved native caption/components participate in identity.
    Native decisions are preserved; no plan inherits approval from its template.
    """
    if type(limit) is not int or not 1<=limit<=20:raise ValueError('Batch limit must be 1..20')
    if not isinstance(requests,list) or len(requests)>20:raise ValueError('Supply at most 20 explicit requests')
    result=[];seen=set()
    for request in requests:
        if not isinstance(request,dict) or set(request)-{'post_id','recipe_id','template','parameters','copy','series'}:raise ValueError('Unknown request fields')
        if any(not request.get(k) for k in ('post_id','recipe_id','template')):raise ValueError('Explicit post, recipe and template required')
        name=request['template']
        if name not in TEMPLATES:raise ValueError('Unsupported template')
        template=TEMPLATES[name]
        job=engine.resolve_job(snapshot,request['post_id'],references if references is not None else snapshot.get('references',[]),recipe_id=request['recipe_id'])
        if job['post']['id'] not in (template['post'] if isinstance(template['post'],tuple) else (template['post'],)) or job['recipe'][2]!=template['audience']:raise ValueError('Unsupported post/template audience combination')
        # Audio is not implicitly inherited from the SFX source.
        if str(job['recipe'][7]).lower()!='silent':raise ValueError('Factory currently supports explicitly silent recipes only')
        params=request.get('parameters',{})
        if not isinstance(params,dict) or set(params)-({'start'} if 'start' in template else set()):raise ValueError('Unsupported math parameters')
        params=({'start':params.get('start',template['start'])} if 'start' in template else {})
        if params and (type(params['start']) is not int or not 20<=params['start']<=79):raise ValueError('Start must be integer 20..79')
        slots=request.get('copy',{})
        if not isinstance(slots,dict) or set(slots)-set(SLOTS[name]):raise ValueError('Unsupported copy slot')
        for value in slots.values():
            if not isinstance(value,str) or not value.strip() or len(value)>48 or any(ord(c)<32 for c in value):raise ValueError('Copy must be 1..48 visible characters')
        series=request.get('series',template['series'][0])
        if series not in template['series']:raise ValueError('Unsupported editorial series')
        if series=='worked-challenge':
            slots={'hint':'נסו לבד לפני שהפתרון מופיע',**slots}
        native_post=copy.deepcopy(job['post'])
        if name=='add18-v2':
            n=params['start']
            job['post']['caption']=f'{n} ועוד 18 בראש? מוסיפים 20 ומחזירים 2: {n} + 20 = {n+20}; {n+20} − 2 = {n+18}. שמרו לחיבור הבא. מאה בקליק'
            job['post']['alt']=f'ישר מספרים: קפיצה מ־{n} ל־{n+20}, וחזרה בשתיים ל־{n+18}.'
            job['post']['title']=f'לחבר 18: {n} + 18'
        elif name=='rectangle-v2':
            job['post']['caption']='כמה מלבנים יש ברשת? גם ריבוע נחשב למלבן. ספרו לפני הפתרון, וכתבו בתגובות כמה ריבועים מצאתם. מאה בקליק'
            job['post']['alt']='רשת של 3 עמודות ו־2 שורות: 18 מלבנים בסך הכול, ובהם 8 ריבועים.'
            job['post']['title']='כמה מלבנים מסתתרים כאן?'
        else:
            n=params['start']
            job['post']['alt']=f'דף תרגיל מדגים {n} − 17: מחסרים 10 ומגיעים ל־{n-10}, מחסרים 7 ומגיעים ל־{n-17}. מאה בקליק, שיעורים פרטיים במתמטיקה בקריית גת ואונליין.'
            job['post']['caption']='שוב נתקעים בשיעורי הבית? צעד אחד בכל פעם. מאה בקליק — שיעורים פרטיים במתמטיקה בקריית גת וגם אונליין. לתיאום שיעור: meabeclick.com'
            job['post']['title']='צעד אחד בכל פעם'
        selected_rules=[r for r in (preferences or []) if r.get('state','active')=='active' and (r.get('scope')=='global' or r.get('format_id')==name)]
        if selected_rules:job['rule_snapshot']=copy.deepcopy(selected_rules)
        job['native_post']=native_post
        source=HERE/'posts'/template['source']
        plan={'version':1,'generator_sha256':engine.sha(Path(__file__)), 'template':name,'parameters':params,'copy':slots,'series':series,'job':job,'source_files':engine.source_files(source),'approval':'required'}
        plan['plan_id']='factory-'+digest(plan)[:24]
        if plan['plan_id'] not in seen:result.append(plan);seen.add(plan['plan_id'])
        if len(result)>limit:raise ValueError('Explicit batch exceeds review limit; split requests')
    return result


def _validate_plan(plan):
    value=copy.deepcopy(plan);identity=value.pop('plan_id',None)
    if identity!='factory-'+digest(value)[:24]:raise ValueError('Factory plan was modified')
    if value.get('generator_sha256')!=engine.sha(Path(__file__)):raise ValueError('Factory implementation changed; plan again')
    if value['template'] not in TEMPLATES:raise ValueError('Unsupported template')
    source=HERE/'posts'/TEMPLATES[value['template']]['source']
    if engine.source_files(source)!=value['source_files']:raise ValueError('Template source changed; plan again')
    return source


def _text_numbers(text,mapping):
    # Only exact visible text tokens; never IDs, CSS, timeline numbers or scripts.
    return re.sub(r'>(\d+)<',lambda m:'>'+str(mapping.get(int(m[1]),int(m[1])))+'<',text)


def generate_project(plan, output):
    """Create write-once factory-<hash> project under output; verify any reuse."""
    source=_validate_plan(plan);output=engine.physical_path(output);output.mkdir(parents=True,exist_ok=True)
    target=output/plan['plan_id']
    if target.exists():
        record=json.loads((target/'factory-build.json').read_text())
        actual=[f for f in engine.source_files(target) if f['path']!='factory-build.json']
        if record!={'plan':plan,'generated_files':actual}:raise ValueError('Generated project changed')
        return target
    scratch=Path(tempfile.mkdtemp(prefix='.factory-',dir=output))
    try:
        for record in plan['source_files']:
            dest=scratch/record['path'];dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source/record['path'],dest)
        name=plan['template'];file=scratch/('index.html' if name=='parent-paper' else 'compositions/lesson.html');text=file.read_text()
        if name=='parent-paper':
            n=plan['parameters']['start']
            text=text.replace('42 − 17 = <strong>25</strong>','FACTORY_RESOLVED_EXPRESSION')
            text=_text_numbers(text,{42:n,32:n-10,25:n-17})
            text=text.replace('FACTORY_RESOLVED_EXPRESSION',f'{n} − 17 = <strong>{n-17}</strong>')
            text=re.sub(r'<audio\b[^>]*>.*?</audio>','',text,flags=re.S)
            text=text.replace('data-fps="30"','data-fps="30" data-audio-intent="silent"')
            # Source sound files and cue sheet describe a different, unapproved mix.
            for path in ('assets/audio','assets/sfx'):
                shutil.rmtree(scratch/path,ignore_errors=True)
            for path in ('sound-plan.json','build-audio.py'):
                (scratch/path).unlink(missing_ok=True)
        elif name=='add18-v2':
            n=plan['parameters']['start']
            for old,new in [('27 + 20 = 47',f'{n} + 20 = {n+20}'),('47 − 2 = 45',f'{n+20} − 2 = {n+18}'),('27 + 18 = 45',f'{n} + 18 = {n+18}'),('27 + 18',f'{n} + 18')]:text=text.replace(old,new)
            text=_text_numbers(text,{27:n,47:n+20,45:n+18})
        file.write_text(text)
        for key,value in plan['copy'].items():
            relative,original=SLOTS[name][key];path=scratch/relative;html=path.read_text()
            if html.count('>'+original+'<')!=1:raise ValueError('Template copy slot changed')
            path.write_text(html.replace('>'+original+'<','>'+escape(value,quote=True)+'<'))
        if plan['job'].get('rule_snapshot'):
            import feedback_repair
            feedback_repair.apply_preferences(scratch,plan['job'],plan['job']['rule_snapshot'])
        # Never carry template's final/approval/audio claims into a new variant.
        (scratch/'meta.json').write_text(json.dumps({'id':plan['plan_id'],'name':name,'status':'requires-approval','audio':'silent','series':plan['series']},sort_keys=True,indent=2)+'\n')
        record={'plan':plan,'generated_files':engine.source_files(scratch)}
        (scratch/'factory-build.json').write_text(json.dumps(record,ensure_ascii=False,sort_keys=True,indent=2)+'\n')
        scratch.rename(target)
        return target
    finally:
        if scratch.exists():shutil.rmtree(scratch)


def freeze_generated(plan, project, media, output):
    """Bind exact generated inputs to engine's immutable rendered bundle."""
    _validate_plan(plan);project=engine.physical_path(project)
    record=json.loads((project/'factory-build.json').read_text())
    actual=[r for r in engine.source_files(project) if r['path']!='factory-build.json']
    if record!={'plan':plan,'generated_files':actual}:raise ValueError('Generated inputs changed')
    job=copy.deepcopy(plan['job'])
    if job.get('rule_snapshot'):
        import feedback_repair
        job=feedback_repair.apply_preferences(project,job,job['rule_snapshot'])
    job['factory']={k:v for k,v in plan.items() if k!='job'}
    return engine.freeze(job,project,media,output)
