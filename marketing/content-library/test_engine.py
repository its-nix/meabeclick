import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SPEC=importlib.util.spec_from_file_location('engine',Path(__file__).with_name('engine.py'))
engine=importlib.util.module_from_spec(SPEC) if SPEC else None
if SPEC and SPEC.loader and Path(SPEC.origin).exists():SPEC.loader.exec_module(engine)

class EngineTests(unittest.TestCase):
    def test_missing_engine_is_not_a_passing_check(self):
        self.assertTrue(hasattr(engine,'resolve_job'),'Content engine has not been implemented')

    def seed(self):
        return json.loads(Path(__file__).with_name('library.json').read_text())

    def test_pinned_revision_and_compatibility(self):
        data=self.seed();job=engine.resolve_job(data,'P002',[])
        self.assertEqual(job['recipe'][0],'R002')
        bad=copy.deepcopy(data);bad['recipes'][2][3]='H003@99'
        with self.assertRaises(ValueError):engine.resolve_job(bad,'P002',[])
        bad=copy.deepcopy(data);bad['recipes'][2][3]='H004@1'
        with self.assertRaises(ValueError):engine.resolve_job(bad,'P002',[])

    def test_reference_retrieval_keeps_owner_reactions(self):
        refs=[{'id':'REF01','audience':'Families','components':['H003'],'mechanism':'count hidden sizes','owner_reaction':'Not reviewed'}, {'id':'REF02','audience':'Teens','components':['H999'],'mechanism':'algebra','owner_reaction':'Not reviewed'}]
        job=engine.resolve_job(self.seed(),'P002',refs)
        self.assertEqual([r['id'] for r in job['references']],['REF01'])
        self.assertEqual(job['references'][0]['owner_reaction'],'Not reviewed')

    def test_untrusted_ids_cannot_become_filesystem_paths(self):
        data=self.seed();data['queue'][0]['id']='../../escape';data['recipes'][0][1]='../../escape'
        with self.assertRaises(ValueError):engine.resolve_job(data,'../../escape',[])

    def test_review_cap_and_failure_are_recorded(self):
        self.assertTrue(hasattr(engine,'review_loop'),'Bounded director coordinator is missing')
        reports=[]
        def review(artifact):
            reports.append(artifact)
            return {'artifact_id':artifact,'verdict':'revise','checks':{k:'fail' for k in engine.CRITERIA},'findings':[{'severity':'P0','time_seconds':2,'issue':'Wrong','change':'Fix'}],'patches':[{'path':'index.html','before':'6','after':'5'}],'summary':'Fix answer'}
        result=engine.review_loop('a',review,lambda artifact,report:artifact+'x',2)
        self.assertEqual(reports,['a','ax','axx']);self.assertEqual(result['status'],'needs_human');self.assertEqual(result['revisions'],2)
        with self.assertRaises(ValueError):engine.review_loop('a',review,lambda a,r:a,3)
        def broken(_):raise TimeoutError('worker timed out')
        result=engine.review_loop('a',broken,lambda a,r:a,2)
        self.assertEqual(result['status'],'needs_human');self.assertIn('timed out',result['error'])

    def test_freeze_deduplicates_and_detects_source_media_copy_changes(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d).resolve();project=root/'project';project.mkdir();(project/'index.html').write_text('<p>5</p>');media=root/'video.mp4';media.write_bytes(b'video-one');out=root/'out'
            job=engine.resolve_job(self.seed(),'P002',[])
            a=engine.freeze(job,project,media,out);b=engine.freeze(job,project,media,out)
            self.assertEqual(a,b)
            job['post']['caption']='Changed caption';self.assertNotEqual(a,engine.freeze(job,project,media,out))
            (project/'index.html').write_text('<p>6</p>');self.assertNotEqual(a,engine.freeze(engine.resolve_job(self.seed(),'P002',[]),project,media,out))
            media.write_bytes(b'video-two');self.assertNotEqual(a,engine.freeze(engine.resolve_job(self.seed(),'P002',[]),project,media,out))
            (a/'asset.mp4').write_bytes(b'tampered')
            with self.assertRaises(ValueError):engine.freeze(engine.resolve_job(self.seed(),'P002',[]),a/'source',a/'asset.mp4',out)

    def test_artifact_verification_rejects_tampering(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d).resolve();(p/'project').mkdir();(p/'project/index.html').write_text('hello');(p/'video').write_bytes(b'video')
            a=engine.freeze(engine.resolve_job(self.seed(),'P002',[]),p/'project',p/'video',p/'out');(a/'source/index.html').write_text('modified')
            with self.assertRaises(ValueError):engine.verify(a)

    def test_rehashed_manifest_cannot_keep_the_old_artifact_directory(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d).resolve();(p/'project').mkdir();(p/'project/index.html').write_text('hello');(p/'video').write_bytes(b'video')
            a=engine.freeze(engine.resolve_job(self.seed(),'P002',[]),p/'project',p/'video',p/'out');m=json.loads((a/'manifest.json').read_text());m['payload']['job']['post']['caption']='Different content';m['artifact_id']=engine.artifact_identity(m['payload']);(a/'manifest.json').write_text(json.dumps(m))
            with self.assertRaises(ValueError):engine.verify(a)

    def test_patch_is_exact_scoped_and_never_mutates_source(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d).resolve();src=p/'source';src.mkdir();(src/'index.html').write_text('<p>Wrong: 6</p>')
            engine.apply_patches(src,p/'next',[{'path':'index.html','before':'Wrong: 6','after':'Correct: 5'}])
            self.assertIn('Wrong: 6',(src/'index.html').read_text());self.assertIn('Correct: 5',(p/'next/index.html').read_text())
            for patch in [{'path':'../index.html','before':'Wrong: 6','after':'5'},{'path':'index.html','before':'Wrong: 6','after':'<script>fetch("https://evil")</script>'},{'path':'index.html','before':'not present','after':'5'}]:
                with self.assertRaises(ValueError):engine.apply_patches(src,p/'bad', [patch])

    def test_pass_requires_all_checks_and_no_findings_or_patches(self):
        report={'artifact_id':'abc','verdict':'pass','checks':{k:'pass' for k in engine.CRITERIA},'findings':[],'patches':[],'summary':'Reads clearly'}
        self.assertEqual(engine.validate_review(report,'abc')['verdict'],'pass')
        for change in [{'checks':{**report['checks'],'math':'unverified'}},{'findings':[{'severity':'P0','time_seconds':1,'issue':'Wrong math','change':'Fix'}]},{'artifact_id':'other'}]:
            with self.assertRaises(ValueError):engine.validate_review({**report,**change},'abc')

    def test_writeback_preserves_human_fields_and_checks_row_identity(self):
        row=['P002','Title','old-preview','caption','Approve','Do not change this','Day 3','goal','Review','alt','Riddle']
        result=engine.queue_patch(row,'artifact','manifest',['REF01'],'Ready for review')
        self.assertEqual(result['start_column'],11)
        self.assertEqual(row[4:6],['Approve','Do not change this'])
        with self.assertRaises(ValueError):engine.check_queue_guard(row,[*row[:4],'Change',*row[5:]])
        bound=row+['old-artifact','old-manifest','REF01','Ready for human review','','']
        patch=engine.queue_patch(bound,'new-artifact','new-manifest',['REF02'],'Ready for human review',candidate_preview='new-preview')
        self.assertEqual(patch['values'][:4],bound[11:15]);self.assertEqual(patch['values'][4:],['new-artifact','new-preview'])
        with self.assertRaises(ValueError):engine.queue_patch(bound,'new-artifact','new-manifest',['REF02'],'Ready for human review')

    def test_native_snapshot_uses_live_caption_and_owner_reaction(self):
        self.assertTrue(hasattr(engine,'snapshot_from_cells'),'Live snapshot adapter missing')
        def sheet(name,rows):return {'properties':{'title':name},'data':[{'startRow':4,'rowData':[{'values':[{'userEnteredValue':{'stringValue':v}} for v in row]} for row in rows]}]}
        data=self.seed();q=data['queue'][1]
        payload={'sheets':[sheet('Queue',[['Post ID','Title','Preview','Caption','Decision','Feedback','Proposed slot','Purpose','Status','Accessible description','Format'],['P002',q['title'],'drive','Live changed caption','Change','Keep the pause','Day 3',q['goal'],'Review',q['alt'],'Riddle']]),sheet('Components',[['ID'],*data['components']]),sheet('Recipes',[['Recipe ID'],data['recipes'][2]]),sheet('References',[['Reference ID'],['REF01','Title','source','0–1s','Families','Counting','Use','Avoid','Owner correction','H003']])]}
        snapshot=engine.snapshot_from_cells(payload,'W001',{'P002':'riddle-squares'})
        self.assertEqual(snapshot['queue'][0]['caption'],'Live changed caption');self.assertEqual(snapshot['queue'][0]['feedback'],'Keep the pause');self.assertEqual(snapshot['references'][0]['owner_reaction'],'Owner correction')
        payload['sheets'][0]['data'][0]['rowData'][1]['values'].append({'userEnteredValue':{'formulaValue':'=IF(TRUE,"","")'}})
        self.assertEqual(engine.snapshot_from_cells(payload,'W001')['queue'][0]['caption'],'Live changed caption')

    def test_owner_feedback_reaches_the_frozen_brief(self):
        data=self.seed();a=engine.resolve_job(data,'P002',[]);data['queue'][1]['feedback']='Hold the question longer';b=engine.resolve_job(data,'P002',[])
        self.assertNotEqual(a,b);self.assertIn('Hold the question longer',json.dumps(b))

    def test_symlink_ancestors_are_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d).resolve();(p/'real/project').mkdir(parents=True);(p/'real/project/index.html').write_text('hello');(p/'video').write_bytes(b'video');(p/'alias').symlink_to(p/'real',target_is_directory=True)
            with self.assertRaises(ValueError):engine.freeze(engine.resolve_job(self.seed(),'P002',[]),p/'alias/project',p/'video',p/'out')

    def test_patch_cannot_add_markup_css_resources_or_js_expressions(self):
        html='<style>#x{font-size:70px;background-color:#fff}</style><div id="x">Total: 6</div><script>tl.to("#x",{opacity:1,duration:.3},0);</script>'
        unsafe=[('Total: 6','<img src="//example.com/pixel">'),('background-color:#fff','background-color:url(//example.com/pixel)'),('opacity:1',"opacity:(navigator.sendBeacon('//example.com/pixel','x'),1)")]
        with tempfile.TemporaryDirectory() as d:
            p=Path(d).resolve();src=p/'source';src.mkdir();(src/'index.html').write_text(html)
            for i,(before,after) in enumerate(unsafe):
                with self.assertRaises(ValueError):engine.apply_patches(src,p/f'bad{i}',[{'path':'index.html','before':before,'after':after}])
            engine.apply_patches(src,p/'good',[{'path':'index.html','before':'<div id="x">Total: 6</div>','after':'<div id="x">Total: 5</div>'},{'path':'index.html','before':'font-size:70px','after':'font-size:80px'},{'path':'index.html','before':'duration:.3','after':'duration:.6'}])
            self.assertIn('Total: 5',(p/'good/index.html').read_text())

    def test_cached_aggregate_revalidates_reviews_chain_policy_and_budget(self):
        self.assertTrue(hasattr(engine,'validate_result'),'Aggregate validator missing')
        report={'artifact_id':'a','verdict':'pass','checks':{k:'pass' for k in engine.CRITERIA},'findings':[],'patches':[],'summary':'Fine'}
        valid={'status':'ready_for_human','root_artifact':'a','artifact_id':'a','policy_sha256':'policy','max_revisions':2,'revisions':0,'attempts':[{'artifact_id':'a','review':report}],'owner_approved':False}
        lookup=lambda identity:{'artifact_id':identity,'payload':{'parent_artifact':None}}
        engine.validate_result(valid,'a','policy',2,lookup)
        for change in [{'attempts':[]},{'policy_sha256':'old'},{'max_revisions':0},{'revisions':2},{'artifact_id':'other'}]:
            with self.assertRaises(ValueError):engine.validate_result({**valid,**change},'a','policy',2,lookup)
        bad=copy.deepcopy(valid);bad['attempts'][0]['review']['checks']['math']='unverified'
        with self.assertRaises(ValueError):engine.validate_result(bad,'a','policy',2,lookup)

if __name__=='__main__':unittest.main()
