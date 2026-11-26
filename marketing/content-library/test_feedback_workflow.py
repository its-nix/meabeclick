import copy
import hashlib
import json
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import Mock,patch
from urllib.parse import unquote

import engine
import feedback
import feedback_workflow as workflow
import machine
import review_queue
from test_creative_fixtures import tiny_video,attest


class NativeMemory:
    def __init__(self,queue,comments):
        self.rows=review_queue.release_rows(queue)
        for row in self.rows[1:]:row[13]=comments.get(row[2],'')
        self.tabs={'History':[review_queue.HEADERS.copy()],'Learnings':[['rule_id','scope','rule','origin','state']]};self.writes=0
    def _release_values(self,*_):return copy.deepcopy(self.rows)
    def _request(self,method,url,body=None):
        if method=='GET':
            title=unquote(url.split('/values/')[1].split('?')[0]).split('!')[0].strip("'")
            return {'values':copy.deepcopy(self.rows if title=='Releases' else self.tabs[title])}
        data=json.loads(body);self.writes+=1
        if 'requests' in data:return {}
        for update in data['data']:
            match=re.fullmatch(r"'([^']+)'!([A-Z]+)(\d+):[A-Z]+\d+",update['range']);title,column,start=match.groups();start=int(start)-1
            offset=0
            for char in column:offset=offset*26+ord(char)-64
            offset-=1
            current=self.rows if title=='Releases' else self.tabs[title];width=16 if title in ('Releases','History') else 5
            for i,values in enumerate(update['values']):
                while len(current)<=start+i:current.append(['']*width)
                current[start+i][offset:offset+len(values)]=list(values)
            while current and all(v=='' or v is False for v in current[-1]):current.pop()
        return {}
    def _write(self,state,intent,submit,verify):
        result=submit();verify(result);return result
    def mirror_document(self,path,*_):
        assert Path(path).read_text().startswith('# Learned');return {'status':'verified'}
    def verify_preview(self,*_,**__):return True
    def sync_releases(self,sid,sheet,q,state):
        feedback.scan(q,self.rows);expected={r[0]:r for r in review_queue.release_rows(q)[1:]}
        for row in self.rows[1:]:
            if row[0] not in expected:
                assert row[14]=='Archived';continue
            exact=expected[row[0]];row[:11]=exact[:11];row[14:16]=exact[14:16]
        review_queue.import_decisions(q,[self.rows[0]]+[r for r in self.rows[1:] if r[0] in expected])
        return copy.deepcopy(self.rows)


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        learning=patch('feedback_learning.review',return_value={'status':'completed','agent_called':False,'rules':[]});learning.start();self.addCleanup(learning.stop)
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name).resolve();source=self.root/'source';source.mkdir();(source/'index.html').write_text('<html>source</html>');video=self.root/'video.mp4';tiny_video(video)
        self.old=engine.freeze({'post':{'id':'P003'},'factory':{'template':'add18-v2'}},source,video,self.root/'artifacts')
        self.new=engine.freeze({'post':{'id':'P003'},'factory':{'template':'add18-v2'},'feedback':'fixture','rule_snapshot':[{'scope':'global','rule':'Center the content'}]},source,video,self.root/'artifacts',parent=self.old.name)
        self.q=machine.Queue(self.root/'queue.sqlite3');self.cfg={'feedback_enabled':True,'spreadsheet_id':'sheet','releases_sheet_id':7,'learnings_sheet_id':8,'learning_guide_file_id':'guide','drive_posts_folder_id':'posts','destinations':[{'network':'instagram','account':'ig'},{'network':'facebook','account':'fb'}]}
        self.package={**self.package_for(self.old),'review_batch_id':'review-2035-W46'};self.ids=[self.q.enqueue(dict(self.package,network=n,account=a)) for n,a in [('instagram','ig'),('facebook','fb')]]
    def tearDown(self):self.q.close();self.temp.cleanup()
    def package_for(self,bundle):
        return {'bundle':str(bundle),'caption':'Caption','cta':'educational','scheduled_at':'2035-11-16T19:30:00+02:00','qa':{'artifact_id':bundle.name,'media_sha256':engine.sha(bundle/'asset.mp4'),'technical_pass':True,'listening_required':False},'creative_verification':attest(bundle,'Caption','educational'),'preview_url':'https://example.test/preview'}
    def candidate(self):
        p=self.package_for(self.new);return {**p,'artifact_id':self.new.name,'media_sha256':engine.sha(self.new/'asset.mp4'),'verification_status':'ready_for_human'}
    def receipt(self):
        return {'file_id':'canonical','id':'canonical','revision_id':'r2','md5Checksum':hashlib.md5((self.new/'asset.mp4').read_bytes()).hexdigest(),'sha256':engine.sha(self.new/'asset.mp4'),'needs_verification':False,'webViewLink':'https://drive.google.com/file/d/canonical/view'}
    def test_unchanged_empty_feedback_never_invokes_agent(self):
        native=NativeMemory(self.q,{});producer=Mock(side_effect=AssertionError('No model on unchanged poll'))
        workflow.run(native,self.cfg,self.q,self.root,processor=producer);workflow.run(native,self.cfg,self.q,self.root,processor=producer)
        producer.assert_not_called();self.assertEqual(feedback.pending(self.q),[])
    def test_two_destination_feedback_is_combined_once_and_owner_words_survive(self):
        native=NativeMemory(self.q,{'instagram':'Center the layout','facebook':'Use light music'});producer=Mock(return_value={'status':'ready_for_human','item':self.candidate(),'learnings':[{'scope':'global','rule':'Center the content'}],'summary':'Centered layout and added music.'})
        with patch('drive_assets.store',return_value=self.receipt()) as store:
            result=workflow.run(native,self.cfg,self.q,self.root,processor=producer)
            workflow.run(native,self.cfg,self.q,self.root,processor=producer)
        self.assertEqual(result['processed'],1);self.assertEqual(producer.call_count,1);self.assertEqual(store.call_count,1)
        self.assertIn('Center the layout',producer.call_args.args[1]);self.assertIn('Use light music',producer.call_args.args[1])
        by_network={r[2]:r for r in native.rows[1:]};self.assertEqual(by_network['instagram'][13],'Center the layout');self.assertEqual(by_network['facebook'][13],'Use light music')
        self.assertTrue(all(r[11] is False and r[14]=='Fixed' for r in native.rows[1:] if r[14]!='Archived'));self.assertEqual(len(native.tabs['History']),3)
        self.assertEqual(len(feedback.rules(self.q)),1);self.assertTrue((self.root/'knowledge/rules.md').exists())
    def test_one_comment_can_replace_both_channels_without_false_sibling_block(self):
        native=NativeMemory(self.q,{'instagram':'Center the layout'});producer=Mock(return_value={'status':'ready_for_human','item':self.candidate(),'learnings':[{'scope':'global','rule':'Center the content'}],'summary':'Centered.'})
        with patch('drive_assets.store',return_value=self.receipt()):result=workflow.run(native,self.cfg,self.q,self.root,processor=producer)
        self.assertEqual(result['processed'],1);self.assertEqual(result['held'],[])
        self.assertEqual({j['network'] for j in self.q.rows()},{'instagram','facebook'})
        self.assertEqual({j['package'].get('review_batch_id') for j in self.q.rows()},{'review-2035-W46'})

    def test_started_journal_blocks_before_any_model_or_native_write(self):
        native=NativeMemory(self.q,{});directory=self.root/'feedback-replacements';directory.mkdir();(directory/'interrupted.json').write_text(json.dumps({'status':'started'}))
        producer=Mock(side_effect=AssertionError('Must not run'))
        with self.assertRaisesRegex(ValueError,'Interrupted media replacement'):workflow.run(native,self.cfg,self.q,self.root,processor=producer)
        producer.assert_not_called();self.assertEqual(native.writes,0)

    def test_sparse_retirement_preserves_concurrent_unrelated_owner_edit(self):
        native=NativeMemory(self.q,{});before=copy.deepcopy(native.rows);desired=copy.deepcopy(before);desired[1][9]='Blocked';desired[1][14:16]=['Archived','Replaced']
        original=native._request
        def concurrent(method,url,body=None):
            if method=='POST' and 'values:batchUpdate' in url:native.rows[2][13]='Concurrent owner feedback';native.rows[2][11]=True
            return original(method,url,body)
        native._request=concurrent
        workflow._commit_rows(native,self.cfg,before,desired,self.root,'fixture')
        self.assertEqual(native.rows[2][13],'Concurrent owner feedback');self.assertIs(native.rows[2][11],True)

    def test_edit_during_repair_is_not_marked_fixed_or_uploaded(self):
        native=NativeMemory(self.q,{'instagram':'Center the layout'})
        def produce(*_,**__):
            next(r for r in native.rows[1:] if r[2]=='instagram')[13]='Actually keep layout; change only caption'
            return {'status':'ready_for_human','item':self.candidate(),'learnings':[],'summary':'Old repair'}
        with patch('drive_assets.store') as store:workflow.run(native,self.cfg,self.q,self.root,processor=produce)
        store.assert_not_called();self.assertEqual(len(feedback.pending(self.q)),1);self.assertTrue(all(j['artifact']==self.old.name for j in self.q.rows()))
    def test_failed_verification_is_held_without_changing_video(self):
        native=NativeMemory(self.q,{'instagram':'Center the layout'})
        result=workflow.run(native,self.cfg,self.q,self.root,processor=lambda *_,**__: {'status':'held','summary':'Critics rejected'})
        self.assertEqual(len(result['held']),1);self.assertEqual(len(self.q.rows()),2)
        key=next(r[0] for r in native.rows[1:] if r[2]=='instagram')
        self.assertTrue(feedback.blocked(self.q,key));self.assertEqual(next(r for r in native.rows[1:] if r[0]==key)[14],'Held')

if __name__=='__main__':unittest.main()
