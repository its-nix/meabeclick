import copy
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
import engine
import machine
from test_creative_fixtures import tiny_video, attest
import review_queue

class ReviewQueueTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name).resolve()
        src=self.root/'source';src.mkdir();(src/'index.html').write_text('<html>fixture</html>')
        media=self.root/'media.mp4';tiny_video(media)
        self.bundle=engine.freeze({'post':{'id':'P002'}},src,media,self.root/'artifacts')
        self.q=machine.Queue(self.root/'queue.sqlite3')
        self.package={'bundle':str(self.bundle),'caption':'כמה מלבנים?','cta':'educational','network':'instagram','account':'verified-account','scheduled_at':'2035-11-15T19:30:00+02:00','preview_url':'https://example.test/preview','qa':{'technical_pass':True,'artifact_id':self.bundle.name,'media_sha256':engine.sha(self.bundle/'asset.mp4'),'listening_required':False}}
        self.package['creative_verification']=attest(self.bundle,self.package['caption'],self.package['cta'])
        self.key=self.q.enqueue(self.package)
    def tearDown(self):self.temp.cleanup()
    def test_export_exact_and_no_inferred_approval(self):
        rows=review_queue.release_rows(self.q)
        self.assertEqual(rows[0],review_queue.HEADERS)
        self.assertEqual(rows[1][:3],[self.key,'P002','instagram'])
        self.assertEqual(rows[1][11:],[False,False,'','',''])
        self.assertEqual(review_queue.import_decisions(self.q,rows),[])
        self.assertEqual(self.q.get(self.key)['status'],'review')
    def test_export_validates_shared_media_once_and_approval_checks_again(self):
        sibling = self.q.enqueue({**self.package, 'network':'facebook', 'account':'page'})
        with patch('review_queue.creative_verification.require', wraps=review_queue.creative_verification.require) as verify:
            rows = review_queue.release_rows(self.q)
            self.assertEqual({r[0]:r[9] for r in rows[1:]}, {self.key:'Pass',sibling:'Pass'})
            self.assertEqual(verify.call_count,1)
            self.q.approve(sibling,'owner')
            self.assertEqual(verify.call_count,2)
            self.assertEqual(self.q.get(sibling)['status'],'approved')

    def test_export_checks_same_video_with_different_caption_separately(self):
        sibling = self.q.enqueue({**self.package, 'network':'facebook', 'account':'page',
                                  'caption':'Changed after creative review'})
        rows = review_queue.release_rows(self.q)
        self.assertEqual({r[0]:r[9] for r in rows[1:]}, {self.key:'Pass',sibling:'Blocked'})

    def test_export_skips_video_validation_already_blocked_by_feedback(self):
        rows = review_queue.release_rows(self.q)
        rows[1][13]='Needs clarification'
        review_queue.feedback.scan(self.q, rows)
        with patch('review_queue.creative_verification.require') as verify:
            self.assertEqual(review_queue.release_rows(self.q)[1][9],'Blocked')
            verify.assert_not_called()

    def test_exact_approval_and_idempotent_reimport(self):
        rows=review_queue.release_rows(self.q);rows[1][11]='Approved'
        self.assertEqual(review_queue.import_decisions(self.q,rows),[self.key])
        self.assertEqual(self.q.get(self.key)['approval_sha'],self.key)
        self.assertEqual(review_queue.import_decisions(self.q,rows),[self.key])
    def test_confirmed_buffer_receipt_is_visible_in_worker_status(self):
        self.q.policy['credentials_healthy']=True;self.q.approve(self.key,'owner');self.q.begin_submission(self.key)
        self.q.receipt(self.key,{'provider':'buffer-mcp','id':'provider-post','status':'scheduled','package_sha256':self.key,'network':'instagram','account':'verified-account'})
        row=review_queue.release_rows(self.q)[1]
        self.assertEqual(row[14],'Scheduled');self.assertIn('Buffer confirmed',row[15])

    def test_owner_can_revoke_approved_release(self):
        rows=review_queue.release_rows(self.q);rows[1][11]='Approved';review_queue.import_decisions(self.q,rows)
        rows[1][11]='Change';review_queue.import_decisions(self.q,rows)
        self.assertEqual(self.q.get(self.key)['status'],'review')
        self.assertIsNone(self.q.get(self.key)['approval_sha'])

    def test_uncertain_approval_reimport_preserves_intent_without_resubmitting(self):
        rows=review_queue.release_rows(self.q);rows[1][11]=True
        review_queue.import_decisions(self.q,rows)
        self.q.policy['credentials_healthy']=True;self.q.begin_submission(self.key)
        self.assertEqual(review_queue.import_decisions(self.q,rows),[self.key])
        self.assertEqual(self.q.get(self.key)['status'],'uncertain')
        self.assertEqual(self.q.db.execute("SELECT count(*) FROM events WHERE action='submission_intent'").fetchone()[0],1)

    def test_checkbox_approves_and_unchecking_revokes_exact_package(self):
        rows=review_queue.release_rows(self.q);rows[1][11]=True
        self.assertEqual(review_queue.import_decisions(self.q,rows),[self.key])
        self.assertEqual(self.q.get(self.key)['status'],'approved')
        rows[1][11]=False;review_queue.import_decisions(self.q,rows)
        self.assertEqual(self.q.get(self.key)['status'],'review')
        self.assertIsNone(self.q.get(self.key)['approval_sha'])

    def test_numeric_or_string_checks_are_not_checkbox_approval(self):
        for value in (1,0,'TRUE','true','✓','V'):
            rows=review_queue.release_rows(self.q);rows[1][11]=value
            with self.assertRaises(ValueError):review_queue.import_decisions(self.q,rows)
        self.assertEqual(self.q.get(self.key)['status'],'review')

    def test_version_label_comes_from_exact_frozen_title(self):
        import json
        src=self.bundle/'source';media=self.bundle/'asset.mp4'
        bundle=engine.freeze({'post':{'id':'P002','title':'Rectangle challenge v2'}},src,media,self.root/'artifacts')
        key=self.q.enqueue(dict(self.package,bundle=str(bundle)))
        row=next(row for row in review_queue.release_rows(self.q)[1:] if row[0]==key)
        self.assertEqual(row[1],'Rectangle challenge v2')

    def test_scheduled_approval_reimport_is_idempotent(self):
        rows=review_queue.release_rows(self.q);rows[1][11]='Approved';review_queue.import_decisions(self.q,rows)
        self.q.policy['credentials_healthy']=True;self.q.begin_submission(self.key)
        self.q.receipt(self.key,{'package_sha256':self.key,'network':'instagram','account':'verified-account','provider':'test','id':'real1','status':'scheduled'})
        self.assertEqual(review_queue.import_decisions(self.q,rows),[self.key])
        self.assertEqual(self.q.get(self.key)['status'],'scheduled')
        rows[1][11]='Change'
        with self.assertRaises(ValueError):review_queue.import_decisions(self.q,rows)

    def test_each_immutable_column_blocks_approval(self):
        for index in range(11):
            rows=review_queue.release_rows(self.q);rows[1][11]='Approved';rows[1][index]='changed'
            with self.assertRaises(ValueError):review_queue.import_decisions(self.q,rows)
        self.assertEqual(self.q.get(self.key)['status'],'review')
    def test_audio_requires_exact_yes(self):
        package=copy.deepcopy(self.package);package['network']='facebook';package['qa']['listening_required']=True
        key=self.q.enqueue(package);rows=review_queue.release_rows(self.q)
        row=next(row for row in rows[1:] if row[0]==key);row[11]='Approved'
        for value in ('','No','yes',1):
            row[12]=value
            with self.assertRaises(ValueError):review_queue.import_decisions(self.q,rows)
        row[12]='Yes';self.assertEqual(review_queue.import_decisions(self.q,rows),[key])
        self.assertEqual(self.q.get(key)['listened'],1)

    def test_audio_listening_checkbox_is_supported(self):
        package=copy.deepcopy(self.package);package['qa']['listening_required']=True
        self.q.cancel(self.key,'audio fixture');key=self.q.enqueue(package)
        rows=review_queue.release_rows(self.q);rows[1][11]=True;rows[1][12]=True
        self.assertEqual(review_queue.import_decisions(self.q,rows),[key])
        self.assertEqual(self.q.get(key)['listened'],1)
    def test_invalid_batch_prevalidated_before_any_approval(self):
        package=dict(self.package,network='facebook');self.q.enqueue(package)
        rows=review_queue.release_rows(self.q)
        for row in rows[1:]:row[11]='Approved'
        rows[2][5]='tampered caption'
        with self.assertRaises(ValueError):review_queue.import_decisions(self.q,rows)
        self.assertTrue(all(r['status']=='review' for r in self.q.rows()))
    def test_duplicate_and_media_mutation(self):
        rows=review_queue.release_rows(self.q);rows.append(rows[1].copy())
        with self.assertRaises(ValueError):review_queue.import_decisions(self.q,rows)
        rows=review_queue.release_rows(self.q);rows[1][11]='Approved';(self.bundle/'asset.mp4').write_bytes(b'changed')
        with self.assertRaises(ValueError):review_queue.import_decisions(self.q,rows)
    def test_no_preview_is_not_a_review_package(self):
        package=dict(self.package,network='facebook');package.pop('preview_url');self.q.enqueue(package)
        with self.assertRaises(ValueError):review_queue.release_rows(self.q)

if __name__=='__main__':unittest.main()
