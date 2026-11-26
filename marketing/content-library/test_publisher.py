from pathlib import Path
import tempfile
import unittest
import publisher
from test_machine import QueueTests

class PublisherTests(QueueTests):
    def test_export_requires_approval_and_prevents_second_submission(self):
        key=self.q.enqueue(self.package)
        with tempfile.TemporaryDirectory() as raw:
            with self.assertRaises(ValueError):publisher.export_submission(self.q,key,raw)
            self.q.approve(key,'owner')
            p=publisher.export_submission(self.q,key,raw)
            self.assertTrue((p/'asset.mp4').exists())
            self.assertEqual(self.q.get(key)['status'],'uncertain')
            with self.assertRaises(ValueError):publisher.export_submission(self.q,key,raw)
    def test_receipt_for_wrong_package_rejected(self):
        key=self.q.enqueue(self.package);self.q.approve(key,'owner');self.q.begin_submission(key)
        with self.assertRaises(ValueError):publisher.import_receipt(self.q,key,{'package_sha256':'wrong','provider':'test','id':'x','status':'scheduled'})

if __name__=='__main__':unittest.main()
