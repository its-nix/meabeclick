import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock
import engine
import feedback
import feedback_learning
import feedback_repair
import machine
import review_queue
from test_creative_fixtures import tiny_video,attest

class LearningTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name).resolve();source=self.root/'source';source.mkdir();(source/'index.html').write_text('<html>fixture</html>');media=self.root/'video.mp4';tiny_video(media)
        bundle=engine.freeze({'post':{'id':'P003'},'factory':{'template':'add18-v2'},'constraints':{'feedback_actions':{'center':True,'music':'preserve','caption_suffix':'preserve'}}},source,media,self.root/'artifacts')
        self.q=machine.Queue(self.root/'queue.sqlite3');package={'bundle':str(bundle),'caption':'Caption','cta':'educational','network':'instagram','account':'ig','scheduled_at':'2035-11-16T19:30:00+02:00','preview_url':'https://example.test/preview','qa':{'artifact_id':bundle.name,'media_sha256':engine.sha(bundle/'asset.mp4'),'technical_pass':True,'listening_required':False},'creative_verification':attest(bundle,'Caption','educational')}
        key=self.q.enqueue(package)
        fb=self.q.enqueue(dict(package,network='facebook',account='fb'))
        rows=review_queue.release_rows(self.q)
        for row in rows[1:]:row[13]='Please center this educational short' if row[2]=='instagram' else 'Add light music to the short'
        jobs=feedback.scan(self.q,rows)
        child=engine.freeze({'post':{'id':'P003'},'factory':{'template':'add18-v2'},'feedback_fixture':True},source,media,self.root/'artifacts',parent=bundle.name)
        package={**package,'bundle':str(child),'creative_verification':attest(child,'Caption','educational'),'qa':{**package['qa'],'artifact_id':child.name,'media_sha256':engine.sha(child/'asset.mp4')}}
        replacements=[self.q.enqueue(dict(package,network=n,account=a)) for n,a in [('instagram','ig'),('facebook','fb')]]
        for job in jobs:
            feedback.claim(self.q,job['id']);feedback.complete(self.q,job['id'],replacement_ids=replacements,current_feedback=job['comment'],summary='Verified layout repair')
        path=self.root/'feedback-replacements';path.mkdir();(path/(jobs[0]['id']+'.json')).write_text(json.dumps({'status':'completed','feedback_id':jobs[0]['id'],'related':[j['id'] for j in jobs],'item':package}))
    def tearDown(self):self.q.close();self.temp.cleanup()
    def proposal(self,learnings):return {'status':'repair','patches':[],'actions':{'center':False,'music':'preserve','caption_suffix':'preserve'},'caption':'Caption','learnings':learnings,'summary':'Centering is reusable within this format.'}
    def test_new_completed_feedback_gets_one_scope_review_then_zero_calls(self):
        model=Mock(return_value=self.proposal([{'scope':'format','format_id':'add18-v2','rule':feedback_repair.CENTER_RULE,'supersedes':[]}]))
        first=feedback_learning.review(self.q,self.root,interpreter=model);second=feedback_learning.review(self.q,self.root,interpreter=model)
        self.assertTrue(first['agent_called']);self.assertFalse(second['agent_called']);self.assertEqual(model.call_count,1)
        self.assertEqual(len(feedback.rules(self.q,'add18-v2')),1);self.assertIn('COMPLETED',model.call_args.kwargs['feedback_text']);self.assertIn('Please center',model.call_args.kwargs['feedback_text']);self.assertIn('Add light music',model.call_args.kwargs['feedback_text'])
    def test_specific_change_can_conclude_without_general_rule(self):
        result=feedback_learning.review(self.q,self.root,interpreter=lambda **_:self.proposal([]))
        self.assertEqual(result['status'],'completed');self.assertEqual(feedback.rules(self.q,'add18-v2'),[])
    def test_scope_review_cannot_edit_content_or_create_unobserved_format_rule(self):
        bad=self.proposal([{'scope':'format','format_id':'unseen','rule':'Change style','supersedes':[]}])
        result=feedback_learning.review(self.q,self.root,interpreter=lambda **_:bad)
        self.assertEqual(result['status'],'held');self.assertEqual(feedback.rules(self.q,'add18-v2'),[])
        second=feedback_learning.review(self.q,self.root,interpreter=Mock(side_effect=AssertionError('No retry unchanged')))
        self.assertFalse(second['agent_called'])

if __name__=='__main__':unittest.main()
