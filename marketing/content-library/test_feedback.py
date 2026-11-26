import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from contextlib import contextmanager

import feedback


class Queue:
    def __init__(self,path):
        self.db=sqlite3.connect(path,isolation_level=None);self.db.row_factory=sqlite3.Row
        self.db.execute('CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,artifact TEXT,package TEXT,status TEXT,approval_sha TEXT,approver TEXT,listened INT,updated TEXT)')
    @contextmanager
    def transaction(self):
        self.db.execute('BEGIN IMMEDIATE')
        try:yield;self.db.execute('COMMIT')
        except BaseException:self.db.execute('ROLLBACK');raise
    def get(self,key):
        r=self.db.execute('SELECT * FROM jobs WHERE id=?',(key,)).fetchone()
        if r is None:raise ValueError('Unknown job')
        r=dict(r);r['package']=json.loads(r['package']);return r
    def event(self,*args):pass
    def add(self,key='original',status='approved'):
        self.db.execute('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?)',(key,key+'-artifact',json.dumps({'artifact_id':key+'-artifact','media_sha256':key+'-sha'}),status,key if status=='approved' else None,None,int(status=='approved'),''))


def rows(comment='Center the text',key='original',wide=False):
    h=['']*14;h[0]='release_id';h[8]='media_sha256';h[13]='feedback'
    r=['']*14;r[0]=key;r[8]=key+'-sha';r[13]=comment
    if wide:h+=['Status','Worker result'];r+=['','']
    return [h,r]


class FeedbackTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name)/'queue.db';self.q=Queue(self.path);self.q.add()
    def tearDown(self):self.q.db.close();self.temp.cleanup()
    def scan(self,comment='Center the text'):return feedback.scan(self.q,rows(comment))
    def finish(self,job,**kwargs):
        self.q.add('replacement','review')
        return feedback.complete(self.q,job['id'],replacement_ids=['replacement'],current_feedback=job['comment'],summary='Centered; verified readback',**kwargs)
    def test_unchanged_and_revocation(self):
        job=self.scan()[0]
        self.assertEqual(self.q.get('original')['status'],'review');self.assertIsNone(self.q.get('original')['approval_sha'])
        self.assertEqual(self.scan(),[]);self.assertEqual(len(feedback.pending(self.q)),1)
        self.assertEqual(feedback.claim(self.q,job['id'])['attempts'],1)
        self.assertIsNone(feedback.claim(self.q,job['id']))
        self.finish(job)
        self.assertEqual(self.scan(),[]);self.assertEqual(feedback.pending(self.q),[])
        self.assertFalse(feedback.blocked(self.q,'original'))
        self.assertEqual(feedback.scan(self.q,rows(key='replacement',wide=True)),[])
        self.assertFalse(feedback.blocked(self.q,'replacement'))
    def test_edit_during_work_cannot_complete(self):
        job=self.scan()[0];feedback.claim(self.q,job['id'])
        new=self.scan('Use quieter music')[0]
        self.assertEqual(feedback.get(self.q,job['id'])['status'],'superseded')
        with self.assertRaises(ValueError):self.finish(job)
        self.assertEqual(feedback.pending(self.q)[0]['id'],new['id'])
    def test_current_readback_guard(self):
        job=self.scan()[0];feedback.claim(self.q,job['id']);self.q.add('replacement','review')
        with self.assertRaises(ValueError):feedback.complete(self.q,job['id'],replacement_ids=['replacement'],current_feedback='Edited externally',summary='verified')
        self.assertEqual(feedback.get(self.q,job['id'])['status'],'running')
    def test_restart_and_budget(self):
        job=self.scan()[0];feedback.claim(self.q,job['id']);self.q.db.close();self.q=Queue(self.path)
        self.assertEqual(feedback.recover(self.q),1);self.assertEqual(feedback.pending(self.q),[])
        feedback.retry(self.q,job['id']);self.assertEqual(feedback.claim(self.q,job['id'])['attempts'],2)
        feedback.hold(self.q,job['id'],'safe renderer failure')
        with self.assertRaises(ValueError):feedback.retry(self.q,job['id'])
        self.assertTrue(feedback.blocked(self.q,'original'))
    def test_submitted_feedback_is_held(self):
        self.q.db.execute("UPDATE jobs SET status='scheduled' WHERE id='original'")
        job=self.scan()[0];self.assertEqual(job['status'],'held');self.assertIsNone(feedback.claim(self.q,job['id']))
    def test_cleared_feedback_supersedes(self):
        job=self.scan()[0];self.scan('  ')
        self.assertEqual(feedback.get(self.q,job['id'])['status'],'superseded');self.assertFalse(feedback.blocked(self.q,'original'))
    def test_scoped_rules_origin_and_exports_survive_restart(self):
        job=self.scan()[0];feedback.claim(self.q,job['id'])
        self.finish(job,learnings=[{'scope':'format','format_id':'story','rule':'Center title within safe margins'},{'scope':'global','rule':'Keep captions legible'}],state_dir=Path(self.temp.name)/'kb')
        self.assertEqual(len(feedback.rules(self.q,'story')),2);self.assertEqual(len(feedback.rules(self.q,'reel')),1)
        self.assertEqual(feedback.rules(self.q,'story')[0]['origin']['comment'],job['comment'])
        self.assertEqual(len(feedback.learning_rows(self.q)),3)
        snap=feedback.snapshot(self.q,'story');self.q.db.close();self.q=Queue(self.path)
        self.assertEqual(snap,feedback.snapshot(self.q,'story'))
        exported=json.loads((Path(self.temp.name)/'kb/rules.json').read_text());self.assertEqual(len(exported['rules']),2)
        self.assertIn('Center title',(Path(self.temp.name)/'kb/rules.md').read_text())
    def test_bad_scan_does_not_revoke_or_ingest(self):
        table=rows();table.append(['unknown']+['']*13)
        with self.assertRaises(ValueError):feedback.scan(self.q,table)
        self.assertEqual(self.q.get('original')['status'],'approved');self.assertEqual(feedback.pending(self.q),[])
    def test_long_comment_and_stale_media_rejected(self):
        with self.assertRaises(ValueError):self.scan('x'*12001)
        table=rows();table[1][8]='changed'
        with self.assertRaises(ValueError):feedback.scan(self.q,table)
    def test_blocked_is_read_only_inside_existing_transaction(self):
        with self.q.transaction():
            self.assertFalse(feedback.blocked(self.q,'original'))
            self.assertTrue(self.q.db.in_transaction)
        self.scan()
        with self.q.transaction():
            self.assertTrue(feedback.blocked(self.q,'original'))
            self.assertTrue(self.q.db.in_transaction)
    def test_restored_comment_requeues_only_unattempted_work(self):
        job=self.scan()[0];self.scan('');self.assertEqual(self.scan()[0]['status'],'pending')
        feedback.claim(self.q,job['id']);self.scan('');self.assertEqual(self.scan()[0]['status'],'held')
        self.assertEqual(feedback.pending(self.q),[])
    def test_restored_comment_supersedes_intervening_edit(self):
        original=self.scan()[0];intermediate=self.scan('Use quieter music')[0]
        restored=self.scan()[0]
        self.assertEqual(restored['id'],original['id'])
        self.assertEqual(restored['status'],'pending')
        self.assertEqual(feedback.get(self.q,intermediate['id'])['status'],'superseded')
        self.assertEqual([j['id'] for j in feedback.pending(self.q)],[original['id']])
        self.assertTrue(feedback.blocked(self.q,'original'))
    def test_rule_supersession_changes_only_matching_scope(self):
        job=self.scan()[0];feedback.claim(self.q,job['id'])
        self.finish(job,learnings=[{'scope':'global','rule':'Old rule'}])
        old=feedback.rules(self.q)[0]['id'];before=feedback.snapshot(self.q)
        newer=self.scan('Use slower titles')[0];feedback.claim(self.q,newer['id']);self.q.add('second','review')
        feedback.complete(self.q,newer['id'],replacement_ids=['second'],current_feedback=newer['comment'],summary='Verified slower titles',learnings=[{'scope':'global','rule':'New rule','supersedes':[old]}])
        self.assertEqual([r['rule'] for r in feedback.rules(self.q)],['New rule'])
        self.assertNotEqual(before['revision'],feedback.snapshot(self.q)['revision'])
        self.assertEqual(feedback.learning_rows(self.q)[1][-1],'superseded')
    def test_export_occurs_after_commit_and_failure_is_recoverable(self):
        job=self.scan()[0];feedback.claim(self.q,job['id'])
        def fail_export(queue,state_dir):
            self.assertFalse(queue.db.in_transaction)
            self.assertEqual(feedback.get(queue,job['id'])['status'],'completed')
            self.assertEqual(len(feedback.rules(queue)),1)
            raise OSError('simulated export failure')
        with patch.object(feedback,'export_rules',side_effect=fail_export):
            with self.assertRaises(OSError):
                self.finish(job,learnings=[{'scope':'global','rule':'Committed rule'}],state_dir=Path(self.temp.name)/'kb')
        self.q.db.close();self.q=Queue(self.path)
        self.assertEqual(feedback.get(self.q,job['id'])['status'],'completed')
        self.assertEqual(feedback.export_rules(self.q,Path(self.temp.name)/'kb')['rules'][0]['rule'],'Committed rule')
    def test_deferred_completion_blocks_alias_until_sync_readback(self):
        job=self.scan()[0];feedback.claim(self.q,job['id'])
        done=self.finish(job,defer_visible=True)
        self.assertEqual(done['status'],'resolved')
        self.assertEqual(feedback.status_rows(self.q)['original'][0],'Syncing')
        self.assertEqual(feedback.status_rows(self.q)['replacement'][0],'Syncing')
        self.assertTrue(feedback.blocked(self.q,'original'))
        self.assertTrue(feedback.blocked(self.q,'replacement'))
        self.assertEqual(feedback.pending(self.q),[])
        self.assertEqual(self.scan(),[])
        self.assertEqual(feedback.scan(self.q,rows(key='replacement')),[])
        self.assertIsNone(feedback.claim(self.q,job['id']))
        self.q.db.close();self.q=Queue(self.path)
        self.assertEqual(feedback.recover(self.q),0)
        self.assertEqual([r['id'] for r in feedback.resolved(self.q)],[job['id']])
        feedback.finish(self.q,job['id'])
        self.assertEqual(feedback.resolved(self.q),[])
        self.assertFalse(feedback.blocked(self.q,'replacement'))
        self.assertEqual(feedback.status_rows(self.q)['replacement'][0],'Fixed')
    def test_finish_rejects_nonresolved_or_changed_comment(self):
        job=self.scan()[0]
        with self.assertRaises(ValueError):feedback.finish(self.q,job['id'])
        feedback.claim(self.q,job['id']);self.finish(job,defer_visible=True)
        self.scan('Another owner change')
        with self.assertRaises(ValueError):feedback.finish(self.q,job['id'])
    def add_rule(self,text='Keep captions legible',scope='global',fmt=None,rid='rule1'):
        feedback.init(self.q)
        self.q.db.execute('INSERT INTO feedback_rules VALUES(?,?,?,?,?,?,?)',(rid,scope,fmt,text,'{}','active',1))
    def set_frozen(self,key,job):
        package=self.q.get(key)['package'];package['frozen_job']=job
        self.q.db.execute('UPDATE jobs SET package=? WHERE id=?',(json.dumps(package),key))
    def test_same_artifact_feedback_revokes_and_blocks_sibling(self):
        self.q.add('facebook')
        package=self.q.get('original')['package']
        self.q.db.execute('UPDATE jobs SET artifact=?,package=? WHERE id=?',('original-artifact',json.dumps(package),'facebook'))
        self.scan()
        self.assertEqual(self.q.get('facebook')['status'],'review')
        self.assertIsNone(self.q.get('facebook')['approval_sha'])
        self.assertEqual(self.q.get('facebook')['listened'],0)
        self.assertTrue(feedback.blocked(self.q,'facebook'))
        self.assertEqual(feedback.status_rows(self.q)['facebook'][0],'Pending')
    def test_latest_syncing_alias_wins_over_older_completed_alias(self):
        job=self.scan()[0];feedback.claim(self.q,job['id']);self.q.add('replacement','review')
        feedback.complete(self.q,job['id'],replacement_ids=['replacement'],current_feedback=job['comment'],summary='Newest verification',defer_visible=True)
        old=dict(self.q.db.execute('SELECT * FROM feedback_jobs WHERE id=?',(job['id'],)).fetchone());old.update(id='older',release_id='historical',status='completed',summary='Old result',created='2000-01-01T00:00:00Z')
        self.q.db.execute('INSERT INTO feedback_jobs('+','.join(old)+') VALUES('+','.join('?' for _ in old)+')',tuple(old.values()))
        self.q.db.execute('INSERT INTO feedback_aliases VALUES(?,?,?)',('replacement','old-digest','older'))
        self.assertEqual(feedback.status_rows(self.q)['replacement'],['Syncing','Newest verification'])
        feedback.finish(self.q,job['id'])
        self.assertEqual(feedback.status_rows(self.q)['replacement'],['Fixed','Newest verification'])

    def test_semantic_rule_freshness_requires_exact_active_scope(self):
        self.add_rule();self.add_rule('Center title','format','story','story-rule')
        package={'frozen_job':{'factory':{'template':'story'},'rule_snapshot':[{'scope':'global','rule':'Keep captions legible','id':'unrelated'}]}}
        with patch.object(feedback,'_frozen_job',side_effect=lambda p:p['frozen_job']):
            self.assertTrue(feedback.stale_rules(self.q,package))
            package['frozen_job']['rule_snapshot'].append({'scope':'format','format_id':'story','rule':'Center title','origin':{'different':'origin'}})
            self.assertFalse(feedback.stale_rules(self.q,package))
            # A duplicate semantic rule with fresh provenance does not churn policy.
            self.add_rule(rid='new-id-same-rule')
            self.assertFalse(feedback.stale_rules(self.q,package))
            self.q.db.execute("UPDATE feedback_rules SET state='superseded' WHERE id='story-rule'")
            self.assertTrue(feedback.stale_rules(self.q,package))
            package['frozen_job']['rule_snapshot'].pop()
            self.assertFalse(feedback.stale_rules(self.q,package))
    def test_generated_clip_uses_its_exact_format_for_policy_refresh(self):
        self.add_rule('Keep captions legible')
        self.add_rule('Contrast the selected fraction','format','fraction','fraction-rule')
        self.add_rule('Center comparison cards','format','comparison','comparison-rule')
        job = {'generated':{'format':'fraction'},
               'rule_snapshot':[{'scope':'global','rule':'Keep captions legible'},
                                {'scope':'format','format_id':'fraction','rule':'Contrast the selected fraction'}]}
        self.set_frozen('original',job)
        with patch.object(feedback,'_frozen_job',side_effect=lambda p:p['frozen_job']):
            self.assertFalse(feedback.stale_rules(self.q,self.q.get('original')['package']))
            self.assertEqual(feedback.ensure_rule_jobs(self.q),[])
            self.add_rule('Show matching units','format','fraction','units')
            self.assertEqual(len(feedback.ensure_rule_jobs(self.q)),1)

    def test_policy_refresh_empty_owner_comment_is_durable_and_bounded(self):
        self.add_rule();self.set_frozen('original',{'factory':{'template':'story'}})
        with patch.object(feedback,'_frozen_job',side_effect=lambda p:p['frozen_job']):
            policy=feedback.ensure_rule_jobs(self.q)[0]
            self.assertEqual(policy['kind'],'policy')
            self.assertNotEqual(policy['digest'],policy['source_digest'])
            self.assertEqual(self.q.get('original')['status'],'review')
            self.assertEqual(feedback.ensure_rule_jobs(self.q),[])
            self.assertEqual(self.scan(''),[])
            feedback.claim(self.q,policy['id'])
            self.q.add('replacement','review')
            self.set_frozen('replacement',{'factory':{'template':'story'},'rule_snapshot':feedback.rules(self.q,'story')})
            feedback.complete(self.q,policy['id'],replacement_ids=['replacement'],current_feedback='',summary='Guidance applied and verified',defer_visible=True)
            self.assertTrue(feedback.blocked(self.q,'replacement'))
            feedback.finish(self.q,policy['id'])
            self.assertFalse(feedback.blocked(self.q,'replacement'))
            self.assertEqual(feedback.ensure_rule_jobs(self.q),[])
            self.assertEqual(feedback.pending(self.q),[])
    def test_owner_edit_supersedes_policy_and_prevents_completion(self):
        self.add_rule();self.set_frozen('original',{'factory':{'template':'story'}})
        with patch.object(feedback,'_frozen_job',side_effect=lambda p:p['frozen_job']):
            policy=feedback.ensure_rule_jobs(self.q)[0]
        feedback.claim(self.q,policy['id']);self.scan('Quieter music please')
        self.assertEqual(feedback.get(self.q,policy['id'])['status'],'superseded')
        self.q.add('replacement','review')
        with self.assertRaises(ValueError):feedback.complete(self.q,policy['id'],replacement_ids=['replacement'],current_feedback='Quieter music please',summary='Verified')
        self.assertEqual(feedback.pending(self.q)[0]['kind'],'owner')
    def test_policy_complete_rejects_unscanned_owner_edit_and_new_learning(self):
        self.add_rule();self.set_frozen('original',{'factory':{'template':'story'}})
        with patch.object(feedback,'_frozen_job',side_effect=lambda p:p['frozen_job']):
            policy=feedback.ensure_rule_jobs(self.q)[0]
        feedback.claim(self.q,policy['id']);self.q.add('replacement','review')
        with self.assertRaises(ValueError):feedback.complete(self.q,policy['id'],replacement_ids=['replacement'],current_feedback='Edited remotely',summary='Verified')
        with self.assertRaises(ValueError):feedback.complete(self.q,policy['id'],replacement_ids=['replacement'],current_feedback='',summary='Verified',learnings=[{'scope':'global','rule':'Unexpected new learning'}])
    def test_record_learnings_requires_completed_owner_and_current_origin(self):
        job=self.scan()[0]
        learning=[{'scope':'global','rule':'Center important text'}]
        with self.assertRaises(ValueError):feedback.record_learnings(self.q,job['id'],learning)
        feedback.claim(self.q,job['id']);self.finish(job,defer_visible=True)
        with self.assertRaises(ValueError):feedback.record_learnings(self.q,job['id'],learning)
        feedback.finish(self.q,job['id'])
        self.scan('Newer owner preference')
        with self.assertRaises(ValueError):feedback.record_learnings(self.q,job['id'],learning)
    def test_record_learnings_dedup_preserves_revision_and_owner_origins(self):
        job=self.scan()[0];feedback.claim(self.q,job['id']);self.finish(job)
        self.q.add('other','review')
        related=feedback.scan(self.q,rows('Center captions too',key='other'))[0]
        feedback.claim(self.q,related['id']);self.q.add('other-child','review')
        feedback.complete(self.q,related['id'],replacement_ids=['other-child'],current_feedback=related['comment'],summary='Verified other caption')
        learning=[{'scope':'global','rule':'Center important text'}]
        ids=feedback.record_learnings(self.q,job['id'],learning,related_feedback_ids=[related['id']])
        before=feedback.snapshot(self.q)
        self.assertEqual(ids,feedback.record_learnings(self.q,related['id'],learning))
        self.assertEqual(before,feedback.snapshot(self.q))
        rule=feedback.rules(self.q)[0]
        self.assertEqual(rule['origin']['feedback_ids'],[job['id'],related['id']])
        self.assertEqual(rule['origin']['feedback_origins'][1]['comment'],related['comment'])
        self.assertEqual(rule['origin']['reason'],'completed-feedback scope review')
        self.assertEqual(self.q.get('replacement')['status'],'review')
        self.assertEqual(feedback.get(self.q,job['id'])['status'],'completed')
    def test_record_learnings_validation_and_supersession_are_atomic(self):
        job=self.scan()[0];feedback.claim(self.q,job['id']);self.finish(job)
        old=feedback.record_learnings(self.q,job['id'],[{'scope':'global','rule':'Old guidance'}])[0]
        before=feedback.snapshot(self.q)
        with self.assertRaises(ValueError):feedback.record_learnings(self.q,job['id'],[{'scope':'global','rule':'New guidance','supersedes':['missing']}])
        with self.assertRaises(ValueError):feedback.record_learnings(self.q,job['id'],[{'scope':'format','format_id':'story','rule':'Wrong scope','supersedes':[old]}])
        with self.assertRaises(ValueError):feedback.record_learnings(self.q,job['id'],[{'scope':'global','rule':'New guidance','extra':'invalid'}])
        self.assertEqual(before,feedback.snapshot(self.q))
        new=feedback.record_learnings(self.q,job['id'],[{'scope':'global','rule':'New guidance','supersedes':[old]}])[0]
        self.assertNotEqual(old,new)
        self.assertEqual([r['rule'] for r in feedback.rules(self.q)],['New guidance'])
    def test_record_learnings_rejects_completed_policy_origin(self):
        self.add_rule();self.set_frozen('original',{'factory':{'template':'story'}})
        with patch.object(feedback,'_frozen_job',side_effect=lambda p:p['frozen_job']):policy=feedback.ensure_rule_jobs(self.q)[0]
        feedback.claim(self.q,policy['id']);self.q.add('replacement','review')
        feedback.complete(self.q,policy['id'],replacement_ids=['replacement'],current_feedback='',summary='Verified policy repair')
        with self.assertRaises(ValueError):feedback.record_learnings(self.q,policy['id'],[{'scope':'global','rule':'Unexpected new learning'}])
    def test_invalid_rules_roll_back_completed_and_aliases(self):
        job=self.scan()[0];feedback.claim(self.q,job['id'])
        with self.assertRaises(ValueError):self.finish(job,learnings=[{'scope':'global','rule':'New','supersedes':['missing']}])
        self.assertEqual(feedback.get(self.q,job['id'])['status'],'running');self.assertEqual(feedback.rules(self.q),[])

if __name__=='__main__':unittest.main()
