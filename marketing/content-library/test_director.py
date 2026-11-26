import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

import engine

class DirectorIntegrationTests(unittest.TestCase):
    def test_repair_rechecks_exact_candidate_and_keeps_both_artifacts(self):
        # A deterministic worker fixture exercises the same coordinator contract;
        # the real model's wrong-answer repair is separately verified end to end.
        with tempfile.TemporaryDirectory() as d:
            p=Path(d).resolve();project=p/'project';project.mkdir();(project/'index.html').write_text('<p>Count: 6</p>');media=p/'video';media.write_bytes(b'original')
            data=json.loads(Path(__file__).with_name('library.json').read_text());job=engine.resolve_job(data,'P002',[]);root=engine.freeze(job,project,media,p/'artifacts');seen=[]
            def review(identity):
                bundle=p/'artifacts'/identity;engine.verify(bundle);seen.append(identity)
                good='Count: 5' in (bundle/'source/index.html').read_text()
                return {'artifact_id':identity,'verdict':'pass' if good else 'revise','checks':{k:'pass' if good else 'fail' for k in engine.CRITERIA},'findings':[] if good else [{'severity':'P0','time_seconds':9,'issue':'Count is6','change':'Count all five squares'}],'patches':[] if good else [{'path':'index.html','before':'Count: 6','after':'Count: 5'}],'summary':'Correct' if good else 'Wrong answer'}
            def revise(identity,report):
                source=p/'artifacts'/identity/'source';dest=p/'candidate';engine.apply_patches(source,dest,report['patches']);media=p/'new-video';media.write_bytes(b'rendered-five')
                return engine.freeze(job,dest,media,p/'artifacts',parent=identity).name
            result=engine.review_loop(root.name,review,revise)
            self.assertEqual(result['status'],'ready_for_human');self.assertEqual(result['revisions'],1);self.assertNotEqual(seen[0],seen[1]);self.assertIn('Count: 6',(root/'source/index.html').read_text());self.assertEqual(engine.verify(p/'artifacts'/seen[1])['payload']['parent_artifact'],root.name)

    def test_source_symlinks_are_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d).resolve();(p/'project').mkdir();(p/'project/index.html').write_text('5');(p/'private').write_text('secret');(p/'project/link').symlink_to(p/'private')
            with self.assertRaises(ValueError):engine.source_files(p/'project')

if __name__=='__main__':unittest.main()
