"""Offline provider simulation; never accesses credentials or live Drive."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from urllib.parse import urlsplit, parse_qs
import google_sync
import drive_versions as versions


def md5(content):
    return hashlib.md5(content).hexdigest()


class Drive(google_sync.GoogleSync):
    def __init__(self):
        self.data = b'old'
        self.revisions = {'r1': self.revision('r1', self.data)}
        self.head = 'r1'
        self.version = 1
        self.writes = []
        self.lose_response = False
        self.corrupt_readback = False
        self.change_before_upload = False
        self.file_reads = 0

    def _access(self):
        return 'offline'

    def revision(self, identity, data, pinned=False):
        return {'id': identity, 'md5Checksum': md5(data), 'size': str(len(data)),
                'keepForever': pinned, 'mimeType': 'video/mp4'}

    def _request(self, method, url, body=None, content_type='application/json'):
        parsed = urlsplit(url)
        suffix = parsed.path.split('/files/f1', 1)[1]
        if method == 'GET' and suffix == '':
            self.file_reads += 1
            if self.change_before_upload and self.file_reads == 3:
                self.version += 1
            checksum = '0' * 32 if self.corrupt_readback and self.head != 'r1' else md5(self.data)
            return {'id': 'f1', 'headRevisionId': self.head, 'md5Checksum': checksum,
                    'size': str(len(self.data)), 'version': str(self.version),
                    'mimeType': 'video/mp4', 'webViewLink': 'https://drive.google.com/file/d/f1/view'}
        if method == 'GET' and suffix == '/revisions':
            return {'revisions': list(self.revisions.values())}
        if method == 'GET' and suffix.startswith('/revisions/'):
            return dict(self.revisions[suffix.rsplit('/', 1)[1]])
        self.writes.append((method, suffix))
        if method == 'PATCH' and suffix.startswith('/revisions/'):
            value = self.revisions[suffix.rsplit('/', 1)[1]]
            value['keepForever'] = True
            return dict(value)
        if method == 'PATCH' and suffix == '':
            assert parse_qs(parsed.query)['keepRevisionForever'] == ['true']
            self.data = body
            self.version += 1
            self.head = 'r' + str(self.version)
            self.revisions[self.head] = self.revision(self.head, body, True)
            if self.lose_response:
                raise RuntimeError('simulated disconnect')
            return self._request('GET', url)
        raise AssertionError((method, suffix))


class VersionsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.path = self.root / 'Video.mp4'
        self.path.write_bytes(b'new')
        self.client = Drive()
        self.state = self.root / 'state'

    def upload(self, **kwargs):
        return versions.versioned_upload(self.client, self.path, 'f1', self.state,
                                         expected_md5=md5(b'old'), **kwargs)

    def test_pin_metadata_version_change_does_not_block_exact_head_update(self):
        original = self.client._request
        def request(method, url, body=None, content_type='application/json'):
            value = original(method, url, body, content_type)
            if method == 'PATCH' and '/revisions/' in url:
                self.client.version += 1
            return value
        self.client._request = request
        receipt = self.upload()
        self.assertEqual(receipt['md5Checksum'], md5(b'new'))

    def test_upload_retains_id_and_pins_old_and_new_revisions(self):
        receipt = self.upload()
        self.assertEqual(receipt['id'], 'f1')
        self.assertEqual(receipt['revision_id'], 'r2')
        self.assertEqual(receipt['sha256'], hashlib.sha256(b'new').hexdigest())
        self.assertTrue(all(r['keepForever'] for r in versions.list_revisions(self.client, 'f1')))

    def test_uncertain_update_blocks_new_content_after_restart(self):
        self.client.lose_response = True
        with self.assertRaises(google_sync.UncertainWrite):
            self.upload()
        writes = len(self.client.writes)
        self.client.lose_response = False
        self.path.write_bytes(b'another draft')
        with self.assertRaises(google_sync.UncertainWrite):
            versions.versioned_upload(self.client, self.path, 'f1', self.state,
                                      expected_md5=md5(b'new'))
        self.assertEqual(len(self.client.writes), writes)

    def test_hash_mismatch_blocks_writes(self):
        self.client.data = b'independent edit'
        with self.assertRaises(ValueError):
            self.upload()
        self.assertEqual(self.client.writes, [])

    def test_approved_and_submitted_states_never_mutate(self):
        for status in ('approved', 'scheduled', 'published', 'submitted', 'uncertain', '', None):
            with self.subTest(status=status), self.assertRaises(ValueError):
                self.upload(work_item_status=status)
        self.assertEqual(self.client.writes, [])

    def test_capacity_refusal_keeps_every_revision(self):
        for number in range(2, 201):
            identity = 'r' + str(number)
            self.client.revisions[identity] = self.client.revision(identity, b'archive', True)
        with self.assertRaises(ValueError):
            self.upload()
        self.assertEqual(self.client.writes, [])
        self.assertEqual(len(self.client.revisions), 200)

    def test_metadata_only_version_drift_does_not_block_binary_update(self):
        self.client.change_before_upload = True
        receipt = self.upload()
        self.assertEqual(receipt['md5Checksum'], md5(b'new'))

    def test_changed_head_during_preparation_blocks_media_update(self):
        original = self.client._request
        def request(method, url, body=None, content_type='application/json'):
            if method == 'GET' and urlsplit(url).path.endswith('/files/f1') and self.client.file_reads == 2:
                self.client.head = 'external-head'
                self.client.revisions['external-head'] = self.client.revision('external-head', b'old', True)
            return original(method, url, body, content_type)
        self.client._request = request
        with self.assertRaises(google_sync.UncertainWrite):
            self.upload()
        self.assertEqual(self.client.data, b'old')
        records = list(self.state.glob('drive-preflight-*.json'))
        self.assertEqual(len(records), 1)
        self.assertEqual(json.loads(records[0].read_text())['status'], 'rejected_before_media_request')
        self.assertNotIn(('PATCH', ''), self.client.writes)

    def test_bad_readback_remains_uncertain(self):
        self.client.corrupt_readback = True
        with self.assertRaises(google_sync.UncertainWrite):
            self.upload()
        with self.assertRaises(google_sync.UncertainWrite):
            self.upload()

    def test_restore_promotes_known_pinned_bytes_without_removing_history(self):
        self.upload()
        self.path.write_bytes(b'old')
        receipt = versions.restore(self.client, self.path, 'f1', 'r1', self.state,
                                   expected_md5=md5(b'new'))
        self.assertEqual(receipt['id'], 'f1')
        self.assertEqual(receipt['revision_id'], 'r3')
        self.assertEqual(receipt['restored_from'], 'r1')
        self.assertEqual(self.client.data, b'old')
        self.assertEqual(set(self.client.revisions), {'r1', 'r2', 'r3'})

    def test_restore_rejects_wrong_bytes(self):
        self.upload()
        writes = len(self.client.writes)
        with self.assertRaises(ValueError):
            versions.restore(self.client, self.path, 'f1', 'r1', self.state,
                             expected_md5=md5(b'new'))
        self.assertEqual(len(self.client.writes), writes)

    def test_restore_rejects_unpinned_target(self):
        self.path.write_bytes(b'old')
        with self.assertRaises(ValueError):
            versions.restore(self.client, self.path, 'f1', 'r1', self.state,
                             expected_md5=md5(b'old'))
        self.assertEqual(self.client.writes, [])

    def test_missing_head_in_revision_listing_refuses_retention_count(self):
        original = self.client._request
        def request(method, url, body=None, content_type='application/json'):
            if method == 'GET' and urlsplit(url).path.endswith('/revisions'):
                return {'revisions': []}
            return original(method, url, body, content_type)
        self.client._request = request
        with self.assertRaises(ValueError):
            self.upload()
        self.assertEqual(self.client.writes, [])

    def test_list_follows_pagination(self):
        requests = []
        def request(method, url):
            query = parse_qs(urlsplit(url).query)
            requests.append(query)
            if 'pageToken' not in query:
                return {'revisions': [self.client.revision('r1', b'old')], 'nextPageToken': 'next token'}
            self.assertEqual(query['pageToken'], ['next token'])
            return {'revisions': [self.client.revision('r2', b'new')]}
        self.client._request = request
        self.assertEqual([r['id'] for r in versions.list_revisions(self.client, 'f1')], ['r1', 'r2'])
        self.assertEqual(len(requests), 2)


if __name__ == '__main__':
    unittest.main()
