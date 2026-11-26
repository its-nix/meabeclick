import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import engine
import machine
from test_creative_fixtures import tiny_video, attest

class QueueTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.root=Path(self.temp.name).resolve()
        src=self.root/'src';src.mkdir();(src/'index.html').write_text('<html>test</html>')
        media=self.root/'a.mp4';tiny_video(media)
        self.bundle=engine.freeze({'post':{'id':'P002'}},src,media,self.root/'artifacts')
        self.q=machine.Queue(self.root/'queue.sqlite3',policy={'credentials_healthy':True})
        self.package={'bundle':str(self.bundle),'caption':'כמה מלבנים?','cta':'educational','network':'instagram','account':'brand','scheduled_at':'2035-11-15T19:30:00+02:00','qa':{'technical_pass':True,'artifact_id':self.bundle.name,'media_sha256':engine.sha(self.bundle/'asset.mp4'),'listening_required':False}}
        self.package['creative_verification']=attest(self.bundle,self.package['caption'],self.package['cta'])
    def tearDown(self):self.temp.cleanup()
    def test_exact_package_and_restart(self):
        key=self.q.enqueue(self.package)
        self.assertEqual(key,self.q.enqueue(self.package))
        self.q.approve(key,'owner',listened=False)
        q=machine.Queue(self.root/'queue.sqlite3',policy={'credentials_healthy':True})
        self.assertEqual(q.get(key)['status'],'approved')
        self.assertEqual(q.get(key)['approval_sha'],key)
        changed=dict(self.package,caption='new copy')
        with self.assertRaises(ValueError):q.enqueue(changed)
    def test_uncertain_intent_never_retries(self):
        key=self.q.enqueue(self.package);self.q.approve(key,'owner')
        self.q.begin_submission(key)
        q=machine.Queue(self.root/'queue.sqlite3',policy={'credentials_healthy':True})
        with self.assertRaises(ValueError):q.begin_submission(key)
        q.receipt(key,{'package_sha256':key,'provider':'test','id':'remote1','status':'scheduled','network':'instagram','account':'brand'})
        self.assertEqual(q.get(key)['status'],'scheduled')
        with self.assertRaises(ValueError):q.begin_submission(key)

    def test_daily_tick_recovers_saved_submission_only_after_buffer_cooldown(self):
        key = self.q.enqueue(self.package)
        self.q.approve(key, 'owner')
        self.q.begin_submission(key)
        self.q.event(key, 'buffer_response', '{}')
        config = self.root / 'daily.json'
        config.write_text(json.dumps({
            'state_dir': str(self.root), 'daily_calendar_enabled': True,
            'publisher': {'network': 'instagram', 'channel_id': 'brand'},
            'destinations': [{'network': 'instagram', 'account': 'brand'}],
        }))
        pause = self.root / 'buffer-read-cooldown.json'
        pause.write_text('{"retry_at":"2099-01-01T00:00:00+00:00"}')
        receipt = {'package_sha256': key, 'provider': 'buffer', 'id': 'confirmed',
                   'status': 'scheduled', 'network': 'instagram', 'account': 'brand',
                   'readback_verified': True}
        reads = []

        def reconcile(queue, release, cfg):
            reads.append((release, cfg['channel_id']))
            queue.receipt(release, receipt)
            return receipt

        adapter = SimpleNamespace(verify_connection=lambda cfg: {'id': 'brand', 'name': 'Brand'},
                                  reconcile_saved_post=reconcile)
        with patch.dict('sys.modules', {'buffer_scheduler': adapter}), patch('preparation.prepare', return_value={'prepared': []}):
            cooling = machine.tick(config)
            self.assertIn('buffer_rate_limited', cooling['blocker_codes'])
            self.assertEqual(reads, [])
            pause.write_text('{"retry_at":"2020-01-01T00:00:00+00:00"}')
            recovered = machine.tick(config)
            self.assertEqual(recovered['reconciliations'], [receipt])
            self.assertEqual(recovered['submissions'], [])
            self.assertEqual(machine.tick(config)['reconciliations'], [])
        self.assertEqual(self.q.get(key)['status'], 'scheduled')
        self.assertEqual(reads, [(key, 'brand')])

    def test_missing_qa_cannot_approve(self):
        self.package.pop('qa');key=self.q.enqueue(self.package)
        with self.assertRaises(ValueError):self.q.approve(key,'owner')

    def test_missing_creative_report_cannot_approve_or_submit_legacy_job(self):
        package=dict(self.package);package.pop('creative_verification');key=self.q.enqueue(package)
        with self.assertRaisesRegex(ValueError,'Creative verification'):self.q.approve(key,'owner')
        self.q.db.execute("UPDATE jobs SET status='approved',approval_sha=? WHERE id=?",(key,key))
        with self.assertRaisesRegex(ValueError,'Creative verification'):self.q.begin_submission(key)
        self.assertEqual(self.q.get(key)['status'],'approved')

    def test_changed_review_report_blocks_previously_approved_submission(self):
        key=self.q.enqueue(self.package);self.q.approve(key,'owner')
        path=Path(self.package['creative_verification']['path']);path.write_text(path.read_text()+'\n')
        with self.assertRaisesRegex(ValueError,'checksum mismatch'):self.q.begin_submission(key)
        self.assertEqual(self.q.db.execute("SELECT count(*) FROM events WHERE action='submission_intent'").fetchone()[0],0)

    def test_paused_blocks_submission(self):
        key=self.q.enqueue(self.package);self.q.approve(key,'owner');self.q.policy['paused']=True
        with self.assertRaises(ValueError):self.q.begin_submission(key)

    def test_receipt_destination_binding(self):
        key=self.q.enqueue(self.package);self.q.approve(key,'owner');self.q.begin_submission(key)
        with self.assertRaises(ValueError):self.q.receipt(key,{'package_sha256':key,'provider':'test','id':'x','status':'scheduled','network':'facebook','account':'other'})

    def test_health_never_trusts_configured_but_unverified_provider(self):
        config=self.root/'config.json';config.write_text(json.dumps({'state_dir':str(self.root/'state'),'google_credentials':'/missing','publisher':{'name':'metricool'}}))
        report=machine.tick(config)
        self.assertFalse(report['ready'])
        self.assertIn('publisher_unverified',report['blocker_codes'])

    def test_verified_buffer_does_not_submit_unapproved_posts(self):
        self.q.enqueue(self.package)
        config=self.root/'config.json';config.write_text(json.dumps({'state_dir':str(self.root),'publisher':{'provider':'buffer-mcp','channel_id':'brand'},'destinations':[{'network':'instagram','account':'brand'}]}))
        adapter=SimpleNamespace(verify_connection=lambda cfg:{'id':'brand','name':'brand'})
        with patch.dict('sys.modules',{'buffer_scheduler':adapter}):
            report=machine.tick(config)
        self.assertTrue(report['publisher_verified'])
        self.assertIn('approval_missing',report['blocker_codes'])
        self.assertNotIn('publisher_unverified',report['blocker_codes'])
        self.assertEqual(self.q.rows()[0]['status'],'review')

    def test_autonomous_mode_uses_deterministic_controller_branch(self):
        config=self.root/'autonomous.json'
        config.write_text(json.dumps({'state_dir':str(self.root/'auto-state'),'google_credentials':'fixture','spreadsheet_id':'sheet',
          'autonomous_content_enabled':True,'prepare_enabled':True,'publishers':[{'network':'instagram','channel_id':'brand'}],
          'destinations':[{'network':'instagram','account':'brand'}]}))
        adapter=SimpleNamespace(verify_connection=lambda cfg:{'id':'brand','name':'Brand'})
        native=SimpleNamespace(snapshot=lambda *args:{'ideas':[]})
        report_value={'prepared':[],'problems':[],'generation':{'status':'idle'},'review_log':{'status':'synced'}}
        with patch.dict('sys.modules',{'buffer_scheduler':adapter}),patch('google_sync.load_credentials',return_value={}),patch('google_sync.GoogleSync',return_value=native),patch('autonomous.run',return_value=report_value) as controller:
            report=machine.tick(config)
        controller.assert_called_once()
        self.assertEqual(report['autonomous_content'],report_value)
        self.assertIn('owner_review_unavailable',report['blocker_codes'])

    def test_google_failure_blocks_submission_even_with_buffer_and_approval(self):
        key=self.q.enqueue(self.package);self.q.approve(key,'owner')
        config=self.root/'config.json';config.write_text(json.dumps({'state_dir':str(self.root),'publisher':{'provider':'buffer-mcp','channel_id':'brand'},'google_credentials':'/missing','destinations':[{'network':'instagram','account':'brand'}]}))
        adapter=SimpleNamespace(verify_connection=lambda cfg:{'id':'brand','name':'brand'})
        with patch.dict('sys.modules',{'buffer_scheduler':adapter}):
            report=machine.tick(config)
        self.assertIn('google_auth_or_sync',report['blocker_codes'])
        self.assertTrue(report['publisher_verified'])
        self.assertEqual(self.q.get(key)['status'],'approved')

    def test_missing_native_release_tab_blocks_automatic_submission(self):
        key=self.q.enqueue(self.package);self.q.approve(key,'owner')
        config=self.root/'config.json';config.write_text(json.dumps({'state_dir':str(self.root),'publisher':{'provider':'buffer-mcp','channel_id':'brand'},'google_credentials':'fixture','spreadsheet_id':'sheet','destinations':[{'network':'instagram','account':'brand'}]}))
        adapter=SimpleNamespace(verify_connection=lambda cfg:{'id':'brand','name':'brand'})
        with patch.dict('sys.modules',{'buffer_scheduler':adapter}), patch('google_sync.load_credentials',return_value={}), patch('google_sync.GoogleSync') as google:
            google.return_value.snapshot.return_value={'queue':[]}
            report=machine.tick(config)
        self.assertIn('owner_review_unavailable',report['blocker_codes'])
        self.assertEqual(self.q.get(key)['status'],'approved')

    def test_expired_approval_does_not_starve_a_future_approved_post(self):
        old=self.q.enqueue(dict(self.package,scheduled_at='2020-01-01T19:30:00+02:00',preview_url='https://example.test/video.mp4',drive_receipt={'revision_id':'r'}));self.q.approve(old,'owner')
        future=self.q.enqueue(dict(self.package,account='future-account',preview_url='https://example.test/video.mp4',drive_receipt={'revision_id':'r'}));self.q.approve(future,'owner')
        config=self.root/'expiry.json';config.write_text(json.dumps({'state_dir':str(self.root),'google_credentials':'fixture','spreadsheet_id':'sheet','releases_sheet_id':1,
          'publishers':[{'network':'instagram','channel_id':a} for a in ('brand','future-account')],
          'destinations':[{'network':'instagram','account':a} for a in ('brand','future-account')]}))
        calls=[]
        adapter=SimpleNamespace(verify_connection=lambda cfg:{'id':cfg['channel_id'],'name':cfg['channel_id']},schedule=lambda q,key,cfg:calls.append(key) or {'id':'confirmed'})
        native=SimpleNamespace(snapshot=lambda *a:{},verify_preview=lambda *a,**k:True,sync_releases=lambda *a:None)
        with patch.dict('sys.modules',{'buffer_scheduler':adapter}),patch('google_sync.load_credentials',return_value={}),patch('google_sync.GoogleSync',return_value=native),patch('preparation.prepare',return_value={'prepared':[]}):
            report=machine.tick(config)
        self.assertEqual(calls,[future]);self.assertIn('schedule_expired',report['blocker_codes'])

    def test_older_pending_preview_is_checked_even_when_preparation_disabled(self):
        self.package['preview_url']='https://drive.google.com/file/d/fixture/view'
        import hashlib
        self.package['drive_receipt']={'file_id':'fixture','revision_id':'r1','needs_verification':False,'sha256':engine.sha(self.bundle/'asset.mp4'),'md5Checksum':hashlib.md5((self.bundle/'asset.mp4').read_bytes()).hexdigest()}
        key=self.q.enqueue(self.package)
        config=self.root/'config.json';config.write_text(json.dumps({'state_dir':str(self.root),'prepare_enabled':False,'publisher':{'provider':'buffer-mcp','channel_id':'brand'},'google_credentials':'fixture','spreadsheet_id':'sheet','releases_sheet_id':7,'destinations':[{'network':'instagram','account':'brand'}]}))
        adapter=SimpleNamespace(verify_connection=lambda cfg:{'id':'brand','name':'brand'})
        with patch.dict('sys.modules',{'buffer_scheduler':adapter}), patch('google_sync.load_credentials',return_value={}), patch('google_sync.GoogleSync') as google:
            google.return_value.snapshot.return_value={'queue':[]}
            google.return_value.verify_preview.side_effect=ValueError('Changed preview')
            report=machine.tick(config)
            google.return_value.verify_preview.assert_called_once_with(self.bundle/'asset.mp4',self.package['preview_url'],expected_revision_id='r1')
            google.return_value.sync_releases.assert_not_called()
        self.assertIn('preview_mismatch',report['blocker_codes'])
        self.assertEqual(self.q.get(key)['status'],'review')

    def test_canonical_drive_preview_requires_exact_revision_receipt(self):
        self.package['preview_url']='https://drive.google.com/file/d/fixture/view'
        key=self.q.enqueue(self.package)
        with self.assertRaisesRegex(ValueError,'revision receipt'):self.q.approve(key,'owner')
        self.q.db.execute("UPDATE jobs SET status='approved',approval_sha=? WHERE id=?",(key,key))
        with self.assertRaisesRegex(ValueError,'revision receipt'):self.q.submission_package(key)

    def test_preparation_has_no_destinations_until_stable_receipt_exists(self):
        config=self.root/'config.json'
        cfg={'state_dir':str(self.root),'google_credentials':'fixture','spreadsheet_id':'sheet','drive_posts_folder_id':'posts','destinations':[{'network':'instagram','account':'brand'}]}
        config.write_text(json.dumps(cfg));calls=[]
        item={'artifact_id':self.bundle.name,'verification_status':'ready_for_human'}
        receipt={'id':'file','revision_id':'rev','webViewLink':'https://drive.google.com/file/d/file/view'}
        def prepare(current,root):
            calls.append(current)
            if current['destinations']:
                self.assertEqual(current['drive_receipts'][self.bundle.name],receipt)
                self.assertEqual(current['preview_urls'][self.bundle.name],receipt['webViewLink'])
            return {'enabled':True,'prepared':[item],'problems':[]}
        with patch('google_sync.load_credentials',return_value={}),patch('google_sync.GoogleSync') as google,patch('preparation.prepare',side_effect=prepare),patch('drive_assets.store',return_value=receipt) as store:
            google.return_value.snapshot.return_value={}
            machine.tick(config);machine.tick(config)
        self.assertEqual([bool(c['destinations']) for c in calls],[False,True,False,True])
        self.assertEqual(store.call_count,2)

    def test_sfx_manifest_cannot_suppress_listening(self):
        src=self.root/'src';media=self.root/'a.mp4'
        bundle=engine.freeze({'post':{'id':'P004'},'constraints':{'audio':'sfx-only'}},src,media,self.root/'artifacts')
        package=dict(self.package,bundle=str(bundle));package['qa']=dict(package['qa'],artifact_id=bundle.name,listening_required=False)
        key=self.q.enqueue(package)
        with self.assertRaises(ValueError):self.q.approve(key,'owner',False)

    def test_weekly_run_requires_fresh_native_catalog(self):
        config=self.root/'config.json';config.write_text(json.dumps({'state_dir':str(self.root/'weekly'),'auto_plan':True,'launch_through':'2026-11-01','prepare_enabled':True}))
        report=machine.tick(config)
        self.assertIn('fresh_catalog_required',report['blocker_codes'])
        self.assertFalse(report['preparation_ready'])

    def test_past_schedule_blocks_submission(self):
        self.package['scheduled_at']='2020-01-01T19:30:00+02:00';key=self.q.enqueue(self.package);self.q.approve(key,'owner')
        with self.assertRaises(ValueError):self.q.begin_submission(key)

    def test_cancel_unsubmitted_allows_new_reviewed_schedule(self):
        key=self.q.enqueue(self.package);self.q.approve(key,'owner');self.q.cancel(key,'reschedule')
        changed=dict(self.package,scheduled_at='2026-11-18T19:30:00+02:00');new=self.q.enqueue(changed)
        self.assertNotEqual(new,key);self.assertEqual(self.q.get(new)['status'],'review')
        self.assertEqual(self.q.db.execute("SELECT count(*) FROM events WHERE action='cancelled'").fetchone()[0],1)

    def test_conflicting_observation_window_does_not_poison_planner(self):
        key=self.q.enqueue(self.package);self.q.approve(key,'owner');self.q.begin_submission(key)
        self.q.receipt(key,{'package_sha256':key,'network':'instagram','account':'brand','provider':'test','id':'remote','status':'published'})
        row={'provider':'test','network':'instagram','account':'brand','provider_post_id':'remote','artifact_id':self.bundle.name,'window_start':'2026-11-01T00:00:00Z','window_end':'2026-11-08T00:00:00Z','metrics':{'views':10}}
        machine.import_results(self.q,[row]);machine.import_results(self.q,[row])
        with self.assertRaises(ValueError):machine.import_results(self.q,[dict(row,metrics={'views':20})])
        self.assertEqual(self.q.db.execute('SELECT count(*) FROM observations').fetchone()[0],1)

    def test_mutated_media_blocks_submission(self):
        key=self.q.enqueue(self.package);self.q.approve(key,'owner')
        (self.bundle/'asset.mp4').write_bytes(b'changed')
        with self.assertRaises(ValueError):self.q.begin_submission(key)

if __name__=='__main__':unittest.main()
