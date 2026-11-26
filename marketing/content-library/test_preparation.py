import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import engine
import preparation
from test_creative_fixtures import tiny_video, attest

class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name).resolve()
        self.verifier=patch('preparation.creative_verification.process_candidate',side_effect=self.verify).start();self.addCleanup(patch.stopall)
        self.snapshot = self.root/'snapshot.json'
        self.snapshot.write_bytes(Path(__file__).with_name('library.json').read_bytes())
        self.cfg = {'prepare_enabled': True, 'snapshot_file': str(self.snapshot), 'requests': [{'post_id': 'P003', 'recipe_id': 'R003', 'template': 'add18-v2', 'parameters': {'start': 36}}], 'slots': ['2035-11-18T19:30:00+02:00'], 'destinations': []}
    def verify(self,bundle,caption,cta,state_dir,**kwargs):
        return {'status':'ready_for_human','bundle':str(bundle),'verification':attest(bundle,caption,cta,state_dir)}
    def tearDown(self): self.tmp.cleanup()
    def render(self, project, media): tiny_video(media)
    def qa(self, bundle):
        m=engine.verify(bundle)
        return {'technical_pass': True, 'artifact_id': m['artifact_id'], 'media_sha256': m['payload']['media']['sha256'], 'listening_required': False}
    def test_disabled_does_not_read_snapshot(self):
        self.assertFalse(preparation.prepare({}, self.root)['enabled'])
    def test_generated_batch_prepares_without_accounts_and_reuses_exact_cache(self):
        with patch('preparation.render', side_effect=self.render) as render, patch('preparation.audio_qa.inspect', side_effect=self.qa):
            first = preparation.prepare(self.cfg,self.root)
            second = preparation.prepare(self.cfg,self.root)
        self.assertEqual(render.call_count,1)
        self.assertEqual(first['prepared'][0]['artifact_id'],second['prepared'][0]['artifact_id'])
        item=first['prepared'][0];review=json.loads(Path(item['review_file']).read_text())
        self.assertEqual(item['jobs'],[])
        self.assertIn('36 + 20 = 56',review['caption'])
        self.assertEqual(review['approval'],'required')
        self.assertTrue(review['cta'])
        (Path(item['bundle'])/'asset.mp4').write_bytes(b'tampered')
        with patch('preparation.render') as render, self.assertRaises(ValueError): preparation.prepare(self.cfg,self.root)
        render.assert_not_called()
    def test_explicit_destinations_enqueue_for_review_only(self):
        self.cfg['destinations']=[{'network':'instagram','account':'test-brand'}]
        with patch('preparation.render', side_effect=self.render), patch('preparation.audio_qa.inspect',side_effect=self.qa):
            initial=preparation.prepare(self.cfg,self.root)
            self.assertEqual(initial['prepared'][0]['jobs'],[])
            self.assertTrue(initial['problems'])
            artifact=initial['prepared'][0]['artifact_id']
            self.cfg['preview_urls']={artifact:'https://example.com/exact-asset.mp4'}
            result=preparation.prepare(self.cfg,self.root)
        import machine
        q=machine.Queue(self.root/'queue.sqlite3');job=q.get(result['prepared'][0]['jobs'][0])
        self.assertEqual(job['status'],'review');self.assertIsNone(job['approval_sha'])
        self.assertEqual(job['package']['preview_url'],'https://example.com/exact-asset.mp4')
        q.db.close()
    def test_seed_keeps_exact_media_and_no_render(self):
        src=self.root/'src';src.mkdir();(src/'index.html').write_text('seed')
        media=self.root/'seed.mp4';tiny_video(media)
        bundle=engine.freeze({'post':{'id':'P002','caption':'accepted exact caption'},'constraints':{'audio':'silent'}},src,media,self.root/'accepted')
        cfg={'prepare_enabled':True,'seed_bundles':[{'bundle':str(bundle),'scheduled_at':'2035-11-15T19:30:00+02:00','cta':'educational'}]}
        with patch('preparation.render') as render,patch('preparation.audio_qa.inspect',side_effect=self.qa): result=preparation.prepare(cfg,self.root)
        render.assert_not_called();review=json.loads(Path(result['prepared'][0]['review_file']).read_text())
        self.assertEqual(review['caption'],'accepted exact caption');self.assertEqual(Path(result['prepared'][0]['bundle']),bundle)
    def test_seed_native_preview_cannot_bypass_exact_artifact_mapping(self):
        src=self.root/'src';src.mkdir();(src/'index.html').write_text('seed')
        media=self.root/'seed.mp4';tiny_video(media)
        bundle=engine.freeze({'post':{'id':'P002','caption':'accepted exact caption','preview':'https://example.com/older-asset.mp4'},'constraints':{'audio':'silent'}},src,media,self.root/'accepted')
        cfg={'prepare_enabled':True,'seed_bundles':[{'bundle':str(bundle),'scheduled_at':'2035-11-15T19:30:00+02:00','cta':'educational'}], 'destinations':[{'network':'instagram','account':'test-brand'}]}
        with patch('preparation.audio_qa.inspect',side_effect=self.qa):
            blocked=preparation.prepare(cfg,self.root)
            self.assertEqual(blocked['prepared'][0]['jobs'],[])
            self.assertTrue(blocked['problems'])
            cfg['preview_urls']={bundle.name:'https://example.com/exact-asset.mp4'}
            result=preparation.prepare(cfg,self.root)
        self.assertEqual(result['prepared'][0]['preview_url'],'https://example.com/exact-asset.mp4')
        self.assertEqual(len(result['prepared'][0]['jobs']),1)

    def test_failed_qa_never_enqueues(self):
        self.cfg['destinations']=[{'network':'instagram','account':'test-brand'}]
        with patch('preparation.render',side_effect=self.render),patch('preparation.audio_qa.inspect',return_value={'technical_pass':False}),self.assertRaises(ValueError): preparation.prepare(self.cfg,self.root)
        self.assertFalse((self.root/'queue.sqlite3').exists())

    def test_failed_creative_review_never_reaches_owner_queue(self):
        self.cfg['destinations']=[{'network':'instagram','account':'test-brand'}]
        self.verifier.side_effect=None;self.verifier.return_value={'status':'needs_human'}
        with patch('preparation.render',side_effect=self.render),patch('preparation.audio_qa.inspect',side_effect=self.qa):result=preparation.prepare(self.cfg,self.root)
        self.assertEqual(result['prepared'][0]['jobs'],[])
        self.assertTrue(result['problems'])
        self.assertFalse((self.root/'queue.sqlite3').exists())
    def test_missing_slots_rejected_before_render(self):
        self.cfg['slots']=[]
        with patch('preparation.render') as render,self.assertRaises(ValueError):preparation.prepare(self.cfg,self.root)
        render.assert_not_called()

    def test_expired_seed_does_not_backfill_a_newly_connected_channel(self):
        src=self.root/'expired-source';src.mkdir();(src/'index.html').write_text('seed')
        media=self.root/'expired.mp4';tiny_video(media)
        bundle=engine.freeze({'post':{'id':'P002','caption':'accepted caption'}},src,media,self.root/'expired-artifacts')
        cfg={'prepare_enabled':True,'seed_bundles':[{'bundle':str(bundle),'scheduled_at':'2020-01-01T19:30:00+02:00','cta':'educational'}],
          'destinations':[{'network':'instagram','account':'new-channel'}],'preview_urls':{bundle.name:'https://example.test/video.mp4'}}
        with patch('preparation.audio_qa.inspect',side_effect=self.qa):result=preparation.prepare(cfg,self.root)
        self.assertEqual(result['prepared'][0]['jobs'],[])

if __name__=='__main__':unittest.main()
