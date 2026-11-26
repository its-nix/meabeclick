import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import engine
import google_sync
import drive_assets
from test_drive_versions import Drive, md5


class CreatingDrive(Drive):
    def __init__(self):
        super().__init__()
        self.folders = {}
        self.uploads = 0
        self.crash_after_upload = False

    def _request(self, method, url, body=None, content_type='application/json'):
        path = urlsplit(url).path
        if method == 'POST' and path.endswith('/files'):
            value = json.loads(body)
            identity = 'folder' + str(len(self.folders) + 1)
            self.folders[identity] = {**value, 'id': identity}
            return {'id': identity}
        identity = path.rsplit('/', 1)[1]
        if method == 'GET' and identity in self.folders:
            return self.folders[identity]
        return super()._request(method, url, body, content_type)

    def upload(self, path, parent_id, state_dir):
        data = path.read_bytes()
        assert path.name == 'Video.mp4'
        def submit():
            self.uploads += 1
            self.data = data
            self.revisions = {'r1': self.revision('r1', data)}
            return self._request('GET', 'https://www.googleapis.com/drive/v3/files/f1')
        receipt = self._write(state_dir, {'operation': 'fixture-upload', 'sha': hashlib.sha256(data).hexdigest(),
                                        'parent': parent_id}, submit, lambda receipt: None)
        if self.crash_after_upload:
            raise RuntimeError('simulated local crash after verified provider receipt')
        return receipt


class AssetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.src = self.root / 'src'
        self.src.mkdir()
        (self.src / 'index.html').write_text('fixture')
        self.client = Drive()
        self.state = self.root / 'state'
        self.slot = '2026-11-15T19:30:00+02:00'
        self.work = 'P002@' + self.slot
        self.cfg = {'drive_posts_folder_id': 'posts', 'drive_work_items': {
            self.work: {'file_id': 'f1', 'folder_id': 'concept', 'short_name': 'Rectangles',
                        'expected_md5': md5(b'old'), 'revision_id': 'r1'}}}
        self.gate = patch('drive_assets.creative_verification.require', return_value=True)
        self.gate.start()
        self.addCleanup(self.gate.stop)

    def item(self, data):
        media = self.root / 'candidate.mp4'
        media.write_bytes(data)
        bundle = engine.freeze({'post': {'id': 'P002'}}, self.src, media, self.root / 'bundles')
        return {'bundle': str(bundle), 'artifact_id': bundle.name, 'caption': 'test',
                'cta': 'learn', 'scheduled_at': self.slot,
                'creative_verification': {'fixture': True}, 'verification_status': 'ready_for_human'}

    def test_stable_id_update_and_no_change_does_not_upload_twice(self):
        item = self.item(b'new')
        first = drive_assets.store(self.client, item, self.cfg, self.state)
        writes = len(self.client.writes)
        second = drive_assets.store(self.client, item, self.cfg, self.state)
        self.assertEqual(first['file_id'], 'f1')
        self.assertEqual(second['revision_id'], first['revision_id'])
        self.assertEqual(len(self.client.writes), writes)
        third = drive_assets.store(self.client, self.item(b'next'), self.cfg, self.state)
        self.assertEqual(third['file_id'], 'f1')
        self.assertNotEqual(third['revision_id'], first['revision_id'])

    def test_queued_older_media_blocks_update(self):
        queue = SimpleNamespace(rows=lambda: [{'status': 'review', 'package': {
            'preview_url': 'https://drive.google.com/file/d/f1/view', 'media_sha256': 'older'}}])
        with self.assertRaises(ValueError):
            drive_assets.store(self.client, self.item(b'new'), self.cfg, self.state, queue)
        self.assertEqual(self.client.writes, [])

    def test_failed_verification_performs_no_writes(self):
        item = self.item(b'new')
        item['verification_status'] = 'blocked'
        with self.assertRaises(ValueError):
            drive_assets.store(self.client, item, self.cfg, self.state)
        self.assertEqual(self.client.writes, [])

    def test_rollback_preserves_history_and_requires_verification(self):
        first = drive_assets.store(self.client, self.item(b'new'), self.cfg, self.state)
        drive_assets.store(self.client, self.item(b'next'), self.cfg, self.state)
        result = drive_assets.restore_previous(self.client, self.work, self.state)
        self.assertEqual(result['file_id'], first['file_id'])
        self.assertNotEqual(result['revision_id'], first['revision_id'])
        self.assertEqual(self.client.data, b'new')
        self.assertTrue(result['needs_verification'])
        record = json.loads((self.state / 'drive-assets.json').read_text())[self.work]
        self.assertEqual(record['status'], 'draft')
        self.assertEqual(len(record['history']), 3)

    def test_creation_reuses_verified_intent_after_crash_and_rejects_changed_bytes(self):
        self.client = CreatingDrive()
        self.client.crash_after_upload = True
        self.cfg['drive_work_items'] = {}
        item = self.item(b'new')
        with self.assertRaises(RuntimeError):
            drive_assets.store(self.client, item, self.cfg, self.state)
        with self.assertRaises(google_sync.UncertainWrite):
            drive_assets.store(self.client, self.item(b'changed'), self.cfg, self.state)
        self.client.crash_after_upload = False
        result = drive_assets.store(self.client, item, self.cfg, self.state)
        self.assertEqual(self.client.uploads, 1)
        self.assertEqual(len(self.client.folders), 2)
        self.assertEqual(result['revision_id'], 'r1')
        self.assertTrue(self.client.revisions['r1']['keepForever'])
        self.assertEqual(result['work_item'], self.work)

    def test_uncertain_update_blocks_changed_candidate_after_registry_reload(self):
        self.client.lose_response = True
        with self.assertRaises(google_sync.UncertainWrite):
            drive_assets.store(self.client, self.item(b'new'), self.cfg, self.state)
        writes = len(self.client.writes)
        with self.assertRaises(google_sync.UncertainWrite):
            drive_assets.store(self.client, self.item(b'next'), self.cfg, self.state)
        self.assertEqual(len(self.client.writes), writes)

    def test_same_hash_still_checks_revision_identity(self):
        item = self.item(b'new')
        drive_assets.store(self.client, item, self.cfg, self.state)
        self.client.head = 'independent_revision'
        self.client.revisions[self.client.head] = self.client.revision(self.client.head, b'new', True)
        with self.assertRaises(ValueError):
            drive_assets.store(self.client, item, self.cfg, self.state)

    def test_approved_reference_blocks_mutation_even_with_same_media_hash(self):
        item = self.item(b'new')
        queue = SimpleNamespace(rows=lambda: [{'status': 'approved', 'package': {
            'drive_file_id': 'f1', 'media_sha256': engine.sha(Path(item['bundle']) / 'asset.mp4')}}])
        with self.assertRaises(ValueError):
            drive_assets.store(self.client, item, self.cfg, self.state, queue)
        self.assertEqual(self.client.writes, [])

    def test_rollback_blocks_pending_review(self):
        drive_assets.store(self.client, self.item(b'new'), self.cfg, self.state)
        latest = drive_assets.store(self.client, self.item(b'next'), self.cfg, self.state)
        queue = SimpleNamespace(rows=lambda: [{'status': 'review', 'package': {
            'drive_receipt': latest, 'media_sha256': latest['sha256']}}])
        with self.assertRaises(ValueError):
            drive_assets.restore_previous(self.client, self.work, self.state, queue)


if __name__ == '__main__':
    unittest.main()
