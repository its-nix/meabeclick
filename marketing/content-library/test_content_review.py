import copy,json,unittest
from urllib.parse import unquote
import test_review_queue as fixtures
import content_review
import review_queue

class Google:
    def __init__(self,rows):self.deliveries=copy.deepcopy(rows);self.content=[content_review.HEADERS.copy()];self.writes=[]
    def _release_values(self,*args):return copy.deepcopy(self.deliveries)
    def _request(self,method,url,body=None):
        if '?fields=sheets' in url:return {'sheets':[{'properties':{'sheetId':2,'title':'Content'}}]}
        if method=='GET':return {'values':copy.deepcopy(self.content)}
        payload=json.loads(body);self.writes.append(payload)
        if 'data' not in payload:return {}
        for change in payload['data']:
            target=change['range'].split('!')[1];start=target.split(':')[0]
            col=''.join(c for c in start if c.isalpha());index=int(''.join(c for c in start if c.isdigit()))-1
            offset=0
            for char in col:offset=offset*26+ord(char)-64
            offset-=1
            table=self.deliveries if "'Releases'!" in change['range'] else self.content
            for values in change['values']:
                while len(table)<=index:table.append(['']*(16 if table is self.deliveries else 12))
                table[index][offset:offset+len(values)]=values;index+=1
        return {}
    def _write(self,state,intent,submit,verify):result=submit();verify(result);return result

class ContentReviewTests(unittest.TestCase):
    setUp=fixtures.ReviewQueueTests.setUp
    tearDown=fixtures.ReviewQueueTests.tearDown
    def start(self,carry=False):
        other=dict(self.package,network='facebook',account='fb-account');self.other=self.q.enqueue(other)
        self.g=Google(review_queue.release_rows(self.q))
        self.cfg={'spreadsheet_id':'test','releases_sheet_id':1,'content_review_sheet_id':2,'content_review_carry_approvals':carry}
        self.review=content_review.attach(self.g,self.cfg,self.q,self.root)
        self.review.sync();return self.g.content[1]
    def test_one_content_row_fans_out_to_all_destinations(self):
        row=self.start();self.assertEqual(len(self.g.content),2)
        row[3]=True
        review_queue.import_decisions(self.q,self.g._release_values('test',1))
        self.assertEqual({j['status'] for j in self.q.rows()},{'approved'})
    def test_migration_carries_owner_approval_without_duplicate_delivery(self):
        self.q.policy['credentials_healthy']=True;self.q.approve(self.key,'owner');self.q.begin_submission(self.key)
        self.q.receipt(self.key,{'provider':'buffer','id':'saved','status':'scheduled','package_sha256':self.key,'network':'instagram','account':'verified-account'})
        row=self.start(carry=True);self.assertTrue(row[3])
        review_queue.import_decisions(self.q,self.g._release_values('test',1))
        self.assertEqual(self.q.get(self.key)['status'],'scheduled');self.assertEqual(self.q.get(self.other)['status'],'approved')
    def test_no_approval_is_inferred_without_explicit_migration(self):
        self.q.approve(self.key,'owner');row=self.start();self.assertFalse(row[3])
    def test_owner_fields_are_never_rewritten_on_refresh(self):
        row=self.start();row[3:6]=[True,True,'make it clearer']
        self.review.sync();self.assertEqual(self.g.content[1][3:6],[True,True,'make it clearer'])
        for write in self.g.writes[1:]:
            for change in write.get('data',[]):self.assertTrue(change['range'].split('!')[1].startswith('I'))
    def test_old_distinct_comments_do_not_replay_on_migration(self):
        self.other=self.q.enqueue(dict(self.package,network='facebook',account='fb-account'))
        rows=review_queue.release_rows(self.q)
        for row in rows[1:]:row[13]='old '+row[2]
        self.g=Google(rows);self.cfg={'spreadsheet_id':'test','releases_sheet_id':1,'content_review_sheet_id':2}
        self.review=content_review.attach(self.g,self.cfg,self.q,self.root);self.review.sync()
        found=self.g._release_values('test',1)
        self.assertEqual([r[13] for r in found[1:]],[r[13] for r in rows[1:]])
        self.g.content[1][5]='new shared feedback'
        self.assertEqual({r[13] for r in self.g._release_values('test',1)[1:]},{'new shared feedback'})
    def test_unchecking_content_does_not_cancel_submitted_delivery(self):
        self.q.policy['credentials_healthy']=True;self.q.approve(self.key,'owner');self.q.begin_submission(self.key)
        self.q.receipt(self.key,{'provider':'buffer','id':'saved','status':'scheduled','package_sha256':self.key,'network':'instagram','account':'verified-account'})
        row=self.start();self.assertFalse(row[3])
        review_queue.import_decisions(self.q,self.g._release_values('test',1))
        self.assertEqual(self.q.get(self.key)['status'],'scheduled');self.assertEqual(self.q.get(self.other)['status'],'review')
    def test_changed_content_binding_cannot_reuse_checkbox(self):
        row=self.start();row[3]=True;row[7]='edited caption'
        with self.assertRaisesRegex(ValueError,'binding'):self.g._release_values('test',1)
    def test_later_connected_destination_inherits_exact_content_approval(self):
        row=self.start();row[3]=True
        third=self.q.enqueue(dict(self.package,network='instagram',account='second-account'))
        self.g.deliveries=review_queue.release_rows(self.q);self.review.sync()
        review_queue.import_decisions(self.q,self.g._release_values('test',1))
        self.assertEqual(self.q.get(third)['status'],'approved');self.assertEqual(len(self.g.content),2)
    def test_new_version_is_a_fresh_unchecked_content_row(self):
        self.start()[3]=True
        changed=self.q.enqueue(dict(self.package,caption='different caption',account='other'))
        self.g.deliveries=review_queue.release_rows(self.q);self.review.sync()
        self.assertEqual(len(self.g.content),3);self.assertFalse(self.g.content[-1][3])
    def test_completed_feedback_remains_bound_after_internal_rows_are_archived(self):
        row=self.start();row[5]='new feedback'
        self.g._release_values('test',1)
        for job in self.q.rows():self.q.cancel(job['id'],'fixture replacement')
        for item in self.g.deliveries[1:]:item[14]='Archived'
        self.assertEqual({r[13] for r in self.g._release_values('test',1)[1:]},{'new feedback'})
    def test_delivery_limits_count_content_once_across_three_channels(self):
        self.start()[3]=True
        third=self.q.enqueue(dict(self.package,network='instagram',account='second-account'))
        self.g.deliveries=review_queue.release_rows(self.q);self.review.sync()
        self.q.policy.update(credentials_healthy=True,content_review_sheet_id=2,daily_limit=1,monthly_limit=1)
        review_queue.import_decisions(self.q,self.g._release_values('test',1))
        for job in self.q.rows():
            self.q.begin_submission(job['id'])
            self.q.receipt(job['id'],{'provider':'buffer','id':job['id'],'status':'scheduled','package_sha256':job['id'],'network':job['network'],'account':job['account']})
        self.assertEqual(self.q.get(third)['status'],'scheduled')
    def test_deleted_review_row_cannot_restore_withdrawn_migration_approval(self):
        self.q.approve(self.key,'owner');row=self.start(carry=True)
        row[3]=False;self.review.sync();self.g.content=self.g.content[:1]
        with self.assertRaisesRegex(ValueError,'missing'):self.review.sync()
    def test_cached_write_receipt_cannot_claim_native_status_was_updated(self):
        self.start()
        self.g.content[1][8]='old status'
        self.g._write=lambda *args: {}
        with self.assertRaisesRegex(ValueError,'readback'):self.review.sync()

    def test_pre_submit_refresh_rechecks_the_target_decision(self):
        row = self.start()
        row[3] = True
        self.assertEqual(self.review.refresh_decisions(self.key),[self.key])
        self.assertEqual(self.q.get(self.key)['status'],'approved')
        self.assertEqual(self.q.get(self.other)['status'],'review')

        row[3] = False
        self.assertEqual(self.review.refresh_decisions(self.key),[])
        self.assertEqual(self.q.get(self.key)['status'],'review')

    def test_pre_submit_refresh_rejects_a_missing_target_row(self):
        row = self.start()
        row[3] = True
        self.review.refresh_decisions()
        self.g.deliveries = [r for r in self.g.deliveries if r[0]!=self.key]
        with self.assertRaisesRegex(ValueError,'exact release row'):
            self.review.refresh_decisions(self.key)

    def test_new_channel_append_uses_content_decision_in_real_release_sync(self):
        import google_sync
        row=self.start();row[3:5]=[True,True]
        self.review.refresh_decisions()
        third=self.q.enqueue(dict(self.package,network='instagram',account='new-account'))
        self.review.sync()
        google_sync.GoogleSync.sync_releases(self.g,'test',1,self.q,self.root/'intents')
        self.assertEqual(self.q.get(third)['status'],'approved')
        native=next(row for row in self.g.deliveries[1:] if row[0]==third)
        self.assertEqual(native[11:13],[True,True])

    def test_old_completed_rows_move_to_history_before_active_sheet_fills(self):
        import tempfile
        from pathlib import Path
        from datetime import datetime
        from zoneinfo import ZoneInfo
        class ArchiveGoogle:
            def __init__(self,rows):self.content=rows;self.history=[];self.has_history=False
            def _release_values(self,*args):return [review_queue.HEADERS]
            def _request(self,method,url,body=None):
                if '?fields=sheets' in url:
                    sheets=[{'properties':{'sheetId':2,'title':'Content'}}]
                    if self.has_history:sheets.append({'properties':{'sheetId':3,'title':'Content History'}})
                    return {'sheets':sheets}
                if method=='GET' and '/values/' in url:return {'values':copy.deepcopy(self.history if 'Content%20History' in url or 'Content%20History' in url else self.content)}
                payload=json.loads(body)
                if method=='POST' and ':batchUpdate' in url and '/values:' not in url:
                    request=payload['requests'][0]
                    if 'addSheet' in request:self.has_history=True;return {'replies':[{'addSheet':{'properties':{'sheetId':3,'title':'Content History'}}}]}
                    indexes=sorted((r['deleteDimension']['range']['startIndex'] for r in payload['requests']),reverse=True)
                    for index in indexes:self.content.pop(index)
                    return {}
                if method=='PUT':self.history.extend(payload['values']);return {}
                if method=='POST' and ':append?' in url:self.history.extend(payload['values']);return {}
                raise AssertionError((method,url))
            def _write(self,state,intent,submit,verify):
                result=submit();verify(result);return result
        rows=[content_review.HEADERS.copy()];state={'groups':{},'members':{}}
        for number in range(179):
            key=f'content-{number:03d}';status='Awaiting approval' if number==178 else 'Published'
            row=[key,'Old post','https://drive.google.com/video',True,False,'owner feedback','2026-10-01T19:30:00+03:00','caption',status,'provider result','a'*64,'No']
            rows.append(row);state['groups'][key]={'row':[row[0],row[1],row[2],row[6],row[7],row[10],row[11]],'registered':True}
        google=ArchiveGoogle(rows)
        with tempfile.TemporaryDirectory() as raw:
            root=Path(raw).resolve();review=content_review.Review(google,{'spreadsheet_id':'test','content_review_sheet_id':2},self.q,root);review.state=state
            archived=review.archive_completed(now=datetime(2026,11,18,tzinfo=ZoneInfo('Asia/Jerusalem')),threshold=180,limit=50)
            self.assertEqual(archived,50)
            self.assertEqual(len(google.content),130)
            self.assertEqual(len(google.history),51)
            self.assertEqual(google.content[-1][0],'content-178')
            self.assertEqual(review.owner_rows()[-1][5],'owner feedback')
            self.assertTrue(all(state['groups'][f'content-{n:03d}'].get('archived') for n in range(50)))
