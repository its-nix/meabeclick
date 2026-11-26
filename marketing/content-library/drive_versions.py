"""Stable-ID binary revisions using GoogleSync's authenticated, durable transport."""
import fcntl
import hashlib
import json
from urllib.parse import urlencode

import engine
from google_sync import MAX_UPLOAD, UncertainWrite, _atomic, _id

BASE = 'https://www.googleapis.com/drive/v3/files/'
REVISION_FIELDS = 'id,mimeType,md5Checksum,size,keepForever,modifiedTime'
FILE_FIELDS = 'id,mimeType,md5Checksum,size,headRevisionId,version,webViewLink'


def _file(client, file_id):
    value = client._request('GET', BASE + _id(file_id) + '?' + urlencode({'fields': FILE_FIELDS}))
    if (value.get('id') != file_id or not value.get('headRevisionId') or
            not value.get('md5Checksum') or not value.get('version') or
            value.get('mimeType', '').startswith('application/vnd.google-apps.')):
        raise ValueError('Expected exact binary file with revision/checksum metadata')
    _id(value['headRevisionId'])
    return value


def list_revisions(client, file_id):
    """List bounded, paginated binary revision metadata without downloading media."""
    url = BASE + _id(file_id) + '/revisions'
    result, token, seen = [], None, set()
    for _ in range(100):
        query = {'pageSize': 1000, 'fields': 'nextPageToken,revisions(' + REVISION_FIELDS + ')'}
        if token:
            query['pageToken'] = token
        page = client._request('GET', url + '?' + urlencode(query))
        for revision in page.get('revisions', []):
            identity = _id(revision.get('id'))
            if identity in seen:
                raise ValueError('Duplicate revision metadata; reconcile provider history')
            seen.add(identity)
            result.append(revision)
        token = page.get('nextPageToken')
        if not token:
            return result
    raise ValueError('Revision history exceeds bounded pagination')


def _revision(client, file_id, revision_id):
    value = client._request('GET', BASE + _id(file_id) + '/revisions/' + _id(revision_id) +
                            '?' + urlencode({'fields': REVISION_FIELDS}))
    if value.get('id') != revision_id:
        raise ValueError('Revision identity mismatch')
    return value


def _same_head(left, right):
    return all(left.get(k) == right.get(k) for k in
               ('id', 'headRevisionId', 'md5Checksum', 'size', 'mimeType'))


def _upload(client, path, file_id, state_dir, *, expected_md5, work_item_status, restore_revision=None):
    """Pin old/new binary revisions and return an exact new-head receipt.

    Caller owns work-item authorization and frozen source storage. Only an explicit
    draft status may mutate a head. No automatic retries follow an uncertain write.
    """
    if work_item_status != 'draft':
        raise ValueError('Only a draft work item may update Drive media')
    _id(file_id)
    path = engine.physical_path(path)
    if not path.is_file() or not 0 < path.stat().st_size <= MAX_UPLOAD:
        raise ValueError('Binary upload requires 1 byte..5MiB; larger media needs resumable transport')
    content = path.read_bytes()
    if not 0 < len(content) <= MAX_UPLOAD:
        raise ValueError('Binary upload size changed')
    checksum = hashlib.md5(content).hexdigest()
    sha = hashlib.sha256(content).hexdigest()
    state = engine.physical_path(state_dir)
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (state / ('drive-version-' + file_id + '.lock')).open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        for record in state.glob('*.json'):
            saved = json.loads(record.read_text())
            if saved.get('status') == 'uncertain' and saved.get('intent', {}).get('file') == file_id:
                raise UncertainWrite('Prior Drive revision write uncertain; reconcile before any new head update')
        if restore_revision is not None:
            target = _revision(client, file_id, restore_revision)
            if (target.get('keepForever') is not True or target.get('md5Checksum') != checksum or
                    str(target.get('size')) != str(len(content))):
                raise ValueError('Restore requires exact frozen bytes of a pinned revision')
        before = _file(client, file_id)
        if before['md5Checksum'] != expected_md5:
            raise ValueError('Drive head checksum changed; refresh and reconcile before upload')
        revisions = list_revisions(client, file_id)
        if not any(r['id'] == before['headRevisionId'] for r in revisions):
            raise ValueError('Head missing from revision listing; cannot safely count retention')
        old = _revision(client, file_id, before['headRevisionId'])
        if old.get('md5Checksum') != expected_md5 or str(old.get('size')) != str(before.get('size')):
            raise ValueError('Head revision metadata mismatch')
        required = 1 + (old.get('keepForever') is not True)
        if sum(r.get('keepForever') is True for r in revisions) + required > 200:
            raise ValueError('Pinned revision capacity reached; preserve history and start a new owner-reviewed work item')
        if not old.get('keepForever'):
            url = BASE + file_id + '/revisions/' + old['id']
            def pin():
                return client._request('PATCH', url + '?' + urlencode({'fields': REVISION_FIELDS}),
                                       b'{"keepForever":true}')
            def verify_pin(receipt):
                if _revision(client, file_id, old['id']).get('keepForever') is not True:
                    raise ValueError('Previous revision was not retained')
            client._write(state, {'operation': 'drive-pin', 'file': file_id, 'revision': old['id']}, pin, verify_pin)
            verify_pin(None)
            after_pin = _file(client, file_id)
            if any(before.get(k) != after_pin.get(k) for k in
                   ('id', 'headRevisionId', 'md5Checksum', 'size', 'mimeType')):
                raise ValueError('Drive head changed while retaining prior revision')
            # Keep fresh provider metadata for the durable intent after pinning.
            before = after_pin
        url = 'https://www.googleapis.com/upload/drive/v3/files/' + file_id + '?' + urlencode({
            'uploadType': 'media', 'keepRevisionForever': 'true', 'fields': FILE_FIELDS})
        def submit():
            observed = _file(client, file_id)
            if not _same_head(before, observed):
                # Preserve proof that this guard rejected before any media PATCH.
                key = hashlib.sha256(engine.canonical({'before': before, 'sha256': sha})).hexdigest()
                _atomic(state / ('drive-preflight-' + key + '.json'), {
                    'status': 'rejected_before_media_request',
                    'intent': {'operation': 'drive-version-preflight', 'file': file_id},
                    'before': before, 'observed': observed, 'sha256': sha})
                raise ValueError('Drive binary head changed before upload')
            return client._request('PATCH', url, content, before['mimeType'])
        def verify(receipt):
            after = _file(client, file_id)
            if (receipt.get('id') != file_id or receipt.get('headRevisionId') != after['headRevisionId'] or
                    receipt.get('md5Checksum') != checksum or str(receipt.get('size')) != str(len(content)) or
                    after['headRevisionId'] == before['headRevisionId'] or
                    after['md5Checksum'] != checksum or str(after.get('size')) != str(len(content))):
                raise ValueError('Drive new-head readback mismatch')
            revision = _revision(client, file_id, after['headRevisionId'])
            if (revision.get('keepForever') is not True or revision.get('md5Checksum') != checksum or
                    str(revision.get('size')) != str(len(content))):
                raise ValueError('New revision checksum or retention mismatch')
        receipt = client._write(state, {'operation': 'drive-version', 'file': file_id,
                                      'before': before, 'sha256': sha}, submit, verify)
        verify(receipt)
        return {**receipt, 'revision_id': receipt['headRevisionId'], 'sha256': sha, 'status': 'updated'}


def versioned_upload(client, path, file_id, state_dir, *, expected_md5, work_item_status='draft'):
    """Replace a draft binary head on its stable file ID, preserving both revisions."""
    return _upload(client, path, file_id, state_dir, expected_md5=expected_md5,
                   work_item_status=work_item_status)


def restore(client, path, file_id, revision_id, state_dir, *, expected_md5, work_item_status='draft'):
    """Promote verified local bytes matching a pinned revision into a new head.

    No remote media download, deletion, unpinning, or old revision mutation occurs.
    Approval revocation/new verification belongs to the caller's draft transition.
    """
    _id(revision_id)
    receipt = _upload(client, path, file_id, state_dir, expected_md5=expected_md5,
                      work_item_status=work_item_status, restore_revision=revision_id)
    return {**receipt, 'restored_from': revision_id}


def _pin_head(client, file_id, state_dir, *, expected_md5):
    """Retain and verify an initial binary head without replacing its bytes."""
    before = _file(client, file_id)
    if before['md5Checksum'] != expected_md5:
        raise ValueError('Initial Drive head checksum mismatch')
    old = _revision(client, file_id, before['headRevisionId'])
    if old.get('md5Checksum') != expected_md5 or str(old.get('size')) != str(before.get('size')):
        raise ValueError('Initial Drive revision metadata mismatch')
    if old.get('keepForever') is not True:
        revisions = list_revisions(client, file_id)
        if sum(r.get('keepForever') is True for r in revisions) >= 200:
            raise ValueError('Pinned revision capacity reached')
        url = BASE + _id(file_id) + '/revisions/' + _id(old['id'])
        def submit():
            if not _same_head(before, _file(client, file_id)):
                raise ValueError('Drive head changed before pin')
            return client._request('PATCH', url + '?' + urlencode({'fields': REVISION_FIELDS}),
                                   b'{"keepForever":true}')
        def verify(receipt):
            after = _file(client, file_id)
            revision = _revision(client, file_id, old['id'])
            if (after['headRevisionId'] != old['id'] or after['md5Checksum'] != expected_md5 or
                    revision.get('keepForever') is not True):
                raise ValueError('Initial Drive pin readback mismatch')
        client._write(state_dir, {'operation': 'drive-pin', 'file': file_id, 'revision': old['id']}, submit, verify)
        verify(None)
    return {**before, 'revision_id': old['id']}


def pin_head(client, file_id, state_dir, *, expected_md5):
    """Retain the exact initial head, respecting per-file locks and uncertainty."""
    _id(file_id)
    state = engine.physical_path(state_dir)
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (state / ('drive-version-' + file_id + '.lock')).open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        for record in state.glob('*.json'):
            saved = json.loads(record.read_text())
            if saved.get('status') == 'uncertain' and saved.get('intent', {}).get('file') == file_id:
                raise UncertainWrite('Prior Drive write uncertain; reconcile before pinning head')
        return _pin_head(client, file_id, state, expected_md5=expected_md5)
