"""Publish only exact-approved frozen MP4 bytes into a dedicated public directory.

The web server must serve this directory only, with directory listings disabled.
No source, manifest, queue or credential files are copied into it. A provider's
published receipt and its timezone-aware published_at start the retention clock.
"""
from contextlib import contextmanager
from datetime import datetime, timedelta
import hashlib
import os
from pathlib import Path
import re
import stat
import tempfile
from urllib.parse import unquote, urlsplit

import engine
import creative_verification


_HASH = re.compile(r'[0-9a-f]{64}')
_PUBLIC_FILE = re.compile(r'[0-9a-f]{64}\.mp4')


def _base_url(value):
    if not isinstance(value, str) or any(c.isspace() or ord(c) < 32 for c in value):
        raise ValueError('A clean public HTTPS base URL is required')
    parsed = urlsplit(value)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username is not None
            or parsed.password is not None or parsed.query or parsed.fragment
            or '?' in value or '#' in value or '\\' in value or '%' in parsed.netloc):
        raise ValueError('Public media requires HTTPS without credentials, query or fragment')
    # Deliberately accept only unescaped path segments; this rules out encoded
    # separators, double decoding and traversal in downstream proxy routing.
    if '%' in parsed.path or '\\' in parsed.path or any(p in ('.', '..') for p in unquote(parsed.path).split('/')):
        raise ValueError('Unsafe public media path')
    try:
        parsed.port
    except ValueError as exc:
        raise ValueError('Invalid public HTTPS port') from exc
    return value.rstrip('/')


@contextmanager
def _directory(root, bundle=None, create=False):
    root = engine.physical_path(root)
    if bundle is not None:
        bundle = engine.physical_path(bundle)
        if root == bundle or root in bundle.parents or bundle in root.parents:
            raise ValueError('Public outbox must be separate from private artifacts')
    if create:
        root.mkdir(parents=True, exist_ok=True, mode=0o755)
    if not root.exists():
        yield None
        return
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        # Refuse accidental use of a private runtime directory as the public root.
        for name in os.listdir(fd):
            info = os.stat(name, dir_fd=fd, follow_symlinks=False)
            if not _PUBLIC_FILE.fullmatch(name) or not stat.S_ISREG(info.st_mode):
                raise ValueError('Public outbox contains an unexpected file')
        if create:
            os.fchmod(fd, 0o755)
        yield (root, fd)
    finally:
        os.close(fd)


def _read_file(path, *, dir_fd=None):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=dir_fd)
    with os.fdopen(fd, 'rb') as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError('Media must be a regular file')
        return stream.read()


def _media_sha(job):
    sha = job['package'].get('media_sha256')
    if not isinstance(sha, str) or not _HASH.fullmatch(sha):
        raise ValueError('Invalid frozen media SHA256')
    return sha


def public_url(job, base_url):
    return _base_url(base_url) + '/' + _media_sha(job) + '.mp4'


def stage(queue, key, media_root, public_base_url):
    """Return a stable HTTPS URL after atomically staging exact-approved bytes.

    Existing bytes are checked, never replaced. Temporary files live outside the
    served directory. SQLite serializes staging against approval revocation.
    """
    with queue.transaction():
        job = queue.validate(key)
        if job['status'] != 'approved' or job['approval_sha'] != key:
            raise ValueError('Staging requires a current exact approval')
        url = public_url(job, public_base_url)
        creative_verification.require(job['package'])
        package = job['package']
        sha = _media_sha(job)
        bundle = engine.physical_path(package['bundle'])
        for name in ('manifest.json', 'asset.mp4'):
            engine.physical_path(bundle / name)
        manifest = engine.verify(bundle)
        qa = package.get('qa') or {}
        if (qa.get('technical_pass') is not True or qa.get('artifact_id') != job['artifact']
                or qa.get('media_sha256') != sha or type(qa.get('listening_required')) is not bool):
            raise ValueError('Exact frozen technical QA required')
        audio = manifest['payload']['job'].get('constraints', {}).get('audio', 'silent')
        if (audio != 'silent' and qa['listening_required'] is not True) or (qa['listening_required'] and not job['listened']):
            raise ValueError('Frozen audio requires human listening approval')
        data = _read_file(bundle / 'asset.mp4')
        if hashlib.sha256(data).hexdigest() != sha or len(data) != manifest['payload']['media']['bytes']:
            raise ValueError('Frozen media changed during staging')
        filename = sha + '.mp4'
        with _directory(media_root, bundle, create=True) as (root, directory):
            if filename in os.listdir(directory):
                if _read_file(filename, dir_fd=directory) != data:
                    raise ValueError('Existing public media does not match approved bytes')
                os.chmod(filename, 0o644, dir_fd=directory, follow_symlinks=False)
            else:
                fd, temporary = tempfile.mkstemp(prefix='.approved-media-', dir=root.parent)
                try:
                    with os.fdopen(fd, 'wb') as stream:
                        stream.write(data)
                        stream.flush()
                        os.fchmod(stream.fileno(), 0o644)
                        os.fsync(stream.fileno())
                    # link is atomic and fails if a concurrent writer created it.
                    try:
                        os.link(temporary, filename, dst_dir_fd=directory, follow_symlinks=False)
                    except FileExistsError:
                        pass
                    if _read_file(filename, dir_fd=directory) != data:
                        raise ValueError('Public media conflicts with approved bytes')
                    os.fsync(directory)
                finally:
                    os.unlink(temporary)
        return url


def _retained_publication(job, now, retention):
    import machine
    receipt = job.get('receipt')
    if (job.get('status') != 'published' or job.get('approval_sha') != job['id']
            or machine.digest(job['package']) != job['id'] or not isinstance(receipt, dict)
            or receipt.get('status') != 'published' or not receipt.get('provider') or not receipt.get('id')):
        return False
    if any(receipt.get(k) != v for k, v in {'package_sha256': job['id'], 'network': job['network'], 'account': job['account']}.items()):
        return False
    try:
        published = datetime.fromisoformat(receipt['published_at'])
        return published.tzinfo is not None and published + retention <= now
    except (KeyError, TypeError, ValueError, OverflowError):
        return False


def cleanup(queue, key, media_root, now, retention_days=7):
    """Remove shared media only after every related release has aged publication.

    Missing/uncertain receipts, pending Facebook releases and malformed dates all
    retain bytes. Returns whether an existing public file was removed.
    """
    if not isinstance(now, datetime) or now.tzinfo is None:
        raise ValueError('Cleanup time must include a timezone')
    if isinstance(retention_days, bool) or not isinstance(retention_days, (int, float)) or retention_days < 0:
        raise ValueError('Retention must be a nonnegative number of days')
    try:
        retention = timedelta(days=retention_days)
    except (ValueError, OverflowError) as exc:
        raise ValueError('Invalid retention') from exc
    with queue.transaction():
        job = queue.get(key)
        sha = _media_sha(job)
        related = [row for row in queue.rows() if row['artifact'] == job['artifact'] or row['package'].get('media_sha256') == sha]
        if not all(_retained_publication(row, now, retention) for row in related):
            return False
        with _directory(media_root, job['package']['bundle']) as opened:
            if opened is None:
                return False
            _, directory = opened
            filename = sha + '.mp4'
            try:
                data = _read_file(filename, dir_fd=directory)
            except FileNotFoundError:
                return False
            if hashlib.sha256(data).hexdigest() != sha:
                raise ValueError('Refusing cleanup of unexpected public bytes')
            os.unlink(filename, dir_fd=directory)
            os.fsync(directory)
            return True
