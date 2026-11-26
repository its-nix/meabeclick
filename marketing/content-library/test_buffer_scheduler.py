"""Real Queue/outbox fixtures; no credentials or external writes."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

import engine
import machine
from test_creative_fixtures import tiny_video, attest
import buffer_mcp
import buffer_scheduler

ORG = '1' * 24
CHANNEL = '2' * 24
POST = '3' * 24


def envelope(data):
    return {'content': [{'type': 'text', 'text': json.dumps(data)}, {'type': 'text', 'text': '{"rateLimit":[]}'}]}


class Client:
    def __init__(self):
        self.channel = {'id': CHANNEL, 'service': 'instagram', 'type': 'business', 'isDisconnected': False, 'isLocked': False, 'organizationId': ORG, 'isQueuePaused': False, 'metadata': {'defaultToReminders': False}}
        self.writes = []
        self.error = None
        self.change = {}
        self.readback_change = {}
        self.post_reads = []
    def channels(self, org):
        return envelope([self.channel] if org == ORG else [])
    def call(self, name, arguments):
        assert name == 'get_channel'
        return envelope(self.channel)
    def tools(self):
        return [{'name': 'create_post', 'inputSchema': {'type': 'object'}}]
    def validate_create(self, arguments):
        pass
    def _write(self, name, arguments):
        self.writes.append((name, copy.deepcopy(arguments)))
        if self.error:
            raise self.error
        data = dict(arguments, id=POST, status='scheduled')
        data.update(self.change)
        return envelope(data)

    def get_post(self, post_id):
        self.post_reads.append(post_id)
        data = dict(self.writes[-1][1], id=post_id, status='scheduled')
        data.update(self.change)
        data.update(self.readback_change)
        return envelope(data)


class SchedulerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        source = self.root / 'source'; source.mkdir()
        (source / 'index.html').write_text('private')
        media = self.root / 'render.mp4'; tiny_video(media)
        self.bundle = engine.freeze({'post': {'id': 'P002'}}, source, media, self.root / 'artifacts')
        self.sha = engine.sha(self.bundle / 'asset.mp4')
        self.cfg = {'provider': 'buffer-mcp', 'organization_id': ORG, 'channel_id': CHANNEL, 'public_base_url': 'https://media.example.test/content-media', 'media_root': str(self.root / 'public')}
        self.q = machine.Queue(self.root / 'queue.sqlite3', {'credentials_healthy': True})
        self.package = {'bundle': str(self.bundle), 'caption': 'approved caption', 'cta': 'educational', 'network': 'instagram', 'account': CHANNEL, 'scheduled_at': '2099-11-15T19:30:00+02:00', 'qa': {'technical_pass': True, 'artifact_id': self.bundle.name, 'media_sha256': self.sha, 'listening_required': False}}
        self.package['creative_verification']=attest(self.bundle,self.package['caption'],self.package['cta'])
        self.key = self.q.enqueue(self.package)
        self.q.approve(self.key, 'owner')
        self.client = Client()
        self.fetched = []
    def tearDown(self):
        self.q.close(); self.temp.cleanup()
    def fetch(self, url):
        self.fetched.append(url)
        return (self.root / 'public' / (self.sha + '.mp4')).read_bytes()
    def run_schedule(self):
        return buffer_scheduler.schedule(self.q, self.key, self.cfg, client=self.client, public_fetch=self.fetch)
    def test_schedules_exact_approved_reel_once_with_verified_receipt(self):
        receipt = self.run_schedule()
        self.assertEqual(receipt['id'], POST)
        self.assertTrue(receipt['readback_verified'])
        self.assertEqual(self.client.post_reads, [POST])
        self.assertEqual(self.q.get(self.key)['status'], 'scheduled')
        self.assertEqual(self.client.writes, [('create_post', {'channelId': CHANNEL, 'schedulingType': 'automatic', 'mode': 'customScheduled', 'text': self.package['caption'], 'dueAt': self.package['scheduled_at'], 'assets': [{'video': {'url': self.cfg['public_base_url'] + '/' + self.sha + '.mp4'}}], 'metadata': {'instagram': {'type': 'reel', 'shouldShareToFeed': True}}})])
        self.assertEqual(len(self.fetched), 1)
        with self.assertRaises(ValueError):
            self.run_schedule()
        self.assertEqual(len(self.client.writes), 1)

    def test_due_delivery_confirms_sent_post_and_retains_same_buffer_identity(self):
        original = self.run_schedule()
        self.client.readback_change = {'status': 'sent', 'sentAt': self.package['scheduled_at']}
        result = buffer_scheduler.verify_delivery(self.q, self.key, self.cfg, client=self.client)
        self.assertEqual(result['id'], original['id'])
        self.assertEqual(result['status'], 'published')
        self.assertEqual(self.q.get(self.key)['status'], 'published')

    def test_wrong_identity_destination_and_public_hash_fail_before_intent(self):
        for change in ({'service': 'facebook'}, {'organizationId': '9' * 24}, {'isDisconnected': True}, {'isQueuePaused': True}, {'metadata': {'defaultToReminders': True}}):
            old = copy.deepcopy(self.client.channel)
            self.client.channel.update(change)
            with self.assertRaises(ValueError): self.run_schedule()
            self.assertEqual(self.q.get(self.key)['status'], 'approved')
            self.client.channel = old
        self.cfg['channel_id'] = '9' * 24
        with self.assertRaises(ValueError): self.run_schedule()
        self.cfg['channel_id'] = CHANNEL
        with self.assertRaises(ValueError):
            buffer_scheduler.schedule(self.q, self.key, self.cfg, client=self.client, public_fetch=lambda url: b'corrupt')
        self.assertEqual(self.q.get(self.key)['status'], 'approved')
        self.assertEqual(self.client.writes, [])

    def test_timeout_or_ambiguous_saved_post_is_uncertain_across_restart(self):
        self.client.error = TimeoutError('private provider details')
        with self.assertRaisesRegex(ValueError, 'uncertain') as error: self.run_schedule()
        self.assertNotIn('private provider', str(error.exception))
        self.q.close()
        self.q = machine.Queue(self.root / 'queue.sqlite3', {'credentials_healthy': True})
        self.assertEqual(self.q.get(self.key)['status'], 'uncertain')
        with self.assertRaises(ValueError): self.run_schedule()
        self.assertEqual(len(self.client.writes), 1)
        self.assertIsNone(self.q.get(self.key)['receipt'])

    def test_successful_create_without_matching_readback_is_uncertain(self):
        self.client.readback_change = {'text': 'Different caption'}
        with self.assertRaisesRegex(ValueError, 'uncertain'):
            self.run_schedule()
        self.assertEqual(self.q.get(self.key)['status'], 'uncertain')
        self.assertIsNone(self.q.get(self.key)['receipt'])
        self.assertEqual(self.client.post_reads, [POST])
        self.assertEqual(len(self.client.writes), 1)

    def test_read_only_reconciliation_after_restart_recovers_an_already_published_post(self):
        self.client.readback_change = {'text': 'Different caption'}
        with self.assertRaisesRegex(ValueError, 'uncertain'):
            self.run_schedule()
        self.q.close()
        self.q = machine.Queue(self.root / 'queue.sqlite3', {'credentials_healthy': True})
        self.client.readback_change = {'status': 'sent', 'sentAt': self.package['scheduled_at']}
        receipt = buffer_scheduler.reconcile_saved_post(self.q, self.key, self.cfg, client=self.client)
        self.assertEqual((receipt['id'], receipt['status']), (POST, 'published'))
        self.assertTrue(receipt['readback_verified'])
        self.assertEqual(self.q.get(self.key)['receipt'], receipt)
        self.assertEqual(self.client.post_reads, [POST, POST])
        self.assertEqual(len(self.client.writes), 1)
        self.assertEqual(len(self.fetched), 1)

    def test_reconciliation_requires_proven_create_identity_and_matching_live_media(self):
        self.client.readback_change = {'assets': [{'video': {'url': 'https://example.test/other.mp4'}}]}
        with self.assertRaisesRegex(ValueError, 'uncertain'):
            self.run_schedule()
        with self.assertRaisesRegex(ValueError, 'exact approved package'):
            buffer_scheduler.reconcile_saved_post(self.q, self.key, self.cfg, client=self.client)
        self.assertIsNone(self.q.get(self.key)['receipt'])
        self.q.db.execute("DELETE FROM events WHERE action='buffer_response'")
        with self.assertRaisesRegex(ValueError, 'No saved create response'):
            buffer_scheduler.reconcile_saved_post(self.q, self.key, self.cfg, client=self.client)
        self.assertEqual(self.client.post_reads, [POST, POST])
        self.assertEqual(len(self.client.writes), 1)

    def test_mismatched_saved_schedule_remains_uncertain(self):
        self.client.change = {'dueAt': '2099-11-16T19:30:00+02:00'}
        with self.assertRaisesRegex(ValueError, 'uncertain'): self.run_schedule()
        self.assertEqual(self.q.get(self.key)['status'], 'uncertain')
        self.assertIsNone(self.q.get(self.key)['receipt'])

    def test_live_schema_rejection_leaves_job_approved(self):
        def reject(payload):
            raise buffer_mcp.BufferError('Schema incompatible')
        self.client.validate_create = reject
        with self.assertRaises(ValueError): self.run_schedule()
        self.assertEqual(self.q.get(self.key)['status'], 'approved')
        self.assertEqual(self.client.writes, [])

    def test_unapproved_seed_never_submits(self):
        self.q.hold(self.key, 're-review')
        with self.assertRaises(ValueError): self.run_schedule()
        self.assertEqual(self.q.get(self.key)['status'], 'review')
        self.assertEqual(self.client.writes, [])

    def test_wrong_saved_channel_is_uncertain(self):
        self.client.change = {'channelId': '9' * 24}
        with self.assertRaisesRegex(ValueError, 'uncertain'): self.run_schedule()
        self.assertIsNone(self.q.get(self.key)['receipt'])

    def test_wrong_saved_caption_is_uncertain(self):
        self.client.change = {'text': 'different caption'}
        with self.assertRaisesRegex(ValueError, 'uncertain'): self.run_schedule()
        self.assertIsNone(self.q.get(self.key)['receipt'])

    def test_wrong_saved_video_is_uncertain(self):
        self.client.change = {'assets': [{'video': {'url': 'https://media.example.test/other.mp4'}}]}
        with self.assertRaisesRegex(ValueError, 'uncertain'): self.run_schedule()
        self.assertIsNone(self.q.get(self.key)['receipt'])

    def test_missing_saved_id_is_uncertain(self):
        self.client.change = {'id': None}
        with self.assertRaisesRegex(ValueError, 'uncertain'): self.run_schedule()
        self.assertIsNone(self.q.get(self.key)['receipt'])

    def test_public_verification_precedes_durable_intent_and_write(self):
        def fetch(url):
            self.assertEqual(self.q.get(self.key)['status'], 'approved')
            return self.fetch(url)
        original = self.client._write
        def write(name, arguments):
            self.assertEqual(self.q.get(self.key)['status'], 'uncertain')
            self.assertTrue((self.root / 'public' / (self.sha + '.mp4')).exists())
            return original(name, arguments)
        self.client._write = write
        buffer_scheduler.schedule(self.q, self.key, self.cfg, client=self.client, public_fetch=fetch)
        self.assertEqual(self.q.db.execute("SELECT count(*) FROM events WHERE action='submission_intent'").fetchone()[0], 1)

    def test_documented_saved_video_source_matches_approved_url(self):
        url = self.cfg['public_base_url'] + '/' + self.sha + '.mp4'
        self.client.change = {'assets': [{'video': {'source': url, 'id': 'provider-asset'}}]}
        self.assertEqual(self.run_schedule()['id'], POST)

    def facebook(self):
        self.cfg['network'] = 'facebook'
        self.client.channel.update(service='facebook', type='page', metadata=None)
        self.package.update(network='facebook')
        self.key = self.q.enqueue(self.package)

    def test_facebook_requires_its_own_exact_approval(self):
        instagram_key = self.key
        self.facebook()
        self.assertNotEqual(self.key, instagram_key)
        with self.assertRaises(ValueError): self.run_schedule()
        self.assertEqual(self.client.writes, [])
        self.assertFalse((self.root / 'public').exists())
        self.q.approve(self.key, 'owner')
        receipt = self.run_schedule()
        self.assertEqual(receipt['network'], 'facebook')
        self.assertEqual(receipt['account'], CHANNEL)
        self.assertEqual(receipt['package_sha256'], self.key)
        self.assertEqual(self.client.writes[0][1]['metadata'], {'facebook': {'type': 'reel'}})
        self.assertEqual(self.q.get(instagram_key)['status'], 'approved')

    def test_live_facebook_output_shape_verifies_exact_source_and_flat_metadata(self):
        self.facebook();self.q.approve(self.key,'owner')
        url=self.cfg['public_base_url']+'/'+self.sha+'.mp4'
        self.client.change={'channelService':'facebook','error':None,
            'assets':[{'__typename':'VideoAsset','type':'video','mimeType':'video/mp4','source':url,'video':{'durationMs':15000}}],
            'metadata':{'__typename':'FacebookPostMetadata','type':'reel','annotations':[],'title':None}}
        self.assertEqual(self.run_schedule()['id'],POST)

    def test_flat_facebook_metadata_cannot_verify_another_network(self):
        self.client.change={'metadata':{'__typename':'FacebookPostMetadata','type':'reel','shouldShareToFeed':True}}
        with self.assertRaisesRegex(ValueError,'uncertain'):self.run_schedule()

    def test_facebook_identity_rejects_profiles_groups_and_unsafe_settings(self):
        self.facebook()
        self.q.approve(self.key, 'owner')
        for change in ({'type': 'profile'}, {'type': 'group'}, {'service': 'instagram'},
                       {'organizationId': '9' * 24}, {'isDisconnected': True},
                       {'isLocked': True}, {'isQueuePaused': True}):
            original = copy.deepcopy(self.client.channel)
            self.client.channel.update(change)
            with self.assertRaises(ValueError): self.run_schedule()
            self.assertFalse((self.root / 'public').exists())
            self.assertEqual(self.q.get(self.key)['status'], 'approved')
            self.client.channel = original
        self.assertEqual(self.client.writes, [])

    def test_wrong_network_configuration_blocks_before_staging(self):
        for network in ('facebook', 'twitter', None):
            self.cfg['network'] = network
            with self.assertRaises(ValueError): self.run_schedule()
            self.assertFalse((self.root / 'public').exists())
        self.assertEqual(self.client.writes, [])

    def test_facebook_receipt_rejects_instagram_metadata(self):
        self.facebook()
        self.q.approve(self.key, 'owner')
        self.client.change = {'metadata': {'instagram': {'type': 'reel', 'shouldShareToFeed': True}}}
        with self.assertRaisesRegex(ValueError, 'uncertain'): self.run_schedule()
        self.assertIsNone(self.q.get(self.key)['receipt'])

    def test_facebook_receipt_rejects_wrong_media_type(self):
        self.facebook()
        self.q.approve(self.key, 'owner')
        self.client.change = {'metadata': {'facebook': {'type': 'story'}}}
        with self.assertRaisesRegex(ValueError, 'uncertain'): self.run_schedule()
        self.assertIsNone(self.q.get(self.key)['receipt'])

    def test_actual_ambiguous_response_is_preserved_for_readonly_reconciliation(self):
        self.client.change = {'assets': [{'unknown': 'provider-shape'}]}
        with self.assertRaisesRegex(ValueError, 'uncertain'): self.run_schedule()
        event = self.q.db.execute("SELECT detail FROM events WHERE job=? AND action='buffer_response'", (self.key,)).fetchone()
        self.assertIsNotNone(event)
        raw = buffer_mcp.result_data(json.loads(event['detail']))
        self.assertEqual(raw['id'], POST)
        self.assertEqual(raw['assets'], self.client.change['assets'])
        self.assertIsNone(self.q.get(self.key)['receipt'])

    def assert_preflight_blocks_without_staging(self, reason):
        def unexpected_channels(org):
            self.fail('Blocked package must not contact Buffer')
        self.client.channels = unexpected_channels
        with self.assertRaisesRegex(ValueError, reason): self.run_schedule()
        self.assertFalse((self.root / 'public').exists())
        self.assertEqual(self.client.writes, [])
        self.assertEqual(self.fetched, [])
        self.assertEqual(self.q.get(self.key)['status'], 'approved')
        self.assertEqual(self.q.db.execute("SELECT count(*) FROM events WHERE job=? AND action='submission_intent'", (self.key,)).fetchone()[0], 0)

    def test_paused_queue_blocks_before_any_public_staging(self):
        self.q.policy['paused'] = True
        self.assert_preflight_blocks_without_staging('paused')

    def test_reconciliation_blocks_before_any_public_staging(self):
        other = dict(self.package, account='4' * 24)
        other_key = self.q.enqueue(other)
        self.q.approve(other_key, 'owner')
        self.q.begin_submission(other_key)
        self.assert_preflight_blocks_without_staging('reconciliation_required')

    def test_daily_limit_blocks_before_any_public_staging(self):
        self.q.policy['daily_limit'] = 0
        self.assert_preflight_blocks_without_staging('daily_limit')

    def test_monthly_limit_blocks_before_any_public_staging(self):
        self.q.policy['monthly_limit'] = 0
        self.assert_preflight_blocks_without_staging('monthly_limit')

    def test_full_capacity_blocks_before_any_public_staging(self):
        self.q.cancel(self.key, 'Test booking CTA capacity gate')
        self.package['cta'] = 'booking'
        self.package['creative_verification']=attest(self.bundle,self.package['caption'],self.package['cta'])
        self.key = self.q.enqueue(self.package)
        self.q.approve(self.key, 'owner')
        self.q.policy['capacity'] = {'total_hours': 1, 'occupied_hours': 1, 'observed_at': machine.now()}
        self.assert_preflight_blocks_without_staging('capacity_full')

class DiscoveryTests(unittest.TestCase):
    def test_connected_supported_channels_share_existing_org_and_media_configuration(self):
        class ReadClient:
            def channels(self,org):
                return envelope([{'id':'2'*24,'service':'instagram','type':'business','isDisconnected':False,'isLocked':False},
                  {'id':'3'*24,'service':'facebook','type':'page','isDisconnected':False,'isLocked':False},
                  {'id':'4'*24,'service':'facebook','type':'profile','isDisconnected':False,'isLocked':False},
                  {'id':'5'*24,'service':'instagram','type':'business','isDisconnected':True,'isLocked':False}])
        base={'provider':'buffer-mcp','organization_id':'1'*24,'channel_id':'2'*24,'key_path':'private','media_root':'media','public_base_url':'https://example.test'}
        found=buffer_scheduler.discover_publishers([base],client=ReadClient())
        self.assertEqual([(p['network'],p['channel_id']) for p in found],[('facebook','3'*24),('instagram','2'*24)])
        self.assertTrue(all(p['media_root']=='media' and p['organization_id']=='1'*24 for p in found))
