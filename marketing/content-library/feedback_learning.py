"""One durable scope review for each new set of completed owner feedback."""
import json
from pathlib import Path

import engine
import feedback
from google_sync import _atomic


def review(queue,root,*,interpreter=None):
    import feedback_repair
    entries=[];package=None;journals={}
    for path in (Path(root)/'feedback-replacements').glob('*.json'):
        saved=json.loads(path.read_text())
        for fid in saved.get('related',[saved.get('feedback_id',path.stem)]):journals[fid]=saved
    for row in queue.db.execute("SELECT * FROM feedback_jobs WHERE status='completed' AND kind='owner' ORDER BY created DESC,id LIMIT 20"):
        job=dict(row);saved=journals.get(job['id'])
        if saved is None:continue
        if saved['status'] not in ('completed','resolved'):continue
        item=saved['item'];frozen=engine.verify(item['bundle'])['payload']['job']
        if package is None:package=item
        entries.append({'feedback_id':job['id'],'digest':job['digest'],'post_id':frozen['post']['id'],'comment':job['comment'],'format_id':frozen.get('factory',{}).get('template') or frozen['post'].get('format'),'verified_actions':frozen.get('constraints',{}).get('feedback_actions',{})})
    if not entries:return {'status':'idle','agent_called':False,'rules':[]}
    prompt=(Path(feedback_repair.__file__).parent/'feedback-repair-prompt.md').read_bytes()
    schema=(Path(feedback_repair.__file__).parent/'feedback-repair-schema.json').read_bytes()
    identity={'comments':[{k:e[k] for k in ('feedback_id','digest')} for e in entries],'implementation':engine.sha(Path(__file__)),'prompt':feedback._hash(prompt.hex()),'schema':feedback._hash(schema.hex())}
    directory=Path(root)/'feedback-learning';directory.mkdir(exist_ok=True);key=feedback._hash(identity);path=directory/(key+'.json')
    if path.exists():return {**json.loads(path.read_text()),'agent_called':False}
    _atomic(path,{'status':'running','identity':identity,'rules':[]})
    try:
        # Comments are data. This instruction authorizes classification only, never edits.
        instruction=('Perform a learning-only scope review of COMPLETED and VERIFIED owner feedback below. Do not edit any video or caption: patches must be empty; actions center=false,music=preserve,caption_suffix=preserve; caption must be empty or equal the supplied current caption. Return status repair and scoped learnings only. Identify repeated layout/style/music preferences across clips as reusable guidance; normally use a format-scoped default for repeatable template corrections, global only where the evidence supports a general preference across formats. One-off numbers, examples, timestamps and explicit this-video-only requests must not become reusable rules. Use the exact audited canonical sentences for supported centering/music/caption rules. Do not invent additional preferences. Use supplied existing rule IDs to supersede conflicts in the same scope. Return no learnings when no justified reusable lesson exists. Feedback data: '+json.dumps(entries,ensure_ascii=False))
        rules=[dict(r) for r in queue.db.execute("SELECT * FROM feedback_rules WHERE state='active'")]
        proposed=(interpreter or feedback_repair._interpret)(source=[],feedback_text=instruction,rules=rules,package=package)
        if proposed.get('status')!='repair' or proposed.get('patches') or proposed.get('actions')!={'center':False,'music':'preserve','caption_suffix':'preserve'} or proposed.get('caption') not in ('',package['caption']):raise ValueError('Learning-only review attempted a content change')
        learnings=[];known_formats={e['format_id'] for e in entries}
        for rule in proposed.get('learnings',[]):
            rule=dict(rule)
            if rule.get('scope')=='global':rule['format_id']=None
            elif rule.get('format_id') not in known_formats:raise ValueError('Unobserved learning scope')
            learnings.append(rule)
        origins=[e['feedback_id'] for e in entries]
        ids=feedback.record_learnings(queue,origins[0],learnings,related_feedback_ids=origins[1:])
        result={'status':'completed','identity':identity,'rules':ids,'summary':str(proposed.get('summary',''))[:1000]}
        _atomic(path,result)
        return {**result,'agent_called':True}
    except Exception as exc:
        result={'status':'held','identity':identity,'rules':[],'error':type(exc).__name__}
        _atomic(path,result)
        return {**result,'agent_called':True}
