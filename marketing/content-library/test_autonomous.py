import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import autonomous
import content_pipeline
import machine


class AutonomousControllerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name).resolve()
        self.store=content_pipeline.Store(self.root/'content-pipeline.sqlite3')
        run,_=self.store.claim_stage('ideation','fixture','2026-11-18T08:00:00Z')
        self.concept={'id':None,'audience':'Teens','hook_he':'מה קורה כשמחלקים לשניים?',
          'premise':'בדיקה','beats':['פתיחה','פתרון'],'payoff':'תשובה','cta':'כתבו תשובה',
          'format':'fraction-compare','math_spec':{},'claims':[],'source_needs':[],
          'production_requirements':['fraction-bars'],'novelty_rationale':'שאלה קצרה וממוקדת.'}
        self.concept_id=self.store.save_concepts(run,[{k:v for k,v in self.concept.items() if k!='id'}])[0]
        self.store.transition_concept(self.concept_id,'candidate','production_ready','fixture')
        self.store.close()
        self.q=machine.Queue(self.root/'queue.sqlite3')

    def tearDown(self):self.q.close();self.temp.cleanup()

    def test_ready_idea_flows_to_drive_review_log_and_human_review(self):
        class Drive:
            def __init__(self):self.idea_rows=None;self.records=None
            def append_generated_ideas(self,sid,rows,state):self.idea_rows=rows;return {'status':'appended','appended':len(rows)}
            def sync_review_log(self,sid,records,state,sheet_id=None):
                self.records=records
                return {'status':'synced','sheet_id':12,'rows':[['batch_id','planned_count','review_minutes','completed_at','worker_note']]+[[r['batch_id'],r['planned_count'],'',r['completed_at'],r['worker_note']] for r in records]}
        google=Drive();calls=[];review_sync_calls=[]
        def prepare(concept_id,root,context,slot,**kwargs):
            calls.append((concept_id,kwargs.get('destinations'),kwargs.get('review_batch_id')))
            return {'verification_status':'ready_for_human','artifact_id':'P123-example','bundle':'/tmp/bundle','scheduled_at':slot,
                    'preview_url':'https://drive.google.com/file/d/file123/view','preview_kind':'hosted','creative_verification':{'status':'pass'},'problems':[],
                    'jobs':['verified-channel-job'] if kwargs.get('destinations') else []}
        def asset_store(client,item,cfg,root,queue=None):return {'webViewLink':'https://drive.google.com/file/d/file123/view','file_id':'file123','revision_id':'rev-1'}
        result=autonomous.run({'initial_review_target':2,'prepare_enabled':True,'spreadsheet_id':'sheet','drive_posts_folder_id':'folder',
            'destinations':[{'network':'instagram','account':'brand'}],'ideation_context':{'brand_brief':'math content','verified_features':[]}},
            self.root,google,{'ideas':[]},self.q,now=datetime(2026,11,18,10,0,tzinfo=ZoneInfo('Asia/Jerusalem')),
            ideator=lambda *_:{'concepts':[]},preparer=prepare,asset_store=asset_store,
            on_review_ready=lambda:review_sync_calls.append(len(calls)))
        self.assertEqual(len(calls),2)
        self.assertEqual(review_sync_calls,[2])
        self.assertEqual(calls[0][1],None);self.assertEqual(calls[1][1],[{'network':'instagram','account':'brand'}])
        self.assertEqual(calls[0][2],'review-2026-W47')
        self.assertEqual(result['target'],2)
        self.assertEqual(google.records[0]['planned_count'],1)
        self.assertEqual(result['prepared'][0]['verification_status'],'ready_for_human')

    def test_daily_production_only_prepares_dates_after_sunday_review(self):
        store = content_pipeline.Store(self.root/'content-pipeline.sqlite3')
        run = store.db.execute("SELECT id FROM stage_runs WHERE fingerprint='fixture'").fetchone()[0]
        payload = {k:v for k,v in self.concept.items() if k!='id'}
        extra = store.save_concepts(run, [{**payload, 'hook_he':f'Yellow card {n}'} for n in range(11)])
        for concept_id in extra:
            store.transition_concept(concept_id, 'candidate', 'production_ready', 'fixture')
        store.close()
        prepared = []
        def prepare(_id, _root, _context, slot, **kwargs):
            prepared.append((slot, kwargs['review_batch_id']))
            return {'verification_status':'held', 'problems':[]}

        cfg = {'daily_calendar_enabled':True,'prepare_enabled':True,
               'idea_policy':{'last_generated_at':'2026-11-24T06:00:00Z'}}
        result = autonomous.run(cfg,self.root,None,{},self.q,
            now=datetime(2026,11,24,8,tzinfo=ZoneInfo('Asia/Jerusalem')),
            ideator=lambda *_:self.fail('Independent daily tick must honor ideation cooldown'),
            preparer=prepare)
        self.assertEqual(result['target'],7)
        store = content_pipeline.Store(self.root/'content-pipeline.sqlite3')
        batch = store.db.execute('SELECT planned_count,completed FROM review_batches WHERE batch_id=?',
                                 ('review-2026-W49',)).fetchone()
        self.assertEqual(tuple(batch), (7, 0))
        store.close()
        self.assertEqual(prepared, [
            ('2026-11-30T19:30:00+02:00','review-2026-W49'),
            ('2026-12-01T19:30:00+02:00','review-2026-W49'),
        ])

    def test_ideator_sees_premise_and_payoff_of_previous_held_concept(self):
        import idea_generation
        store = content_pipeline.Store(self.root/'content-pipeline.sqlite3')
        self.addCleanup(store.close)
        store.transition_concept(self.concept_id,'production_ready','held','fixture')
        context = autonomous._idea_context({}, {}, 7, store, self.q)
        prompt = idea_generation._prompt(context, 8)
        self.assertIn('"premise": "בדיקה"', prompt)
        self.assertIn('"payoff": "תשובה"', prompt)
        self.assertIn('"format": "fraction-compare"', prompt)

    def test_scarce_idea_goes_to_next_owner_review_batch(self):
        attempted = []
        def prepare(_id, _root, _context, slot, **kwargs):
            attempted.append((slot, kwargs['review_batch_id']))
            return {'verification_status':'held', 'problems':[]}

        autonomous.run({'daily_calendar_enabled':True,'prepare_enabled':True,
                        'idea_policy':{'last_generated_at':'2026-11-24T06:00:00Z'}},
            self.root,None,{},self.q,
            now=datetime(2026,11,24,8,tzinfo=ZoneInfo('Asia/Jerusalem')),
            ideator=lambda *_:self.fail('No model needed while ideation is cooling down'),
            preparer=prepare)
        self.assertEqual(attempted,[('2026-11-30T19:30:00+02:00','review-2026-W49')])

    def test_expired_unapproved_channel_copies_do_not_count_as_owner_review(self):
        store = content_pipeline.Store(self.root/'content-pipeline.sqlite3')
        now = '2026-11-30T09:00:00+02:00'
        store.record_review('review-2026-W49',None,False,now,planned_count=1)
        expired = [{'id':net, 'status':'failed', 'approval_sha':None, 'artifact':'video',
                    'package':{'review_batch_id':'review-2026-W49'}} for net in ('ig','fb')]
        class QueueView:
            def rows(self): return expired
        record, = autonomous._batch_records(store, QueueView(), now)
        self.assertEqual(record['completed_at'], '')
        self.assertIn('0/1', record['worker_note'])
        store.close()

    def test_daily_calendar_retains_assignment_across_restarts_and_replaces_held_concept(self):
        now = datetime(2026, 11, 24, 10, tzinfo=ZoneInfo('Asia/Jerusalem'))
        ledger = self.root / 'content-pipeline.sqlite3'
        store = content_pipeline.Store(ledger)
        first = autonomous.daily_calendar(store, now, [])
        self.assertEqual(first[0]['concept_id'], self.concept_id)
        self.assertEqual(first[0]['hook_he'], self.concept['hook_he'])
        self.assertEqual(len(first), 30)
        self.assertTrue(all(slot['state']=='unfilled' for slot in first[1:]))
        store.close()

        store = content_pipeline.Store(ledger)
        self.assertEqual(autonomous.daily_calendar(store, now, []), first)
        store.transition_concept(self.concept_id, 'production_ready', 'held', 'Render failed')
        slots = autonomous.daily_calendar(store, now, [])
        self.assertEqual(slots[0]['state'], 'unfilled')
        store.close()

    def test_unproduced_reservation_before_next_review_moves_to_review_week(self):
        import planner
        now = datetime(2026, 11, 24, 10, tzinfo=ZoneInfo('Asia/Jerusalem'))
        store = content_pipeline.Store(self.root/'content-pipeline.sqlite3')
        self.addCleanup(store.close)
        initial = autonomous.daily_calendar(store, now, [])
        self.assertEqual(initial[0]['concept_id'], self.concept_id)

        review_days = planner.next_review_week(now)
        calendar = autonomous.daily_calendar(store, now, [], review_days=review_days)
        self.assertEqual(calendar[0]['state'], 'unfilled')
        monday = next(day for day in calendar if day['date']=='2026-11-30')
        self.assertEqual(monday['concept_id'], self.concept_id)
        slots = store.db.execute('SELECT scheduled_at FROM calendar_slots WHERE concept_id=?',
                                 (self.concept_id,)).fetchall()
        self.assertEqual([row[0] for row in slots], [monday['scheduled_at']])

    def test_review_gap_can_reuse_later_unrendered_reservation(self):
        import planner
        now = datetime(2026, 11, 24, 10, tzinfo=ZoneInfo('Asia/Jerusalem'))
        review_days = planner.next_review_week(now)
        store = content_pipeline.Store(self.root/'content-pipeline.sqlite3')
        self.addCleanup(store.close)
        later = '2026-12-07T19:30:00+02:00'
        store.db.execute('INSERT INTO calendar_slots(scheduled_at,concept_id) VALUES(?,?)',
                         (later,self.concept_id))

        calendar = {row['date']:row for row in autonomous.daily_calendar(store,now,[],review_days=review_days)}
        monday = review_days[0].isoformat()
        self.assertEqual(calendar[monday]['concept_id'],self.concept_id)
        self.assertEqual(calendar['2026-12-07']['state'],'unfilled')
        slots = store.db.execute('SELECT scheduled_at FROM calendar_slots WHERE concept_id=?',
                                 (self.concept_id,)).fetchall()
        self.assertEqual([row[0] for row in slots],[calendar[monday]['scheduled_at']])

    def test_held_feedback_video_does_not_reserve_daily_slot_or_count_for_review(self):
        now = datetime(2026, 11, 24, 10, tzinfo=ZoneInfo('Asia/Jerusalem'))
        store = content_pipeline.Store(self.root/'content-pipeline.sqlite3')
        self.addCleanup(store.close)
        initial = autonomous.daily_calendar(store, now, [])
        slot = initial[0]['scheduled_at']
        batch = 'review-2026-W49'
        store.record_review(batch,None,False,now.isoformat(),planned_count=7)
        for old, new in [('production_ready','selected'),('selected','producing'),('producing','produced')]:
            store.transition_concept(self.concept_id,old,new,'fixture')
        store.save_content_item('concept-'+self.concept_id,self.concept_id,'P123-original','verified',{})
        job = {'id':'ig','artifact':'P123-revision','status':'review',
               'package':{'scheduled_at':slot,'review_batch_id':batch}}
        self.assertEqual(autonomous.daily_calendar(store,now,[job])[0]['state'],'queued')
        result = autonomous.daily_calendar(store,now,[job],held_artifacts={'P123-revision'})
        self.assertEqual(result[0]['state'],'unfilled')
        self.assertIsNone(result[0]['concept_id'])
        class QueueView:
            def rows(self):return [job]
        record, = autonomous._batch_records(store,QueueView(),now.isoformat(),held_artifacts={'P123-revision'})
        self.assertIn('0/7',record['worker_note'])
        self.assertIn('backlog: 0',record['worker_note'])

    def test_review_target_is_bounded_by_completed_human_batch(self):
        store=content_pipeline.Store(self.root/'capacity.sqlite3')
        store.record_review('review-2026-W46',20,True,'2026-11-10T10:00:00Z',planned_count=2,backlog=0)
        result=content_pipeline.review_target(store)
        self.assertEqual(result['target'],3)
        store.close()


if __name__=='__main__':unittest.main()
