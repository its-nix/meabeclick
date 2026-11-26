"""Deterministic weekly editorial proposals over compatible native pinned recipes."""
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo
import factory
import ops


def review_batch_id(now=None):
    """Stable owner-review batch identity for the current Jerusalem ISO week."""
    instant=(now or datetime.now(ZoneInfo('Asia/Jerusalem'))).astimezone(ZoneInfo('Asia/Jerusalem'))
    year,week,_=instant.isocalendar()
    return f'review-{year}-W{week:02d}'


def concept_slots(count, now=None, occupied=()):
    """Assign unique future publishing slots, no more than two per local day."""
    if type(count) is not int or not 0<=count<=20:raise ValueError('Concept slot count must be 0..20')
    if count==0:return []
    zone=ZoneInfo('Asia/Jerusalem');current=(now or datetime.now(zone)).astimezone(zone)
    taken={ops.instant(value).astimezone(zone) for value in occupied}
    slots=[];day=current.date();times=(time(12,30),time(19,30))
    for _ in range(45):
        for clock in times:
            candidate=datetime.combine(day,clock,zone)
            if candidate<=current or candidate in taken:continue
            slots.append(candidate.isoformat())
            if len(slots)==count:return slots
        day+=timedelta(days=1)
    raise ValueError('Could not assign all review candidates to future slots')


CALENDAR_ZONE = ZoneInfo('Asia/Jerusalem')
DAILY_PUBLISH_TIME = time(19, 30)
POSTS_PER_REVIEW = 7


def upcoming_days(now):
    """Tomorrow through one calendar month ahead, in Jerusalem."""
    today = now.astimezone(CALENDAR_ZONE).date()
    first = today + timedelta(days=1)
    next_month = (first.replace(day=28) + timedelta(days=4)).replace(day=1)
    month_after = (next_month.replace(day=28) + timedelta(days=4)).replace(day=1)
    last_day = min(first.day, (month_after - timedelta(days=1)).day)
    end = next_month.replace(day=last_day)
    return [first + timedelta(days=offset) for offset in range((end - first).days)]


def next_review_week(now):
    """Seven publication days following the recurring Sunday owner review."""
    today = now.astimezone(CALENDAR_ZONE).date()
    monday = today + timedelta(days=7 - today.weekday())
    return [monday + timedelta(days=offset) for offset in range(POSTS_PER_REVIEW)]


def daily_slot(day):
    return datetime.combine(day, DAILY_PUBLISH_TIME, CALENDAR_ZONE).isoformat()


def publishing_gaps(days, jobs, destinations):
    """A slot is covered only when one exact content version has all Buffer receipts."""
    expected = {(d['network'], d['account']) for d in destinations}
    covered = {}
    for job in jobs:
        receipt = job.get('receipt')
        if not receipt or receipt.get('provider') != 'buffer' or receipt.get('readback_verified') is not True or job['status'] not in ('scheduled', 'published'):
            continue
        package = job['package']
        day = ops.instant(package['scheduled_at']).astimezone(CALENDAR_ZONE).date()
        revision = (package.get('drive_receipt') or {}).get('revision_id')
        key = tuple(package.get(field) for field in
                    ('artifact_id', 'scheduled_at', 'media_sha256', 'caption', 'cta', 'preview_url')) + (revision,)
        covered.setdefault(day, {}).setdefault(key, set()).add((job['network'], job['account']))
    return [day.isoformat() for day in days if not expected or not any(
        channels >= expected for channels in covered.get(day, {}).values()
    )]


def weekly_plan(snapshot, date_iso, observations=None):
    """Return at most two proposed creatives for the containing Sunday-start week.

    Template compatibility is validated by the actual factory. Historical maze
    and fixed rectangle recipes are never substituted for missing native inputs.
    Observations inform a proposed experiment, never autonomous winner selection.
    """
    day = date.fromisoformat(date_iso)
    sunday = day - timedelta(days=(day.weekday()+1)%7)
    week = sunday.toordinal() // 7
    start = 20 + week % 60
    alternate = 20 + (week+17) % 60
    rows = [] if observations is None else observations
    evidence = ops.summarize_results(rows)
    experiment = ops.next_experiment(rows)
    refs = snapshot.get('references', [])
    if not isinstance(refs,list): raise ValueError('Native references must be a list')
    notes = [
        'Proposed batch; every changed caption, media asset and CTA requires exact human approval.',
        'Sunday and Wednesday 19:30 Asia/Jerusalem are starting defaults, not a researched optimum.',
        f'{len(refs)} native editorial references available; their presence does not establish performance.',
        f'{len(evidence["posts"])} closed-window post observations validated; missing conversions remain unknown.',
        'Vary one opening question in a future comparison with matched observation windows; no winner is inferred.',
        'Booking CTAs still require fresh capacity; parent availability is not inferred from the plan.',
    ]
    for reference in refs[:3]:
        if not isinstance(reference,dict): raise ValueError('Native reference records must be objects')
        mechanism=reference.get('mechanism') or reference.get('use')
        if isinstance(mechanism,str) and mechanism.strip():
            notes.append('Reference rationale for human consideration (not performance evidence): '+mechanism.strip()[:240])
    first = {'post_id':'P003', 'recipe_id':'R003', 'template':'add18-v2', 'parameters':{'start':start}, 'series':'mental-addition'}
    try:
        factory.plan_batch(snapshot,[first])
    except (ValueError, KeyError, IndexError):
        notes.append('Compatible pinned P003/R003 inputs missing; refresh the native snapshot before planning.')
        return {'batch':'weekly-'+sunday.isoformat(), 'requests':[], 'slots':[], 'notes':notes, 'status':'proposal', 'approval':'required', 'experiment':experiment}
    parent = {'post_id':'P004', 'recipe_id':'R004PAPER', 'template':'parent-paper', 'parameters':{'start':alternate}, 'series':'parent-support'}
    try:
        factory.plan_batch(snapshot,[parent])
        second = parent
        notes.append('Native P004/R004PAPER supplies the parent-support proposal; no legacy maze is selected.')
    except (ValueError, KeyError, IndexError):
        second = {'post_id':'P003', 'recipe_id':'R003', 'template':'add18-v2', 'parameters':{'start':alternate}, 'series':'worked-challenge'}
        notes.append('Compatible native parent-paper recipe unavailable; propose a distinct worked addition challenge.')
    requests = [first,second]
    factory.plan_batch(snapshot,requests)
    zone=ZoneInfo('Asia/Jerusalem')
    slots=[datetime.combine(sunday+timedelta(days=offset),time(19,30),zone).isoformat() for offset in (0,3)]
    return {'batch':'weekly-'+sunday.isoformat(), 'requests':requests, 'slots':slots, 'notes':notes, 'status':'proposal', 'approval':'required', 'experiment':experiment}
