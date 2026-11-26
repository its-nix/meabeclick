"""Outbox checks use real frozen bundles and the durable Queue, without a network."""
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import tempfile
import unittest

import engine
import machine
from test_creative_fixtures import tiny_video, attest
import media_outbox


class OutboxTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        source = self.root / 'source'; source.mkdir()
        (source / 'index.html').write_text('private source')
        self.bytes = b'\x00\x00\x00\x18ftypmp42frozen fake MP4'
        media = self.root / 'render.mp4'; tiny_video(media); self.bytes=media.read_bytes()
        self.bundle = engine.freeze({'post': {'id': 'P002'}}, source, media, self.root / 'artifacts')
        self.sha = engine.sha(self.bundle / 'asset.mp4')
        self.q = machine.Queue(self.root / 'queue.sqlite3')
        self.outbox = self.root / 'public'
        self.base = 'https://media.example.test/approved'
        self.package = {'bundle': str(self.bundle), 'caption': 'approved', 'cta': 'educational', 'network': 'instagram', 'account': 'brand', 'scheduled_at': '2099-11-15T19:30:00+02:00', 'qa': {'technical_pass': True, 'artifact_id': self.bundle.name, 'media_sha256': self.sha, 'listening_required': False}}
        self.package['creative_verification']=attest(self.bundle,self.package['caption'],self.package['cta'])
        self.key = self.q.enqueue(self.package)
        self.now = datetime(2026, 11, 14, tzinfo=timezone.utc)

    def tearDown(self):
        self.q.close(); self.temp.cleanup()

    def stage(self, key=None):
        return media_outbox.stage(self.q, key or self.key, self.outbox, self.base)

    def approve(self):
        self.q.approve(self.key, 'owner')

    def publish(self, key=None, age=8, timestamp=True):
        key = key or self.key
        job = self.q.get(key)
        receipt = {'id': key, 'provider': 'buffer', 'status': 'published', 'package_sha256': key, 'network': job['network'], 'account': job['account']}
        if timestamp: receipt['published_at'] = (self.now - timedelta(days=age)).isoformat()
        self.q.db.execute("UPDATE jobs SET status='uncertain' WHERE id=?", (key,))
        self.q.receipt(key, receipt)

    def test_requires_current_exact_approval(self):
        with self.assertRaises(ValueError): self.stage()
        self.approve()
        self.q.db.execute("UPDATE jobs SET approval_sha='wrong' WHERE id=?", (self.key,))
        with self.assertRaises(ValueError): self.stage()
        self.assertFalse(self.outbox.exists())

    def test_exact_bytes_only_stable_url_and_restart(self):
        self.approve()
        url = self.stage()
        self.assertEqual(url, self.base + '/' + self.sha + '.mp4')
        self.assertEqual([p.name for p in self.outbox.iterdir()], [self.sha + '.mp4'])
        target = self.outbox / (self.sha + '.mp4')
        self.assertEqual(target.read_bytes(), self.bytes)
        self.assertEqual(target.stat().st_mode & 0o777, 0o644)
        inode = target.stat().st_ino
        self.q.close(); self.q = machine.Queue(self.root / 'queue.sqlite3')
        self.assertEqual(self.stage(), url)
        self.assertEqual(target.stat().st_ino, inode)

    def test_tampered_frozen_media_or_qa_is_rejected(self):
        self.approve()
        (self.bundle / 'asset.mp4').write_bytes(b'tampered')
        with self.assertRaises(ValueError): self.stage()
        (self.bundle / 'asset.mp4').write_bytes(self.bytes)
        package = self.q.get(self.key)['package']; package['qa']['technical_pass'] = False
        self.q.db.execute('UPDATE jobs SET package=? WHERE id=?', (json.dumps(package), self.key))
        with self.assertRaises(ValueError): self.stage()

    def test_corrupt_destination_is_never_overwritten(self):
        self.approve(); self.stage()
        target = self.outbox / (self.sha + '.mp4'); target.write_bytes(b'corrupt')
        with self.assertRaises(ValueError): self.stage()
        self.assertEqual(target.read_bytes(), b'corrupt')

    def test_symlinks_traversal_and_private_roots_rejected(self):
        self.approve()
        other = self.root / 'other'; other.mkdir()
        link = self.root / 'link'; link.symlink_to(other, target_is_directory=True)
        for root in (link, self.root / 'x' / '..' / 'public', self.bundle, self.root):
            with self.subTest(root=root), self.assertRaises(ValueError):
                media_outbox.stage(self.q, self.key, root, self.base)
        self.outbox.mkdir()
        (self.outbox / (self.sha + '.mp4')).symlink_to(self.bundle / 'asset.mp4')
        with self.assertRaises(ValueError): self.stage()
        (self.outbox / (self.sha + '.mp4')).unlink()
        asset = self.bundle / 'asset.mp4'; asset.unlink(); asset.symlink_to(self.root / 'render.mp4')
        with self.assertRaises(ValueError): self.stage()

    def test_only_clean_https_direct_base_urls(self):
        self.approve()
        for base in ('http://media.test', 'https://u:p@media.test', 'https://media.test/a?token=secret', 'https://media.test/#x', 'https://media.test/../private', 'https://media.test/%2e%2e/private', 'https://media.test/a%2fb', 'https://media.test/a\\b'):
            with self.subTest(base=base), self.assertRaises(ValueError):
                media_outbox.stage(self.q, self.key, self.outbox, base)

    def test_cleanup_holds_unpublished_uncertain_and_missing_dates(self):
        self.approve(); self.stage()
        self.assertFalse(media_outbox.cleanup(self.q, self.key, self.outbox, self.now))
        self.q.db.execute("UPDATE jobs SET status='uncertain' WHERE id=?", (self.key,))
        self.assertFalse(media_outbox.cleanup(self.q, self.key, self.outbox, self.now))
        self.publish(timestamp=False)
        self.assertFalse(media_outbox.cleanup(self.q, self.key, self.outbox, self.now))

    def test_cleanup_waits_retention_and_other_network(self):
        self.approve(); self.stage()
        fb = self.q.enqueue(dict(self.package, network='facebook'))
        self.publish()
        self.assertFalse(media_outbox.cleanup(self.q, self.key, self.outbox, self.now))
        self.q.approve(fb, 'owner'); self.publish(fb, age=2)
        self.assertFalse(media_outbox.cleanup(self.q, self.key, self.outbox, self.now))
        self.assertTrue(media_outbox.cleanup(self.q, self.key, self.outbox, self.now + timedelta(days=6)))
        self.assertFalse((self.outbox / (self.sha + '.mp4')).exists())
        self.assertFalse(media_outbox.cleanup(self.q, self.key, self.outbox, self.now + timedelta(days=6)))

    def test_shared_sha_across_different_artifacts_is_retained(self):
        self.approve(); self.stage(); self.publish()
        bundle = engine.freeze({'post': {'id': 'P003'}}, self.root / 'source', self.root / 'render.mp4', self.root / 'artifacts')
        package = dict(self.package, bundle=str(bundle))
        package['qa'] = dict(package['qa'], artifact_id=bundle.name)
        package['creative_verification']=attest(bundle,package['caption'],package['cta'])
        other = self.q.enqueue(package)
        self.assertFalse(media_outbox.cleanup(self.q, self.key, self.outbox, self.now))
        self.q.approve(other, 'owner'); self.publish(other)
        self.assertTrue(media_outbox.cleanup(self.q, self.key, self.outbox, self.now))

    def test_qa_gate_even_if_status_was_forged(self):
        self.q.cancel(self.key, 'replace test fixture')
        package = dict(self.package); package.pop('qa')
        self.key = self.q.enqueue(package)
        self.q.db.execute("UPDATE jobs SET status='approved',approval_sha=? WHERE id=?", (self.key, self.key))
        with self.assertRaises(ValueError): self.stage()

    def test_public_permissions_repaired_without_changing_bytes(self):
        self.approve(); self.stage()
        target = self.outbox / (self.sha + '.mp4')
        target.chmod(0o600); self.outbox.chmod(0o700)
        self.stage()
        self.assertEqual(target.stat().st_mode & 0o777, 0o644)
        self.assertEqual(self.outbox.stat().st_mode & 0o777, 0o755)

    def test_cleanup_rejects_bad_timestamp_or_receipt_binding(self):
        self.approve(); self.stage(); self.publish()
        original = self.q.get(self.key)['receipt']
        for changes in ({'published_at': '2026-01-01'}, {'published_at': 'invalid'}, {'package_sha256': 'wrong'}, {'status': 'scheduled'}, {'published_at': (self.now + timedelta(days=1)).isoformat()}):
            receipt = dict(original, **changes)
            self.q.db.execute('UPDATE jobs SET receipt=? WHERE id=?', (json.dumps(receipt), self.key))
            self.assertFalse(media_outbox.cleanup(self.q, self.key, self.outbox, self.now))


if __name__ == '__main__': unittest.main()
