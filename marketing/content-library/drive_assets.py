"""Private, durable one-file-per-work-item preview registry. No external cleanup."""
from contextlib import contextmanager
from datetime import datetime
import fcntl
import hashlib
import json
import os
from urllib.parse import urlencode, urlsplit
from zoneinfo import ZoneInfo

import creative_verification
import drive_versions
import engine
from google_sync import MAX_UPLOAD, UncertainWrite, _atomic, _id

SHORT_NAMES = {'P002': 'Rectangles', 'P003': 'Add18', 'P004': 'Mathhelp'}
PROTECTED = {'approved', 'submitted', 'scheduled', 'published', 'uncertain', 'submitting'}
FOLDERS = 'application/vnd.google-apps.folder'


@contextmanager
def _registry(state_dir):
    state = engine.physical_path(state_dir)
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (state / 'drive-assets.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        path = state / 'drive-assets.json'
        registry = json.loads(path.read_text()) if path.exists() else {}
        yield state, path, registry


def _guard(queue, file_id, sha, work_item):
    if queue is None:
        return
    for row in queue.rows():
        package = row.get('package', {})
        receipt = package.get('drive_receipt') or {}
        preview = urlsplit(package.get('preview_url', ''))
        refs = {package.get('drive_file_id'), receipt.get('file_id'), receipt.get('id')}
        if preview.netloc == 'drive.google.com':
            pieces = preview.path.split('/')
            if len(pieces) >= 4 and pieces[1:3] == ['file', 'd']:
                refs.add(pieces[3])
        same_work = work_item in (package.get('work_item'), package.get('drive_work_item'))
        if (file_id is None or file_id not in refs) and not same_work:
            continue
        status = row.get('status')
        if status in PROTECTED or (status == 'review' and package.get('media_sha256') != sha):
            raise ValueError('Drive media is referenced by active review/publication; withdraw explicitly before update')


def _folder(client, parent, name, state):
    _id(parent)
    body = {'name': name, 'mimeType': FOLDERS, 'parents': [parent]}
    def verify(receipt):
        identity = _id(receipt.get('id'))
        found = client._request('GET', drive_versions.BASE + identity + '?' + urlencode({
            'fields': 'id,name,mimeType,parents,trashed'}))
        if (found.get('id') != identity or found.get('name') != name or found.get('mimeType') != FOLDERS or
                found.get('parents') != [parent] or found.get('trashed')):
            raise ValueError('Drive folder identity/parent readback mismatch')
    receipt = client._write(state, {'operation': 'drive-asset-folder', 'parent': parent, 'name': name},
                            lambda: client._request('POST', drive_versions.BASE[:-1] + '?fields=id',
                                                    json.dumps(body).encode()), verify)
    verify(receipt)
    return receipt['id']


def _receipt(record):
    current = record['current']
    return {**current, 'work_item': record['work_item'], 'folder_id': record['folder_id'],
            'file_id': record['file_id'], 'webViewLink': current.get('webViewLink') or
            'https://drive.google.com/file/d/' + record['file_id'] + '/view'}


def _check_head(client, record):
    current = record['current']
    found = drive_versions._file(client, record['file_id'])
    revision = drive_versions._revision(client, record['file_id'], current['revision_id'])
    if (found['headRevisionId'] != current['revision_id'] or
            found['md5Checksum'] != current['md5Checksum'] or
            str(found.get('size')) != str(current['size']) or
            (current.get('sha256') is not None and revision.get('keepForever') is not True) or
            revision.get('md5Checksum') != current['md5Checksum'] or
            str(revision.get('size')) != str(current['size'])):
        raise ValueError('Registered Drive head changed; reconcile exact revision before proceeding')


def store(client, item, cfg, state_dir, queue=None):
    """Publish only a verified candidate preview; reuse its work item's stable ID."""
    if item.get('verification_status') != 'ready_for_human':
        raise ValueError('Only verified ready-for-human candidates may update Drive previews')
    creative_verification.require(item)
    bundle = engine.physical_path(item['bundle'])
    manifest = engine.verify(bundle)
    if item.get('artifact_id') != manifest['artifact_id']:
        raise ValueError('Asset artifact identity mismatch')
    slot = datetime.fromisoformat(item['scheduled_at'])
    if slot.tzinfo is None:
        raise ValueError('Asset slot requires timezone')
    post_id = manifest['payload']['job']['post']['id']
    _id(post_id)
    work = post_id + '@' + item['scheduled_at']
    media = bundle / 'asset.mp4'
    content = media.read_bytes()
    if not 0 < len(content) <= MAX_UPLOAD:
        raise ValueError('Asset upload requires 1 byte..5MiB')
    sha = hashlib.sha256(content).hexdigest()
    checksum = hashlib.md5(content).hexdigest()
    if sha != manifest['payload']['media']['sha256']:
        raise ValueError('Frozen media changed before Drive upload')
    with _registry(state_dir) as (state, path, registry):
        record = registry.get(work)
        configured = cfg.get('drive_work_items', {}).get(work)
        if record is None:
            record = {'work_item': work, 'status': 'creating', 'creating_sha256': sha,
                      'history': [], 'short_name': SHORT_NAMES.get(post_id, post_id)}
            if configured:
                _id(configured['file_id']); _id(configured['folder_id'])
                record.update(file_id=configured['file_id'], folder_id=configured['folder_id'],
                              short_name=configured.get('short_name', record['short_name']), status='draft',
                              current={'revision_id': configured['revision_id'],
                                       'md5Checksum': configured['expected_md5'], 'sha256': None})
                found = drive_versions._file(client, record['file_id'])
                if (found['headRevisionId'] != record['current']['revision_id'] or
                        found['md5Checksum'] != record['current']['md5Checksum']):
                    raise ValueError('Configured Drive work item head changed')
                record['current']['size'] = found['size']
            registry[work] = record
            _atomic(path, registry)
        if record['status'] in PROTECTED or record['status'] == 'updating':
            raise UncertainWrite('Asset work item is protected or update requires reconciliation')
        if record['status'] == 'creating':
            _guard(queue, record.get('file_id'), sha, work)
            if record['creating_sha256'] != sha:
                raise UncertainWrite('Prior asset creation binds different bytes; reconcile before retry')
            date = slot.astimezone(ZoneInfo('Asia/Jerusalem')).date().isoformat()
            if not record.get('folder_id'):
                date_folder = _folder(client, cfg['drive_posts_folder_id'], date, state / 'asset-intents')
                record['folder_id'] = _folder(client, date_folder, record['short_name'], state / 'asset-intents')
                _atomic(path, registry)
            cache = state / 'asset-cache' / sha
            cache.mkdir(parents=True, exist_ok=True, mode=0o700)
            upload = cache / 'Video.mp4'
            if upload.exists() and hashlib.sha256(upload.read_bytes()).hexdigest() != sha:
                raise ValueError('Private asset cache changed')
            if not upload.exists():
                fd = os.open(upload, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, 'wb') as handle:
                    handle.write(content); handle.flush(); os.fsync(handle.fileno())
            receipt = client.upload(upload, record['folder_id'], state / 'asset-intents')
            record['file_id'] = _id(receipt['id'])
            _atomic(path, registry)
            pinned = drive_versions.pin_head(client, record['file_id'], state / 'asset-intents', expected_md5=checksum)
            receipt = {**receipt, **pinned}
        else:
            file_id = record['file_id']
            if record['current'].get('sha256') == sha:
                _check_head(client, record)
                record['current'].update(needs_verification=False, bundle=str(bundle), artifact_id=manifest['artifact_id'])
                _atomic(path, registry)
                return _receipt(record)
            _check_head(client, record)
            _guard(queue, file_id, sha, work)
            record['status'] = 'updating'
            record['pending_sha256'] = sha
            _atomic(path, registry)
            receipt = drive_versions.versioned_upload(client, media, file_id, state / 'asset-intents',
                expected_md5=record['current']['md5Checksum'], work_item_status='draft')
        current = {**receipt, 'sha256': sha, 'md5Checksum': checksum, 'size': str(len(content)),
                   'bundle': str(bundle), 'artifact_id': manifest['artifact_id'], 'needs_verification': False}
        record.update(current=current, status='draft')
        record.pop('pending_sha256', None)
        record['history'].append(dict(current))
        _atomic(path, registry)
        return _receipt(record)


def restore_previous(client, work_item, state_dir, queue=None):
    """Restore previous known frozen bytes as a new draft head, revoking readiness."""
    with _registry(state_dir) as (state, path, registry):
        record = registry[work_item]
        if record['status'] != 'draft' or len(record['history']) < 2:
            raise ValueError('Restore requires a draft with prior frozen history')
        _guard(queue, record['file_id'], None, work_item)
        _check_head(client, record)
        target = record['history'][-2]
        bundle = engine.physical_path(target['bundle'])
        manifest = engine.verify(bundle)
        if manifest['payload']['media']['sha256'] != target['sha256']:
            raise ValueError('Prior frozen artifact changed')
        record['status'] = 'updating'
        _atomic(path, registry)
        receipt = drive_versions.restore(client, bundle / 'asset.mp4', record['file_id'],
            target['revision_id'], state / 'asset-intents', expected_md5=record['current']['md5Checksum'])
        current = {**target, **receipt, 'needs_verification': True}
        record.update(current=current, status='draft')
        record['history'].append(dict(current))
        _atomic(path, registry)
        return _receipt(record)
