import copy
import json
from pathlib import Path
import tempfile
import unittest
import factory

class FactoryTests(unittest.TestCase):
    def setUp(self):
        self.data=json.loads((Path(__file__).parent/'library.json').read_text())
    def request(self,**kw):
        return dict(post_id='P003',recipe_id='R003',template='add18-v2',**kw)
    def test_bounds_and_dedup(self):
        r=self.request(parameters={'start':36})
        self.assertEqual(len(factory.plan_batch(self.data,[r,r])),1)
        with self.assertRaises(ValueError):factory.plan_batch(self.data,[r]*21)
        with self.assertRaises(ValueError):factory.plan_batch(self.data,[self.request(parameters={'start':True})])
    def test_math_and_escape(self):
        plan=factory.plan_batch(self.data,[self.request(parameters={'start':36},copy={'cta':'<script>"&שלום'})])[0]
        with tempfile.TemporaryDirectory() as raw:
            d=str(Path(raw).resolve())
            p=factory.generate_project(plan,d)
            html=(p/'compositions/lesson.html').read_text()
            self.assertIn('36 + 20 = 56',html)
            self.assertIn('56 − 2 = 54',html)
            self.assertIn('&lt;script&gt;&quot;&amp;שלום',html)
            self.assertNotIn('>27<',html)
            self.assertEqual(p,factory.generate_project(plan,d))
            (p/'index.html').write_text('tamper')
            with self.assertRaises(ValueError):factory.generate_project(plan,d)
    def test_compatibility_and_contract(self):
        for changes in ({'template':'parent-paper'},{'parameters':{'addend':19}},{'copy':{'madeup':'x'}},{'series':'fake'}):
            r=self.request();r.update(changes)
            with self.assertRaises(ValueError):factory.plan_batch(self.data,[r])
        bad=copy.deepcopy(self.data);bad['components'][7][6]='99'
        with self.assertRaises(ValueError):factory.plan_batch(bad,[self.request()])
    def test_parent_and_rectangles(self):
        requests=[dict(post_id='P001',recipe_id='R001',template='parent-paper',parameters={'start':52}),dict(post_id='P002',recipe_id='R002',template='rectangle-v2')]
        plans=factory.plan_batch(self.data,requests)
        with tempfile.TemporaryDirectory() as raw:
            d=str(Path(raw).resolve())
            p=factory.generate_project(plans[0],d);html=(p/'index.html').read_text()
            self.assertIn('52 − 17 = <strong>35</strong>',html)
            self.assertNotIn('<audio',html)
            p=factory.generate_project(plans[1],d)
            self.assertIn('18 מלבנים.',(p/'compositions/lesson.html').read_text())
    def test_parent_substitution_does_not_rewrite_new_results(self):
        for start in (20,42,49,59,79):
            request=dict(post_id='P001',recipe_id='R001',template='parent-paper',parameters={'start':start})
            plan=factory.plan_batch(self.data,[request])[0]
            with tempfile.TemporaryDirectory() as raw:
                p=factory.generate_project(plan,str(Path(raw).resolve()))
                self.assertIn(f'{start} − 17 = <strong>{start-17}</strong>',(p/'index.html').read_text())

    def test_identity_tracks_caption_and_source(self):
        a=factory.plan_batch(self.data,[self.request()])[0]
        self.data['queue'][2]['caption']='Changed native caption'
        b=factory.plan_batch(self.data,[self.request()])[0]
        self.assertNotEqual(a['plan_id'],b['plan_id'])
        with tempfile.TemporaryDirectory() as raw:
            d=str(Path(raw).resolve())
            p=factory.generate_project(a,d);media=Path(d)/'fake.mp4';media.write_bytes(b'fixture')
            bundle=factory.freeze_generated(a,p,media,Path(d)/'artifacts')
            import engine
            self.assertEqual(engine.verify(bundle)['payload']['job']['factory']['plan_id'],a['plan_id'])

if __name__=='__main__':unittest.main()
