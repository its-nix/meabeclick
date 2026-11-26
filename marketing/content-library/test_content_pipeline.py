import sqlite3
import tempfile
import unittest
from pathlib import Path

import content_pipeline


class ContentPipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'pipeline.sqlite3'
        self.store = content_pipeline.Store(self.path)

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def test_schema_migrates_and_persists_stage_and_concept_records(self):
        run, created = self.store.claim_stage('ideation', 'fingerprint-a', '2026-11-18T09:00:00Z')
        self.assertTrue(created)
        concept_id = self.store.save_concepts(run, [{'hook_he': 'מי אמר שחייבים להתחיל משמאל?'}])[0]
        self.store.transition_concept(concept_id, 'candidate', 'production_ready', 'supported by current renderer')
        self.store.close()
        reopened = content_pipeline.Store(self.path)
        try:
            self.assertEqual(len(reopened.ready_concepts(1)), 1)
            self.assertEqual(reopened.snapshot('2026-11-18T10:00:00Z')['counts']['concepts'], 1)
        finally:
            reopened.close()

    def test_stage_fingerprint_claim_is_idempotent(self):
        first, created_first = self.store.claim_stage('ideation', 'same-input', '2026-11-18T09:00:00Z')
        second, created_second = self.store.claim_stage('ideation', 'same-input', '2026-11-18T09:01:00Z')
        self.assertTrue(created_first)
        self.assertFalse(created_second)
        self.assertEqual(first, second)
        self.assertEqual(self.store.snapshot('2026-11-18T10:00:00Z')['counts']['stage_runs'], 1)

    def test_held_stage_can_be_reclaimed_after_cooldown_with_same_input(self):
        run, created = self.store.claim_stage('ideation', 'retry-fingerprint', '2026-11-18T09:00:00Z')
        self.assertTrue(created)
        self.store.finish_stage(run, 'held', {'error': 'temporary'}, '2026-11-18T09:01:00Z')
        retry, retry_created = self.store.claim_stage('ideation', 'retry-fingerprint', '2026-11-19T09:00:00Z')
        self.assertEqual(retry, run)
        self.assertTrue(retry_created)

    def test_invalid_state_transition_is_rejected(self):
        run, _ = self.store.claim_stage('ideation', 'f1', '2026-11-18T09:00:00Z')
        concept_id = self.store.save_concepts(run, [{'hook_he': 'פתיחה חדשה'}])[0]
        with self.assertRaisesRegex(ValueError, 'transition'):
            self.store.transition_concept(concept_id, 'rejected', 'production_ready', 'bad transition')

    def test_concept_write_is_idempotent_and_generates_stable_id(self):
        run, _ = self.store.claim_stage('ideation', 'f1', '2026-11-18T09:00:00Z')
        concepts = [{'audience': 'Teens', 'hook_he': 'איזה צעד שומר על השוויון?', 'premise': 'test'}]
        first = self.store.save_concepts(run, concepts)
        second = self.store.save_concepts(run, concepts)
        self.store.transition_concept(first[0], 'candidate', 'production_ready', 'selected')
        self.assertEqual(first, second)
        self.assertEqual(len(self.store.ready_concepts(10)), 1)

    def test_content_item_is_bound_to_concept_and_exact_artifact(self):
        run,_=self.store.claim_stage('ideation','lineage','2026-11-18T09:00:00Z')
        concept=self.store.save_concepts(run,[{'hook_he':'מה השלב הבא?'}])[0]
        self.store.save_content_item('item-1',concept,'P123-abcd','verified',{'bundle':'/artifacts/P123-abcd'})
        self.store.save_content_item('item-1',concept,'P123-abcd','verified',{'bundle':'/artifacts/P123-abcd'})
        with self.assertRaisesRegex(ValueError,'different artifact'):
            self.store.save_content_item('item-1',concept,'P123-other','verified',{'bundle':'/artifacts/P123-other'})

    def test_review_batch_is_unique_and_minutes_must_be_valid(self):
        self.store.record_review('W001', 24, True, '2026-11-18T10:00:00Z', planned_count=2)
        self.store.record_review('W001', 24, True, '2026-11-18T10:00:00Z', planned_count=2)
        self.assertEqual(self.store.snapshot('2026-11-18T10:01:00Z')['counts']['review_batches'], 1)
        self.store.record_review('W002', None, True, '2026-11-18T10:00:00Z', planned_count=2)
        self.assertEqual(content_pipeline.review_target(self.store,now='2026-11-18T11:00:00Z')['target'], 2)
        for value in (-1, 1.5, '30'):
            with self.subTest(minutes=value), self.assertRaises(ValueError):
                self.store.record_review('W002', value, True, '2026-11-18T10:00:00Z', planned_count=2)

    def test_incomplete_review_batch_does_not_change_target(self):
        result = content_pipeline.review_target(self.store, default=2, budget_minutes=30, max_items=20)
        self.assertEqual(result['target'], 2)
        self.assertIn('no completed review', result['reason'])
        self.store.record_review('W001', 15, False, '2026-11-18T10:00:00Z', planned_count=2)
        result = content_pipeline.review_target(self.store, default=2, budget_minutes=30, max_items=20)
        self.assertEqual(result['target'], 2)

    def test_review_minutes_can_arrive_after_batch_identity_is_created(self):
        self.store.record_review('W003',None,False,'2026-11-18T10:00:00Z',planned_count=2)
        self.store.record_review('W003',24,True,'2026-11-19T10:00:00Z',planned_count=2)
        self.assertEqual(content_pipeline.review_target(self.store,now='2026-11-20T10:00:00Z')['target'],3)
        with self.assertRaisesRegex(ValueError,'immutable'):
            self.store.record_review('W003',25,True,'2026-11-20T10:00:00Z',planned_count=2)

    def test_over_budget_returns_last_proven_size_and_backlog_holds_target(self):
        self.store.record_review('W010',20,True,'2026-11-10T10:00:00Z',planned_count=2)
        self.store.record_review('W011',25,True,'2026-11-11T10:00:00Z',planned_count=3)
        self.store.record_review('W012',34,True,'2026-11-12T10:00:00Z',planned_count=4)
        self.assertEqual(content_pipeline.review_target(self.store)['target'],3)
        self.store.record_review('W013',18,True,'2026-11-13T10:00:00Z',planned_count=3,backlog=2)
        self.assertEqual(content_pipeline.review_target(self.store)['target'],3)

    def test_review_target_never_exceeds_twenty_per_week(self):
        self.store.record_review('W020',22,True,'2026-11-14T10:00:00Z',planned_count=20)
        self.assertEqual(content_pipeline.review_target(self.store,now='2026-11-18T10:00:00Z')['target'],20)

    def test_stale_review_duration_holds_last_demonstrated_size(self):
        self.store.record_review('W030',12,True,'2026-08-01T10:00:00Z',planned_count=6)
        result=content_pipeline.review_target(self.store,default=2,now='2026-11-18T10:00:00Z')
        self.assertEqual(result['target'],6)
        self.assertIn('stale',result['reason'])

    def test_transaction_rolls_back_after_exception(self):
        with self.assertRaises(RuntimeError):
            with self.store.transaction():
                self.store.db.execute("INSERT INTO events(event_type, entity_id, detail, created_at) VALUES('probe','x','{}','now')")
                raise RuntimeError('interrupt')
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM events').fetchone()[0], 0)


if __name__ == '__main__':
    unittest.main()
