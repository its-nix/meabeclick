import copy
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import audio_qa
import creative_verification as cv
import engine
import feedback_repair as fr
from test_creative_fixtures import passing_reviewer


class PreferencesTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name).resolve();self.project=self.root/'project';self.project.mkdir()
        (self.project/'index.html').write_text('<style>#root{position:absolute;inset:0}#brand{left:100px;top:198px;width:820px}#stage{left:120px;top:640px;width:780px}#child{left:4px;top:4px}</style><div id="root" data-duration="2"><div id="brand">brand</div><div id="stage"><div id="child">nested</div></div></div><script>gsap.to("#stage",{y:20});</script>')
        self.job={'post':{'id':'P001','caption':'כמה מלבנים? מאה בקליק'},'constraints':{'audio':'silent'}}
    def test_center_only_outer_layout_preserves_gsap_and_idempotence(self):
        rules=[{'scope':'global','rule':fr.CENTER_RULE}]
        job=fr.apply_preferences(self.project,self.job,rules)
        text=(self.project/'index.html').read_text();self.assertIn('left:130px;top:408px',text);self.assertIn('#child{left:4px;top:4px}',text);self.assertIn('{y:20}',text)
        hashes=engine.source_files(self.project);self.assertEqual(job,fr.apply_preferences(self.project,self.job,rules));self.assertEqual(hashes,engine.source_files(self.project))
        self.assertEqual(job['rule_snapshot'],rules);self.assertEqual(self.job['constraints']['audio'],'silent')
    def test_caption_rule_and_original_score_are_data_bound(self):
        rules=[{'scope':'global','rule':fr.MUSIC_RULE},{'scope':'format','format_id':'rectangle-v2','rule':fr.CAPTION_RULE}]
        job=fr.apply_preferences(self.project,self.job,rules)
        self.assertEqual(job['post']['caption'],'כמה מלבנים?');self.assertEqual(job['constraints']['audio'],'music')
        asset=job['audio_assets'][0];self.assertNotIn('source',asset);self.assertNotIn('licenseUrl',asset)
        second=self.root/'same.wav';audio_qa.synthesize(second,2);self.assertEqual(engine.sha(second),asset['sha256'])
    def test_interpreter_receives_factory_or_post_format(self):
        media=self.root/'media.mp4';media.write_bytes(b'not-rendered')
        for factory_template in (None,'rectangle-v2'):
            job=copy.deepcopy(self.job);job['post']['format']='native-format'
            if factory_template:job['factory']={'template':factory_template}
            bundle=engine.freeze(job,self.project,media,self.root/'artifacts')
            package={'bundle':str(bundle),'caption':'caption','cta':'educational'}
            with patch.object(cv,'_codex_review',return_value={'status':'held'}) as producer:
                fr._interpret(source=[],feedback_text='feedback',rules=[],package=package)
                self.assertEqual(producer.call_args.kwargs['context']['format_id'],factory_template or 'native-format')

    def test_critic_rules_strip_origin_rationale(self):
        rules=[{'id':'r1','rule_id':'r1','scope':'global','rule':fr.CENTER_RULE,
                'origin':{'comment':'previous defect rationale'},'comment':'private feedback','supersedes':['old']}]
        public=cv._public_rules(rules)
        self.assertEqual(public,[{'id':'r1','rule_id':'r1','scope':'global','rule':fr.CENTER_RULE}])
        self.assertIn('origin',rules[0])

    def test_negative_or_unknown_music_rule_never_adds_music(self):
        for rule in ('Do not add music.','Music is distracting.','Keep content off-center.'):
            with self.subTest(rule=rule):
                project=self.root/str(len(list(self.root.iterdir())));shutil.copytree(self.project,project)
                job=fr.apply_preferences(project,self.job,[{'scope':'global','rule':rule}])
                self.assertEqual(job['constraints']['audio'],'silent')
                self.assertIn('left:100px;top:198px',(project/'index.html').read_text())

    def test_external_css_inherited_centering_defers_to_encoded_review(self):
        source=Path(fr.__file__).parent/'posts/ad-parent-paper-sfx'
        project=self.root/'parent-paper';shutil.copytree(source,project)
        explicit=self.root/'parent-explicit';shutil.copytree(source,explicit)
        before=engine.source_files(project)
        rules=[{'scope':'global','rule':fr.CENTER_RULE}]
        job=fr.apply_preferences(project,self.job,rules)
        self.assertTrue(job['constraints']['centering_review_required'])
        self.assertEqual(job['rule_snapshot'],rules)
        self.assertEqual(before,[r for r in engine.source_files(project) if r['path']!='preferences-applied.json'])
        after=engine.source_files(project)
        self.assertEqual(job,fr.apply_preferences(project,self.job,rules))
        self.assertEqual(after,engine.source_files(project))
        with self.assertRaisesRegex(ValueError,'No supported outer layout coordinates'):
            fr.apply_preferences(explicit,self.job,rules,actions={'center':True,'music':'preserve','caption_suffix':'preserve'})
        other=self.root/'other';shutil.copytree(self.project,other)
        with patch.object(fr,'center_layout',side_effect=ValueError('Unsafe deterministic layout edit')):
            with self.assertRaisesRegex(ValueError,'Unsafe deterministic layout edit'):
                fr.apply_preferences(other,self.job,rules)

    def test_frozen_source_cannot_be_modified(self):
        media=self.root/'media.mp4';media.write_bytes(b'not-rendered')
        bundle=engine.freeze(self.job,self.project,media,self.root/'artifacts')
        with self.assertRaises(ValueError):fr.apply_preferences(bundle/'source',self.job,[])
    def test_unsupported_feedback_holds_and_no_retry(self):
        media=self.root/'media.mp4';media.write_bytes(b'not-rendered');bundle=engine.freeze(self.job,self.project,media,self.root/'artifacts');calls=[]
        def interpreter(**kw):calls.append(kw);return {'status':'held'}
        args=({'bundle':str(bundle),'caption':'text','cta':'educational'},'Add a live actor',[],self.root/'state')
        result=fr.repair(*args,feedback_id='feedback1',interpreter=interpreter)
        self.assertEqual(result['status'],'held');fr.repair(*args,feedback_id='feedback1',interpreter=lambda **kw:self.fail('retried'))
        self.assertEqual(len(calls),1);self.assertEqual(engine.verify(bundle)['artifact_id'],bundle.name)
    def test_interrupted_producer_never_restarts_and_mixed_unsupported_holds(self):
        media=self.root/'media.mp4';media.write_bytes(b'not-rendered');bundle=engine.freeze(self.job,self.project,media,self.root/'artifacts')
        package={'bundle':str(bundle),'caption':'caption','cta':'educational'};calls=[]
        def interpreter(**kw):
            calls.append(kw);return {'status':'held','actions':{'center':True,'music':'add','caption_suffix':'preserve'}}
        result=fr.repair(package,'Center and add music and a live actor',[],self.root/'state',feedback_id='mixed',interpreter=interpreter,renderer=lambda *args:self.fail('unsupported work rendered'))
        self.assertEqual(result['status'],'held');self.assertEqual(len(calls),1)
        fr.repair(package,'Center and add music and a live actor',[],self.root/'state',feedback_id='mixed',interpreter=lambda **kw:self.fail('retried'))
        directory=next((self.root/'state').iterdir());(directory/'result.json').unlink()
        result=fr.repair(package,'Center and add music and a live actor',[],self.root/'state',feedback_id='mixed',interpreter=lambda **kw:self.fail('interrupted work retried'))
        self.assertEqual(result['status'],'held')

    def test_changed_producer_prompt_invalidates_repair_cache(self):
        media=self.root/'media.mp4';media.write_bytes(b'not-rendered');bundle=engine.freeze(self.job,self.project,media,self.root/'artifacts')
        package={'bundle':str(bundle),'caption':'caption','cta':'educational'};calls=[]
        def interpreter(**kw):calls.append(kw);return {'status':'held'}
        fr.repair(package,'unsupported',[],self.root/'state',feedback_id='policy',interpreter=interpreter)
        original_sha=engine.sha
        def altered_sha(path):
            return '0'*64 if Path(path).name=='feedback-repair-prompt.md' else original_sha(path)
        with patch.object(engine,'sha',side_effect=altered_sha):
            fr.repair(package,'unsupported',[],self.root/'state',feedback_id='policy',interpreter=interpreter)
        self.assertEqual(len(calls),2)
        self.assertEqual(len(list((self.root/'state').iterdir())),2)

    def test_binary_appledouble_preserved_but_never_read_as_html(self):
        binary=b'\x00\x05\x16\x07\xff\xfeMac metadata'
        (self.project/'._index.html').write_bytes(binary)
        (self.project/'compositions').mkdir()
        (self.project/'compositions/._lesson.html').write_bytes(binary)
        media=self.root/'media.mp4';media.write_bytes(b'not-rendered')
        bundle=engine.freeze(self.job,self.project,media,self.root/'artifacts')
        self.assertIn('._index.html',[r['path'] for r in engine.verify(bundle)['payload']['source_files']])
        package={'bundle':str(bundle),'caption':'caption','cta':'educational'};calls=[]
        def interpreter(**kw):
            calls.append(kw)
            self.assertEqual([r['path'] for r in kw['source']],['index.html'])
            return {'status':'repair','actions':{'center':True,'music':'preserve','caption_suffix':'preserve'},'learnings':[],'summary':'Centered content.'}
        def render(project,output):
            self.assertEqual((project/'._index.html').read_bytes(),binary)
            self.assertEqual((project/'compositions/._lesson.html').read_bytes(),binary)
            self.assertIn('left:130px;top:408px',(project/'index.html').read_text())
            output.write_bytes(b'new-render')
        def verify(child,caption,cta,state_dir,**kw):
            return {'status':'ready_for_human','bundle':str(child),'verification':{'path':'test','sha256':'test'}}
        with patch.object(fr,'measure_center',return_value=(30,210)),patch.object(audio_qa,'inspect',return_value={'listening_required':False}),patch.object(cv,'process_candidate',side_effect=verify):
            result=fr.repair(package,'Center content',[],self.root/'state',feedback_id='appledouble',interpreter=interpreter,renderer=render)
        self.assertEqual(result['status'],'ready_for_human');self.assertEqual(len(calls),1)
        self.assertEqual((bundle/'source/._index.html').read_bytes(),binary)
        engine.verify(bundle)

    def test_repair_child_caption_origin_and_two_correction_budget(self):
        media=self.root/'media.mp4';media.write_bytes(b'not-rendered');bundle=engine.freeze(self.job,self.project,media,self.root/'artifacts')
        package={'bundle':str(bundle),'caption':self.job['post']['caption'],'cta':'educational','approval':True,'preview_url':'old'}
        def render(project,output):output.write_bytes(b'new-render')
        def verify(child,caption,cta,state_dir,**kw):
            self.assertEqual(kw['max_revisions'],1)
            return {'status':'ready_for_human','bundle':str(child),'verification':{'path':'test','sha256':'test'}}
        with patch.object(audio_qa,'inspect',return_value={'listening_required':False}),patch.object(cv,'process_candidate',side_effect=verify):
            result=fr.repair(package,'Do not end caption with business name מאה בקליק',[],self.root/'state',feedback_id='f1',renderer=render,interpreter=lambda **kw:{'status':'repair','actions':{'center':False,'music':'preserve','caption_suffix':'remove'},'learnings':[{'scope':'format','format_id':'rectangle-v2','rule':fr.CAPTION_RULE}],'summary':'Removed business-name ending from rectangle caption.'})
        self.assertEqual(result['status'],'ready_for_human');self.assertTrue(result['summary'].startswith('Removed business-name ending from rectangle caption.'));self.assertIn('owner review required',result['summary']);item=result['item'];self.assertNotIn('approval',item);self.assertNotIn('preview_url',item)
        self.assertEqual(item['caption'],'כמה מלבנים?');child=engine.verify(item['bundle']);self.assertEqual(child['payload']['parent_artifact'],bundle.name)
        self.assertEqual(child['payload']['job']['feedback_origin']['feedback_id'],'f1');self.assertTrue(child['payload']['job']['rule_snapshot']);self.assertEqual(package['caption'],self.job['post']['caption'])


@unittest.skipUnless(shutil.which('ffmpeg'),'ffmpeg required')
class OriginalAudioTests(PreferencesTests):
    def test_encoded_original_identity_levels_and_tamper(self):
        job=fr.apply_preferences(self.project,self.job,[{'scope':'global','rule':fr.MUSIC_RULE}])
        media=self.root/'visual.mp4'
        subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=c=white:s=1080x1920:r=30:d=2','-an','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',str(media)],check=True)
        fr.render_music(self.project,media,job);bundle=engine.freeze(job,self.project,media,self.root/'artifacts');report=audio_qa.inspect(bundle)
        self.assertTrue(report['procedural_verified']);self.assertTrue(report['listening_required']);self.assertEqual(report['listening_status'],'pending');self.assertLessEqual(report['true_peak_dbtp'],-1)
        identity={'artifact_id':bundle.name,'media_sha256':engine.sha(bundle/'asset.mp4')};self.assertTrue(cv._procedural_audio(report,identity))
        verified=cv.process_candidate(bundle,job['post']['caption'],'educational',self.root/'verified',reviewer=passing_reviewer,max_revisions=0)
        self.assertEqual(verified['status'],'ready_for_human')
        package={'bundle':str(bundle),'caption':job['post']['caption'],'cta':'educational','creative_verification':verified['verification']}
        self.assertEqual(cv.require(package)['status'],'pass')
        evidence=cv._read_ref(cv.require(package)['evidence'])
        self.assertTrue(evidence['audio_evidence']['listening_required'])
        for key,value in [('procedural_verified',False),('media_sha256','forged'),('listening_required',False),('integrated_lufs',0)]:
            altered={**report,key:value};self.assertFalse(cv._procedural_audio(altered,identity))
        # A self-consistent manifest with different encoded music still fails regenerated identity.
        other=self.root/'other.mp4'
        subprocess.run(['ffmpeg','-v','error','-i',str(media),'-f','lavfi','-i','sine=frequency=1000:duration=2:sample_rate=48000','-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-ac','2',str(other)],check=True)
        bad=engine.freeze(job,self.project,other,self.root/'artifacts')
        with self.assertRaisesRegex(ValueError,'Encoded audio differs'):audio_qa.inspect(bad)

if __name__=='__main__':unittest.main()
