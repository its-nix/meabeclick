import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import content_pipeline
import engine
import preparation
from test_creative_project import CONCEPT, MANIFEST
from test_creative_fixtures import tiny_video, attest


class FakeRenderer:
    def __init__(self, held=False):self.held=held;self.project=None;self.media=None
    def stage(self, project, job_id):
        self.project=Path(project);return {'status':'queued','job_id':job_id,'input_sha256':'input-sha'}
    def wait(self, job_id, timeout=1800):
        if self.held:return {'status':'held','reason':'proxy denied'}
        job=self.project.parent/'render-result';job.mkdir(exist_ok=True)
        self.media=job/'asset.mp4';tiny_video(self.media)
        return {'status':'ready','job_id':job_id,'input_sha256':'input-sha','source_manifest':engine.source_files(self.project),
                'asset_manifest':[],'media_path':self.media,'media_sha256':engine.sha(self.media)}


class AutonomousPreparationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name).resolve()
        store=content_pipeline.Store(self.root/'content-pipeline.sqlite3')
        run,_=store.claim_stage('ideation','fixture','2026-11-18T10:00:00Z')
        self.concept_id=store.save_concepts(run,[{k:v for k,v in CONCEPT.items() if k!='id'}])[0]
        store.transition_concept(self.concept_id,'candidate','production_ready','fixture accepted');store.close()
        self.verifier=patch('preparation.creative_verification.process_candidate',side_effect=self.verify).start();self.addCleanup(patch.stopall)

    def tearDown(self):self.temp.cleanup()

    def verify(self,bundle,caption,cta,state_dir,**kwargs):
        return {'status':'ready_for_human','bundle':str(bundle),'verification':attest(bundle,caption,cta,state_dir)}

    def qa(self,bundle):
        manifest=engine.verify(bundle)
        return {'technical_pass':True,'artifact_id':manifest['artifact_id'],'media_sha256':manifest['payload']['media']['sha256'],'listening_required':False}

    def test_generated_concept_freezes_lineage_and_enters_human_review_only(self):
        renderer=FakeRenderer()
        with patch('preparation.audio_qa.inspect',side_effect=self.qa):
            result=preparation.prepare_generated_concept(self.concept_id,self.root,{'verified_features':[]},'2035-11-18T19:30:00+02:00',
                project_runner=lambda *_:MANIFEST,renderer_client=renderer)
        self.assertEqual(result['verification_status'],'ready_for_human')
        self.assertEqual(result['jobs'],[])
        repair = self.verifier.call_args.kwargs['render']
        self.assertTrue(callable(repair))
        self.assertEqual(self.verifier.call_args.kwargs['max_revisions'],1)
        correct = self.verifier.call_args.kwargs['repairer']
        with patch('preparation.creative_verification._codex_repair', return_value=[]) as model:
            findings = [{'time_seconds': 2, 'issue': 'Opening sits too high'}]
            self.assertEqual(correct(context={'caption':'original'},findings=findings),[])
            args = model.call_args.kwargs
            self.assertEqual(args['findings'],findings)
            self.assertEqual(args['context']['caption'],'original')
            self.assertIn('unaffected scenes',args['context']['repair_scope'])
        output = self.root/'isolated.mp4'
        with patch('preparation.render_sandbox.render_into', return_value=output) as sandbox:
            self.assertEqual(repair(renderer.project,output),output)
            sandbox.assert_called_once_with(renderer.project,output,spool=self.root/'render-spool')
        manifest=engine.verify(result['bundle'])
        lineage=manifest['payload']['lineage']
        self.assertEqual(lineage['concept_id'],self.concept_id)
        self.assertEqual(lineage['input_sha256'],'input-sha')
        self.assertEqual(manifest['payload']['job']['constraints']['audio'],'silent')
        store=content_pipeline.Store(self.root/'content-pipeline.sqlite3')
        row=store.db.execute('SELECT status,artifact_id FROM content_items').fetchone()
        self.assertEqual(row['status'],'verified');self.assertEqual(row['artifact_id'],manifest['artifact_id'])
        store.close()

    def test_verified_correction_records_the_child_artifact_for_upload(self):
        renderer = FakeRenderer()
        def verify_repair(bundle, caption, cta, state, **kwargs):
            manifest = engine.verify(bundle)
            media = self.root/'corrected.mp4'
            tiny_video(media, color='red')
            child = engine.freeze(manifest['payload']['job'],Path(bundle)/'source',media,self.root/'corrected',
                                  parent=manifest['artifact_id'])
            return {'status':'ready_for_human','bundle':str(child),
                    'verification':attest(child,caption,cta,state)}
        with patch('preparation.audio_qa.inspect',side_effect=self.qa), \
             patch('preparation.creative_verification.process_candidate',side_effect=verify_repair):
            result=preparation.prepare_generated_concept(self.concept_id,self.root,{},'2035-11-18T19:30:00+02:00',
                project_runner=lambda *_:MANIFEST,renderer_client=renderer)
        manifest=engine.verify(result['bundle'])
        self.assertIsNotNone(manifest['payload']['parent_artifact'])
        self.assertEqual(result['artifact_id'],manifest['artifact_id'])
        store=content_pipeline.Store(self.root/'content-pipeline.sqlite3')
        self.assertEqual(store.db.execute('SELECT artifact_id FROM content_items').fetchone()['artifact_id'],result['artifact_id'])
        store.close()

    def test_policy_variant_applies_music_and_caption_without_editing_authored_source(self):
        import audio_qa
        import creative_projects
        import feedback_repair
        concept = {**CONCEPT, 'id':self.concept_id}
        project = Path(creative_projects.create_project(concept,{},lambda *_:MANIFEST,self.root/'projects')['project'])
        context = {'active_rules': [
            {'scope':'global','rule':feedback_repair.MUSIC_RULE,'origin':{'comment':'private'}},
            {'scope':'global','rule':feedback_repair.CAPTION_RULE},
            {'scope':'format','format_id':'other','rule':'An unrelated format rule'},
        ]}
        rules = creative_projects.scoped_rules(context, concept['format'])
        self.assertEqual(len(rules),2)
        self.assertNotIn('origin',rules[0])
        job = {'post':{'caption':'נסו תרגיל. מאה בקליק'},
               'constraints':{'audio':'silent'},'generated':{'concept_id':self.concept_id}}
        variant, updated, _ = preparation._policy_project(project,job,rules,self.root)
        self.assertEqual(updated['constraints']['audio'],'music')
        self.assertEqual(updated['rule_snapshot'],rules)
        self.assertEqual(updated['post']['caption'],'נסו תרגיל')
        self.assertFalse((project/'preferences-applied.json').exists())
        self.assertTrue((variant/'assets/audio/original-light.wav').is_file())
        media=self.root/'silent.mp4';tiny_video(media)
        scored=preparation._attach_policy_audio(variant,media,updated,self.root)
        self.assertTrue(any(stream['codec_type']=='audio' for stream in audio_qa.probe(scored)['streams']))
        self.assertFalse(any(stream['codec_type']=='audio' for stream in audio_qa.probe(media)['streams']))

    def test_held_renderer_never_freezes_or_queues_content(self):
        renderer=FakeRenderer(held=True)
        with self.assertRaisesRegex(ValueError,'Isolated render held'):
            preparation.prepare_generated_concept(self.concept_id,self.root,{'verified_features':[]},'2035-11-18T19:30:00+02:00',
                project_runner=lambda *_:MANIFEST,renderer_client=renderer)
        self.assertFalse((self.root/'artifacts').exists())
        store=content_pipeline.Store(self.root/'content-pipeline.sqlite3')
        self.assertEqual(store.db.execute('SELECT status FROM concepts').fetchone()['status'],'held')
        store.close()

    def test_failed_technical_qa_does_not_create_review_job(self):
        renderer=FakeRenderer()
        with patch('preparation.audio_qa.inspect',return_value={'technical_pass':False}),self.assertRaisesRegex(ValueError,'technical QA'):
            preparation.prepare_generated_concept(self.concept_id,self.root,{'verified_features':[]},'2035-11-18T19:30:00+02:00',
                project_runner=lambda *_:MANIFEST,renderer_client=renderer,destinations=[{'network':'instagram','account':'brand'}],
                preview_urls={'unused':'https://example.test/a.mp4'})
        import machine
        queue=machine.Queue(self.root/'queue.sqlite3')
        self.assertEqual(queue.rows(),[]);queue.close()


if __name__=='__main__':unittest.main()
