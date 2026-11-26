"""Bounded Instagram/Facebook Page scheduling; uncertain writes never retry."""
from datetime import datetime, timezone
import hashlib
import json
import re
from urllib.request import Request, build_opener

from buffer_mcp import BufferMCP, BufferError, _NoRedirect, result_data
import media_outbox

_ID = re.compile(r'[a-f0-9]{24}')
MAX_MEDIA = 100 * 1024 * 1024


def public_bytes(url):
    """Fetch the exact HTTPS asset without following redirects or sending keys."""
    with build_opener(_NoRedirect()).open(Request(url), timeout=30) as response:
        if response.status != 200:
            raise BufferError('Public media is unavailable')
        data = response.read(MAX_MEDIA + 1)
        if len(data) > MAX_MEDIA:
            raise BufferError('Public media exceeds verification limit')
        return data


def _client(cfg, client):
    if cfg.get('provider') != 'buffer-mcp' or any(not isinstance(cfg.get(k), str) or not _ID.fullmatch(cfg[k]) for k in ('organization_id', 'channel_id')):
        raise BufferError('A configured Buffer organization and channel are required')
    return client if client is not None else BufferMCP(cfg['key_path'])


def _network(cfg):
    network = cfg.get('network', 'instagram')
    if network not in ('instagram', 'facebook'):
        raise BufferError('Unsupported configured Buffer network')
    return network


def discover_publishers(configs, *, client=None):
    """Discover supported connected destinations in the already authorized org."""
    if not configs or len({(c.get('organization_id'),c.get('key_path'),c.get('public_base_url'),c.get('media_root')) for c in configs}) != 1:
        raise BufferError('Channel discovery requires one existing organization and media configuration')
    base=configs[0];client=_client(base,client)
    channels=result_data(client.channels(base['organization_id']))
    if not isinstance(channels,list):raise BufferError('Invalid connected channel list')
    found=[]
    for channel in channels:
        if not isinstance(channel,dict):raise BufferError('Malformed connected channel')
        network=channel.get('service')
        supported=(network=='instagram' and channel.get('type') in ('business','creator')) or (network=='facebook' and channel.get('type')=='page')
        if supported and channel.get('isDisconnected') is False and channel.get('isLocked') is False:
            found.append({**base,'network':network,'channel_id':channel['id']})
    if not 1<=len(found)<=20 or len({(p['network'],p['channel_id']) for p in found})!=len(found):raise BufferError('Connected publishing destinations absent, excessive or duplicated')
    return sorted(found,key=lambda p:(p['network'],p['channel_id']))


def verify_connection(cfg, *, client=None):
    """Read-only identity check against the configured organization's channels."""
    network = _network(cfg)
    client = _client(cfg, client)
    channels = result_data(client.channels(cfg['organization_id']))
    matches = [c for c in channels if isinstance(c, dict) and c.get('id') == cfg['channel_id']] if isinstance(channels, list) else []
    if len(matches) != 1:
        raise BufferError('Configured channel is absent or ambiguous in organization')
    detail = result_data(client.call('get_channel', {'channelId': cfg['channel_id']}))
    for channel in (matches[0], detail):
        if (not isinstance(channel, dict) or channel.get('id') != cfg['channel_id']
                or channel.get('service') != network
                or channel.get('type') not in (('business', 'creator') if network == 'instagram' else ('page',))
                or channel.get('isDisconnected') is not False or channel.get('isLocked') is not False):
            raise BufferError('Configured Buffer identity or automatic publishing is unverified')
    if detail.get('organizationId') != cfg['organization_id'] or detail.get('isQueuePaused') is not False:
        raise BufferError('Buffer organization or automatic queue settings are unverified')
    # Facebook Pages have null metadata in official MCP; reminders are an
    # Instagram-specific setting. Profiles/groups cannot pass the Page check.
    if network == 'instagram' and (not isinstance(detail.get('metadata'), dict)
                                  or detail['metadata'].get('defaultToReminders') is not False):
        raise BufferError('Instagram automatic queue settings are unverified')
    return detail


def _instant(value):
    try:
        instant = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if instant.tzinfo is None:
            raise ValueError()
        return instant.astimezone(timezone.utc)
    except (ValueError, TypeError, AttributeError):
        raise BufferError('Invalid Buffer scheduled time') from None


def _video_matches(assets, url):
    if not isinstance(assets, list) or len(assets) != 1 or not isinstance(assets[0], dict):
        return False
    asset = assets[0]
    if any(k in asset for k in ('image', 'document')) or not isinstance(asset.get('video'), dict):
        return False
    video = asset['video']
    sources = [video[k] for k in ('url', 'source') if k in video]
    if 'source' in asset:
        if asset.get('__typename') != 'VideoAsset' or asset.get('type') != 'video' or asset.get('mimeType') != 'video/mp4':
            return False
        sources.append(asset['source'])
    return bool(sources) and all(source == url for source in sources)


def _metadata_matches(metadata, network, expected):
    if not isinstance(metadata, dict):return False
    if network in metadata:return metadata[network] == expected
    # Buffer returns a typed, flat output object rather than its input wrapper.
    typename={'facebook':'FacebookPostMetadata','instagram':'InstagramPostMetadata'}[network]
    return metadata.get('__typename') == typename and all(metadata.get(k) == v for k,v in expected.items())


def _receipt(result, package, key, payload, *, allow_terminal=False):
    data = result_data(result)
    # An unrecognized response stays uncertain; never synthesize a post record.
    if isinstance(data, dict) and set(data) == {'post'}:
        data = data['post']
    status = data.get('status') if isinstance(data, dict) else None
    allowed = ('scheduled', 'sent', 'error') if allow_terminal else ('scheduled',)
    if (not isinstance(data, dict) or not isinstance(data.get('id'), str) or not _ID.fullmatch(data['id'])
            or status not in allowed or data.get('channelId') != payload['channelId']
            or data.get('text') != payload['text'] or _instant(data.get('dueAt')) != _instant(payload['dueAt'])
            or not _video_matches(data.get('assets'), payload['assets'][0]['video']['url'])
            or (status != 'error' and data.get('error') is not None)
            or data.get('channelService',package['network']) != package['network']
            or not _metadata_matches(data.get('metadata'),package['network'],payload['metadata'][package['network']])):
        raise BufferError('Saved Buffer post does not verify exact approved package')
    receipt = {'provider': 'buffer', 'id': data['id'], 'status': status, 'package_sha256': key,
            'network': package['network'], 'account': package['account'], 'scheduled_at': package['scheduled_at']}
    if status == 'sent':
        receipt.update(status='published', sent_at=_instant(data.get('sentAt')).isoformat())
    elif status == 'error':
        receipt['status'] = 'failed'
    return receipt


def _payload(package, url):
    network = package['network']
    return {'channelId': package['account'], 'schedulingType': 'automatic', 'mode': 'customScheduled',
            'text': package['caption'], 'dueAt': package['scheduled_at'], 'assets': [{'video': {'url': url}}],
            'metadata': {network: ({'type': 'reel', 'shouldShareToFeed': True}
                                   if network == 'instagram' else {'type': 'reel'})}}


def reconcile_saved_post(queue, key, cfg, *, client=None):
    """Recover a known create response by reading the same Buffer post."""
    job = queue.validate(key)
    if job['status'] != 'uncertain' or job['approval_sha'] != key:
        raise BufferError('A submitted exact approval is required for reconciliation')
    if (job['account'], job['network']) != (cfg['channel_id'], _network(cfg)):
        raise BufferError('Reconciliation destination mismatch')
    event = queue.db.execute(
        "SELECT detail FROM events WHERE job=? AND action='buffer_response' ORDER BY id DESC LIMIT 1",
        (key,),
    ).fetchone()
    if event is None:
        raise BufferError('No saved create response to reconcile')
    package = job['package']
    payload = _payload(package, media_outbox.public_url(job, cfg['public_base_url']))
    created = _receipt(json.loads(event[0]), package, key, payload)
    live = _client(cfg, client).get_post(created['id'])
    receipt = _receipt(live, package, key, payload, allow_terminal=True)
    if receipt['id'] != created['id']:
        raise BufferError('Buffer readback returned a different post')
    receipt['readback_verified'] = True
    queue.receipt(key, receipt)
    return receipt


def verify_delivery(queue, key, cfg, *, client=None):
    """Read the outcome of an already scheduled post and retain its identity."""
    job = queue.validate(key)
    receipt = job['receipt']
    if job['status'] != 'scheduled' or not receipt or receipt.get('provider') != 'buffer':
        raise BufferError('A scheduled Buffer release is required')
    if (job['account'], job['network']) != (cfg['channel_id'], _network(cfg)):
        raise BufferError('Delivery lookup destination mismatch')
    result = result_data(_client(cfg, client).get_post(receipt['id']))
    if isinstance(result, dict) and set(result) == {'post'}:
        result = result['post']
    package = job['package']
    if (not isinstance(result, dict) or result.get('id') != receipt['id']
            or result.get('channelId') != job['account'] or result.get('text') != package['caption']
            or _instant(result.get('dueAt')) != _instant(package['scheduled_at'])):
        raise BufferError('Delivery record does not match the approved Buffer post')
    status = result.get('status')
    if status in ('scheduled', 'sending'):
        return None
    if status == 'sent' and result.get('error') is None:
        verified = {**receipt, 'status': 'published', 'sent_at': _instant(result.get('sentAt')).isoformat()}
    elif status == 'error':
        verified = {**receipt, 'status': 'failed'}
    else:
        raise BufferError('Buffer returned an unexpected delivery status')
    queue.receipt(key, verified)
    return verified


def schedule(queue, key, cfg, *, client=None, public_fetch=None):
    """Stage/verify an approved release, persist intent, then issue one create.

    Returns a verified Queue receipt. Any exception after begin_submission leaves
    the job uncertain and requires read-only/manual reconciliation, never retry.
    """
    job = queue.validate(key)
    package = job['package']
    if job['status'] != 'approved' or job['approval_sha'] != key:
        raise ValueError('A current exact approval is required; submitted jobs cannot retry')
    # Reject policy holds before any provider call or public exposure. The
    # durable begin_submission below repeats these checks inside its transaction.
    package = queue.submission_package(key)
    network = _network(cfg)
    client = _client(cfg, client)
    if package['network'] != network or package['account'] != cfg['channel_id']:
        raise BufferError('Approved destination differs from configured Buffer channel')
    if _instant(package['scheduled_at']) <= datetime.now(timezone.utc):
        raise BufferError('Approved schedule has passed')
    verify_connection(cfg, client=client)
    url = media_outbox.stage(queue, key, cfg['media_root'], cfg['public_base_url'])
    try:
        data = (public_fetch or public_bytes)(url)
        if not isinstance(data, bytes) or hashlib.sha256(data).hexdigest() != package['media_sha256']:
            raise BufferError('Public asset differs from exact approved bytes')
    except Exception:
        raise BufferError('Public asset verification failed') from None
    payload = _payload(package, url)
    client.validate_create(payload)
    queue.begin_submission(key)
    try:
        result = client._write('create_post', payload)
        # Private durable evidence is preserved even when normalization fails.
        with queue.transaction():
            queue.event(key, 'buffer_response', json.dumps(result, ensure_ascii=False))
        created = _receipt(result, package, key, payload)
        live = client.get_post(created['id'])
        receipt = _receipt(live, package, key, payload)
        if receipt['id'] != created['id']:
            raise BufferError('Buffer readback returned a different post')
        receipt['readback_verified'] = True
        queue.receipt(key, receipt)
        return receipt
    except Exception as exc:
        raise BufferError('Buffer submission uncertain; reconcile before any further write',
                          status=getattr(exc, 'status', None), retry_after=getattr(exc, 'retry_after', None)) from None
