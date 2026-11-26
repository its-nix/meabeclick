"""Bounded, idempotent original concept generation for the content machine."""
from datetime import datetime, timedelta
import hashlib
from difflib import SequenceMatcher
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

import engine

HERE = Path(__file__).resolve().parent
CONTEXT_KEYS = ('brand_brief', 'icps', 'creative_rules', 'active_rules',
                'verified_features', 'supported_formats', 'supported_primitives', 'ready_per_week',
                'recent_hooks', 'recent_concepts', 'historical_ideas', 'completed_feedback_summary',
                'outcome_summary')
REQUIRED = ('audience', 'hook_he', 'premise', 'beats', 'payoff', 'cta', 'format',
            'math_spec', 'claims', 'source_needs', 'production_requirements',
            'novelty_rationale')
AUDIENCES = {'Parents', 'Teens', 'Families'}


def _json_result(value):
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError as exc:
            raise ValueError('Ideation returned malformed JSON') from exc
    raise ValueError('Ideation must return a JSON object')


def _validate(concept, context):
    if not isinstance(concept, dict) or set(concept) != set(REQUIRED):
        raise ValueError('Concept does not match the required fields')
    if concept['audience'] not in AUDIENCES:
        raise ValueError('Unsupported audience')
    for key in ('hook_he', 'premise', 'payoff', 'cta', 'novelty_rationale'):
        if not isinstance(concept[key], str) or not concept[key].strip():
            raise ValueError('Missing concept text: '+key)
    if len(concept['hook_he']) < 8 or len(concept['hook_he']) > 100:
        raise ValueError('Hook length outside supported range')
    if not isinstance(concept['beats'], list) or not 2 <= len(concept['beats']) <= 6 or any(not isinstance(x, str) or not x.strip() for x in concept['beats']):
        raise ValueError('Concept needs 2..6 concrete beats')
    if not isinstance(concept['math_spec'], dict) or not all(isinstance(concept[k], list) for k in ('claims','source_needs','production_requirements')):
        raise ValueError('Malformed math, claim, or production fields')
    if not all(isinstance(x, str) for x in concept['claims']+concept['source_needs']+concept['production_requirements']):
        raise ValueError('Concept list fields must contain strings')
    if 'assertions' in concept['math_spec']:
        from creative_projects import _check_math
        _check_math(concept['math_spec']['assertions'])
    supported = set(context.get('supported_primitives', []))
    if supported and not set(concept['production_requirements']) <= supported:
        raise ValueError('Concept requires an unsupported visual primitive')
    formats = context.get('supported_formats')
    if formats and concept['format'] not in formats:
        # Per-post projects can define a new composition; only unknown product capabilities are blocked.
        if any('website' in requirement or 'product-flow' in requirement for requirement in concept['production_requirements']):
            raise ValueError('Unverified product format')
    verified = context.get('verified_features', [])
    for claim in concept['claims']:
        if claim not in verified:
            raise ValueError('Product or factual claim lacks verified evidence')
    return concept


def _normalize(text, remove_cta=True):
    text = str(text).lower()
    text = re.sub(r'\d+(?:[.,/]\d+)*', ' מספר ', text)
    text = re.sub(r'[^\w\u0590-\u05ff]+', ' ', text)
    tokens = [x for x in text.split() if x not in {'מספר','כתבו','כתבו בתגובות','שמרו','עקבו','נסו','גלו','תגובה'}]
    return ' '.join(tokens)


def _existing_hooks(store, context):
    hooks = list(context.get('recent_hooks', []))
    hooks += [item.get('hook_he', '') for item in context.get('historical_ideas', []) if isinstance(item, dict)]
    hooks += [json.loads(row[0]).get('hook_he', '') for row in store.db.execute('SELECT payload_json FROM concepts')]
    hooks = [x for x in hooks if isinstance(x, str) and x.strip()]
    return hooks


def _duplicate(hook, known):
    norm = _normalize(hook)
    for previous in known:
        old = _normalize(previous)
        if not norm or not old:
            continue
        if norm == old or SequenceMatcher(None, norm, old).ratio() >= 0.84:
            return previous
    return None


def _safe_context(context):
    if not isinstance(context, dict):
        raise ValueError('Ideation context must be an object')
    return {key: context[key] for key in CONTEXT_KEYS if key in context}


def _prompt(context, count):
    instructions = (HERE / 'idea-prompt.md').read_text()
    brief = json.dumps(_safe_context(context), ensure_ascii=False, sort_keys=True)
    return instructions+'\n\nGenerate at most '+str(count)+' concepts.\n\nBRIEF DATA:\n'+brief


def run_codex(prompt, schema=None):
    """Run the pinned CLI in a throwaway read-only directory without shell/web tools."""
    cli = shutil.which('codex')
    home = os.environ.get('CODEX_IDEATION_HOME')
    if not cli or not home or not Path(home).is_dir():
        raise RuntimeError('Ideation model authorization unavailable')
    env = {k:v for k,v in os.environ.items() if k in ('PATH','TMPDIR','LANG','LC_ALL','SSL_CERT_FILE','SSL_CERT_DIR')}
    env.update(CODEX_HOME=str(Path(home).absolute()), HOME='/tmp', NO_COLOR='1')
    with __import__('tempfile').TemporaryDirectory(prefix='idea-generation-') as scratch:
        out = Path(scratch)/'result.json'
        args = [cli,'exec','--ignore-user-config','--ignore-rules','--ephemeral','--skip-git-repo-check',
                '--sandbox','read-only','--cd',scratch,'--output-schema',str(HERE/'idea-schema.json'),
                '--output-last-message',str(out),'--json','--color','never','-c','web_search="disabled"',
                '-c','shell_environment_policy.inherit="none"','-c','developer_instructions="Use only supplied task data. Do not use tools."','-']
        result = subprocess.run(args, input=prompt, text=True, capture_output=True, timeout=300, env=env)
        if result.returncode or not out.is_file():
            raise RuntimeError('Ideation model run failed ('+str(result.returncode)+')')
        return out.read_text()


def _refill_hours(policy, ready, productive):
    """Fill a short calendar faster, then return to the normal reserve cadence."""
    floor = int(policy.get('calendar_floor', 0))
    if ready >= floor:
        return 24
    return 1 if productive else 2


def _due(store, context, now, policy):
    at = datetime.fromisoformat(now.replace('Z', '+00:00'))
    weekly = int(context.get('ready_per_week', 2))
    reserve = max(int(policy.get('reserve_weeks', 2))*weekly, int(policy.get('reserve_count', 0)))
    ready = store.db.execute("SELECT count(*) FROM concepts WHERE status='production_ready'").fetchone()[0]
    last = policy.get('last_generated_at')
    row = store.db.execute("SELECT id,status,updated_at,result_json FROM stage_runs WHERE stage='ideation' ORDER BY updated_at DESC,id DESC LIMIT 1").fetchone()
    productive = bool(row and row['status'] == 'completed' and
                      json.loads(row['result_json'] or '{}').get('accepted', 0) > 0)
    refill_hours = _refill_hours(policy, ready, productive)
    if row and row['status'] == 'held':
        old_contract = json.loads(row['result_json'] or '{}').get('schema_sha256')
        if old_contract != _schema_digest():
            return ready, reserve, True, False, None, refill_hours
    if row and (not last or datetime.fromisoformat(row['updated_at']) > datetime.fromisoformat(last.replace('Z','+00:00'))):
        last = row['updated_at']
    interval = int(policy.get('weekly_interval_days', 7))
    due = not last
    if last:
        previous = datetime.fromisoformat(last.replace('Z', '+00:00'))
        due = at-previous >= timedelta(days=interval)
    low = ready < reserve
    if low and last:
        previous = datetime.fromisoformat(last.replace('Z', '+00:00'))
        low = at-previous >= timedelta(hours=refill_hours)
    depleted_run = row['id'] if ready == 0 and policy.get('calendar_floor') and productive else None
    return ready, reserve, due, low, depleted_run, refill_hours


def _schema_digest():
    return hashlib.sha256((HERE/'idea-schema.json').read_bytes()).hexdigest()

def generate_due(store, context, runner, now, policy):
    safe = _safe_context(context)
    ready, reserve, due, low, depleted_run, refill_hours = _due(store, context, now, policy)
    if not (due or low or depleted_run):
        return {'status':'idle','called':False,'accepted':0,'rejected':0,'ready':ready,'reason':'no scheduled or depleted-inventory refill is due'}
    refill = max(0, reserve-ready, int(policy.get('refill_weeks',4))*int(context.get('ready_per_week',2))-ready)
    limit = min(12, int(policy.get('max_candidates',12)), max(1, refill*2))
    instant = datetime.fromisoformat(now.replace('Z','+00:00'))
    day_bucket = instant.date().isoformat()
    if depleted_run and not low and not due:
        trigger = f'depleted-after-{depleted_run}'
    elif low:
        refill_bucket = int(instant.timestamp()) // (refill_hours*3600)
        trigger = f'low-inventory-{refill_hours}h-{refill_bucket}'
    else:
        trigger = day_bucket
    fingerprint = hashlib.sha256(json.dumps({'context':safe,'trigger':trigger,'limit':limit,'policy':policy,'schema_sha256':_schema_digest()},sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    run_id, created = store.claim_stage('ideation', fingerprint, now)
    if not created:
        return {'status':'idle','called':False,'accepted':0,'rejected':0,'ready':ready,'run_id':run_id,'reason':'identical input already processed'}
    try:
        raw = (runner or run_codex)(_prompt(safe, limit), HERE/'idea-schema.json')
        response = _json_result(raw)
        if set(response) != {'concepts'} or not isinstance(response['concepts'], list) or len(response['concepts']) > limit:
            raise ValueError('Ideation response violates the output schema')
    except Exception as exc:
        store.finish_stage(run_id, 'held', {'error':type(exc).__name__, 'schema_sha256':_schema_digest()}, now)
        return {'status':'held','called':True,'accepted':0,'rejected':0,'ready':ready,'run_id':run_id,'reason':type(exc).__name__}
    known = _existing_hooks(store, safe)
    accepted = []; rejected = []
    for candidate in response['concepts']:
        if not isinstance(candidate, dict):
            rejected.append({'candidate':candidate,'reason':'not an object'}); continue
        try:
            _validate(candidate, safe)
            duplicate = _duplicate(candidate['hook_he'], known)
            if duplicate:
                raise ValueError('duplicate or near-duplicate hook')
            # Independent deterministic selection gate; prefer complete, specific concepts.
            if len(candidate['beats']) < 2 or len(candidate['novelty_rationale'].strip()) < 12:
                raise ValueError('insufficient concept detail')
            accepted.append(candidate)
            known.append(candidate['hook_he'])
        except (ValueError, KeyError, TypeError) as exc:
            rejected.append({'candidate':candidate,'reason':str(exc)})
    saved = store.save_concepts(run_id, accepted)
    for concept_id in saved:
        store.transition_concept(concept_id,'candidate','production_ready','Passed schema, novelty, claim, audience, and production checks')
    # Preserve rejected unique records as non-runnable history; duplicate hooks are
    # retained in the stage report without mutating an existing concept's state.
    existing_ids={row[0] for row in store.db.execute('SELECT id FROM concepts')}
    rejected_unique=[]
    for item in rejected:
        candidate=item.get('candidate')
        if not isinstance(candidate,dict): continue
        concept_id='C'+hashlib.sha256(json.dumps(candidate,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()[:20]
        if concept_id not in existing_ids:
            rejected_unique.append((concept_id,candidate,item['reason']))
            existing_ids.add(concept_id)
    if rejected_unique:
        ids=store.save_concepts(run_id,[item[1] for item in rejected_unique])
        for concept_id,(_,candidate,reason) in zip(ids,rejected_unique):
            store.transition_concept(concept_id,'candidate','rejected',reason)
    store.finish_stage(run_id,'completed',{'accepted':len(accepted),'rejected':len(rejected)},now)
    return {'status':'completed','called':True,'accepted':len(accepted),'rejected':len(rejected),'ready':ready+len(accepted),'run_id':run_id,'rejections':rejected}


def select_concepts(store, context, runner=None, limit=4):
    """Return currently production-ready concepts, stable order, no model call."""
    _safe_context(context)
    return store.ready_concepts(limit)
