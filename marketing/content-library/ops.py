"""Pure operating gates and observation-window checks for organic publishing."""
from datetime import datetime, timezone, timedelta
import math
from urllib.parse import urlparse

HISTORICAL_CAPACITY = {'total_hours': 31, 'occupied_hours': 5, 'observed_at': None}


def instant(value):
    result = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('Timestamps must include a timezone')
    return result.astimezone(timezone.utc)


def _number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0


def _fresh(value, now, days):
    try:
        age = now - instant(value)
        return _number(days) and timedelta(0) <= age <= timedelta(days=days)
    except (ValueError, TypeError, OverflowError):
        return False


def _decision(reasons, recovery):
    return {'allowed': not reasons, 'reasons': reasons, 'recovery': recovery}


def capacity_gate(cta, capacity=None, now=None):
    """Apply teaching capacity requirements to booking and acquisition requests."""
    if cta in ('educational', 'participation'):
        return _decision([], [])
    cap = dict(HISTORICAL_CAPACITY if capacity is None else capacity)
    now = instant(now or datetime.now(timezone.utc))
    reasons, recovery = [], []
    if cta not in ('booking', 'acquisition', 'waitlist'):
        return _decision(['unknown_cta'], ['Use an explicit educational, participation, booking, acquisition or waitlist CTA.'])
    total, occupied = cap.get('total_hours'), cap.get('occupied_hours')
    if not (_number(total) and total > 0 and _number(occupied) and occupied <= total):
        reasons.append('invalid_capacity'); recovery.append('Record valid total and occupied teaching hours.')
    if not _fresh(cap.get('observed_at'), now, cap.get('fresh_for_days', 7)):
        reasons.append('stale_capacity'); recovery.append('Confirm current capacity and record its timestamp; historical hours are not live availability.')
    if cta == 'waitlist':
        url = urlparse(str(cap.get('waitlist_url') or ''))
        if url.scheme not in ('https', 'http') or not url.hostname or url.username or url.password or not _fresh(cap.get('waitlist_verified_at'), now, cap.get('fresh_for_days', 7)):
            reasons.append('unverified_waitlist'); recovery.append('Verify the working public wait-list URL and record its verification timestamp.')
    elif _number(total) and _number(occupied) and occupied >= total:
        reasons.append('capacity_full'); recovery.append('Hold booking campaigns or use a verified wait-list CTA.')
    return _decision(reasons, recovery)


def submission_gate(*, paused=False, credentials_healthy=False, approved=False,
                    reconciliation_clear=False, daily_deliveries=0, monthly_deliveries=0,
                    requested_deliveries=1, daily_limit=2, monthly_limit=20,
                    cta='educational', capacity=None, now=None):
    result = capacity_gate(cta, capacity, now)
    reasons, recovery = result['reasons'], result['recovery']
    for blocked, reason, action in [
        (paused, 'paused', 'Resume publishing explicitly after reviewing pending packages.'),
        (not credentials_healthy, 'credentials_unhealthy', 'Connect or refresh supported publishing credentials.'),
        (not approved, 'approval_missing', 'Approve the exact immutable release package.'),
        (not reconciliation_clear, 'reconciliation_required', 'Reconcile uncertain provider submissions before retrying.')]:
        if blocked:
            reasons.append(reason); recovery.append(action)
    values = (daily_deliveries, monthly_deliveries, requested_deliveries, daily_limit, monthly_limit)
    if not all(isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in values) or requested_deliveries == 0 or daily_limit > 2 or monthly_limit > 31:
        reasons.append('invalid_limits'); recovery.append('Use nonnegative delivery counts and limits at most 2/day and 31/month.')
    else:
        for count, limit, code in [(daily_deliveries, daily_limit, 'daily_limit'), (monthly_deliveries, monthly_limit, 'monthly_limit')]:
            if count + requested_deliveries > limit:
                reasons.append(code); recovery.append('Wait for the next delivery window or reduce this batch.')
    return _decision(reasons, recovery)


def _window(pair):
    start, end = (instant(v) for v in pair)
    if start >= end:
        raise ValueError('Observation window must have a positive duration')
    return start, end


def window_rate(numerator, denominator, numerator_window, denominator_window):
    """Use for spend/conversions, engagement/reach or another matched-window rate."""
    if _window(numerator_window) != _window(denominator_window):
        raise ValueError('Numerator and denominator observation windows must match exactly')
    if numerator is None or denominator is None:
        return None
    if not _number(numerator) or not _number(denominator):
        raise ValueError('Metrics must be finite nonnegative numbers or unknown')
    return numerator / denominator if denominator else None


def summarize_results(records, now=None):
    """Validate per-post observations; do not pool different windows or infer conversions."""
    current = instant(now or datetime.now(timezone.utc))
    posts, seen = [], set()
    for row in records:
        if not row.get('provider_post_id') or not row.get('artifact_id'):
            raise ValueError('Results require provider_post_id and artifact_id')
        window = _window((row.get('window_start'), row.get('window_end')))
        if window[1] > current:
            raise ValueError('Observation window must be closed before importing results')
        key = (row.get('provider'), row.get('network'), row.get('account'), row['provider_post_id'], window)
        if key in seen:
            raise ValueError('Duplicate post observation window')
        seen.add(key)
        metrics = dict(row.get('metrics') or {})
        for metric, value in metrics.items():
            if value is not None and not _number(value):
                raise ValueError('Metrics must be finite nonnegative numbers or unknown')
            specific = row.get('metric_windows', {}).get(metric)
            if specific and _window((specific.get('start'), specific.get('end'))) != window:
                raise ValueError('Metric observation windows must match the post window exactly')
        metrics.setdefault('conversions', None)
        attributed = row.get('utm_content') == row['artifact_id']
        if not attributed:
            metrics['conversions'] = None
        posts.append({'provider_post_id': row['provider_post_id'], 'artifact_id': row['artifact_id'],
                      'window_start': window[0].isoformat(), 'window_end': window[1].isoformat(),
                      'provider': row.get('provider'), 'network': row.get('network'), 'account': row.get('account'),
                      'metrics': metrics, 'conversion_attribution': 'artifact_utm' if attributed else 'unknown',
                      'gaps': [] if attributed else ['Per-post conversions unknown; generic bio traffic is unattributed.']})
    return {'posts': posts, 'winner': None, 'note': 'Observations are descriptive; these records do not establish a winner.'}


def next_experiment(records):
    observations = summarize_results(records)
    return {'status': 'proposal', 'winner': None, 'observed_posts': len(observations['posts']),
            'hypothesis': 'A clearer opening question may increase engagement.',
            'change': 'Vary only the opening question across two approved educational posts.',
            'measurement': 'Compare the same seven-day observation window after publication using provider post IDs; keep missing values unknown.',
            'conversion_measurement': 'Use artifact-specific UTM content for website attribution; generic bio traffic remains unattributed.',
            'decision': 'Collect comparable observations before proposing another test; do not declare a winner from sparse results.'}
