import tempfile
import unittest
from pathlib import Path

import content_pipeline
import idea_generation


NOW = '2026-11-18T10:00:00+02:00'
BASE = {
    'audience': 'Teens', 'hook_he': 'איזה צעד שומר על השוויון?',
    'premise': 'פתור משוואה בלי לבצע את כל התרגיל.',
    'beats': ['משוואה מופיעה', 'שלוש פעולות מוצעות', 'הפעולה הנכונה מאזנת'],
    'payoff': 'הצעד הנכון שומר על שני אגפי המשוואה.', 'cta': 'כתבו מה הייתם עושים.',
    'format': 'equation-choice', 'math_spec': {'equation': '2x+4=12', 'answer': 4},
    'claims': [], 'source_needs': [], 'production_requirements': ['equation', 'choice-cards'],
    'novelty_rationale': 'הבחירה מתמקדת בצעד הראשון ולא בתשובה.'
}


class IdeaGenerationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = content_pipeline.Store(Path(self.temp.name) / 'pipeline.sqlite3')
        self.context = {'ready_per_week': 2, 'historical_ideas': [], 'active_rules': [],
                        'completed_feedback_summary': [], 'verified_features': [],
                        'supported_primitives': ['equation', 'choice-cards'],
                        'recent_hooks': []}

    def tearDown(self):
        self.store.close()
        self.temp.cleanup()

    def test_noop_cadence_does_not_call_model_when_inventory_covers_reserve(self):
        run, _ = self.store.claim_stage('ideation', 'seed', NOW)
        ids = self.store.save_concepts(run, [BASE, dict(BASE, hook_he='מהו הצעד הראשון?'), dict(BASE, hook_he='איזה חלק מהשלם צבוע?'), dict(BASE, hook_he='אפשר לפתור בלי לחשב הכול?')])
        for concept_id in ids:
            self.store.transition_concept(concept_id, 'candidate', 'production_ready', 'fixture')
        calls = []
        result = idea_generation.generate_due(self.store, self.context,
            lambda *_: calls.append(True), NOW,
            {'last_generated_at': NOW, 'weekly_interval_days': 7, 'reserve_weeks': 2,
             'refill_weeks': 4, 'max_candidates': 12})
        self.assertFalse(result['called'])
        self.assertEqual(calls, [])

    def test_repeat_tick_does_not_call_model_again_after_low_inventory_refill(self):
        calls=[]
        runner=lambda *_: calls.append(True) or {'concepts':[BASE]}
        policy={'last_generated_at':'2026-11-01T10:00:00+02:00','weekly_interval_days':7,
                'reserve_weeks':2,'refill_weeks':4,'max_candidates':12}
        first=idea_generation.generate_due(self.store,self.context,runner,NOW,policy)
        second=idea_generation.generate_due(self.store,self.context,runner,NOW,policy)
        self.assertEqual(first['status'],'completed')
        self.assertEqual(second['called'],False)
        self.assertEqual(len(calls),1)

    def test_short_daily_calendar_refills_twice_same_day_but_not_every_tick(self):
        calls = []
        def runner(*_):
            calls.append(True)
            return {'concepts': []}
        policy = {'calendar_floor': 30, 'reserve_count': 37}
        first = idea_generation.generate_due(self.store, self.context, runner, NOW, policy)
        early = idea_generation.generate_due(self.store, self.context, runner, '2026-11-18T11:59:00+02:00', policy)
        second = idea_generation.generate_due(self.store, self.context, runner, '2026-11-18T12:00:00+02:00', policy)
        self.assertTrue(first['called'])
        self.assertFalse(early['called'])
        self.assertTrue(second['called'])
        self.assertEqual(len(calls), 2)

    def test_short_calendar_replenishes_after_one_hour_when_last_refill_found_ideas(self):
        calls = []
        def model(*_):
            calls.append(True)
            return {'concepts':[BASE] if len(calls)==1 else []}

        policy = {'calendar_floor':30,'reserve_count':37}
        first = idea_generation.generate_due(self.store,self.context,model,NOW,policy)
        self.assertEqual(first['accepted'],1)
        early = idea_generation.generate_due(
            self.store,self.context,model,'2026-11-18T10:59:00+02:00',policy)
        self.assertFalse(early['called'])
        next_ = idea_generation.generate_due(
            self.store,self.context,model,'2026-11-18T11:00:00+02:00',policy)
        self.assertTrue(next_['called'])
        self.assertEqual(next_['accepted'],0)
        backoff = idea_generation.generate_due(
            self.store,self.context,model,'2026-11-18T12:00:00+02:00',policy)
        self.assertFalse(backoff['called'])
        self.assertEqual(len(calls),2)

    def test_empty_daily_inventory_refills_after_consumption_without_retry_loop(self):
        calls = []
        def model(*_):
            calls.append(True)
            return {'concepts':[BASE] if len(calls)==1 else []}

        policy = {'calendar_floor':30,'reserve_count':37}
        first = idea_generation.generate_due(self.store,self.context,model,NOW,policy)
        self.assertEqual(first['accepted'],1)
        idea, = self.store.ready_concepts(10)
        self.store.transition_concept(idea['id'],'production_ready','selected','used for a video')
        refill = idea_generation.generate_due(
            self.store,self.context,model,'2026-11-18T10:15:00+02:00',policy)
        self.assertTrue(refill['called'])
        self.assertEqual(refill['accepted'],0)
        idle = idea_generation.generate_due(
            self.store,self.context,model,'2026-11-18T10:30:00+02:00',policy)
        self.assertFalse(idle['called'])
        self.assertEqual(len(calls),2)

    def test_generation_validates_audience_and_rejects_near_duplicate_hooks(self):
        duplicate = dict(BASE, hook_he='איזה צעד שומר על השוויון?!')
        bad_audience = dict(BASE, hook_he='פתיחה אחרת', audience='Everyone')
        response = {'concepts': [BASE, duplicate, bad_audience]}
        result = idea_generation.generate_due(self.store, self.context,
            lambda *_: response, NOW,
            {'last_generated_at': '2026-11-01T10:00:00+02:00', 'weekly_interval_days': 7,
             'reserve_weeks': 2, 'refill_weeks': 4, 'max_candidates': 12})
        self.assertEqual(result['accepted'], 1)
        self.assertGreaterEqual(result['rejected'], 2)
        self.assertEqual(len(self.store.ready_concepts(10)), 1)
        self.assertEqual(self.store.snapshot(NOW)['concept_counts']['production_ready'], 1)

    def test_generation_prompt_includes_active_rules_and_verified_feedback_without_private_data(self):
        context = dict(self.context, active_rules=[{'scope': 'global', 'rule': 'Keep Hebrew text centered.'}],
                       completed_feedback_summary=['Remove written caption sign-off.'],
                       student_records=['must not be included'])
        seen = []
        def runner(prompt, schema):
            seen.append(prompt)
            return {'concepts': [BASE]}
        idea_generation.generate_due(self.store, context, runner, NOW,
            {'last_generated_at': '2026-11-01T10:00:00+02:00', 'weekly_interval_days': 7,
             'reserve_weeks': 2, 'refill_weeks': 4, 'max_candidates': 12})
        self.assertIn('Keep Hebrew text centered.', seen[0])
        self.assertIn('Remove written caption sign-off.', seen[0])
        self.assertNotIn('student_records', seen[0])

    def test_malformed_model_output_is_held_and_not_saved(self):
        result = idea_generation.generate_due(self.store, self.context, lambda *_: {'not_concepts': []}, NOW,
            {'last_generated_at': '2026-11-01T10:00:00+02:00', 'weekly_interval_days': 7,
             'reserve_weeks': 2, 'refill_weeks': 4, 'max_candidates': 12})
        self.assertEqual(result['status'], 'held')
        self.assertEqual(self.store.snapshot(NOW)['counts']['concepts'], 0)

    def test_claims_without_evidence_and_unsupported_formats_are_rejected(self):
        unsupported = dict(BASE, format='website_demo', claims=['The app tracks every skill.'])
        context = dict(self.context, verified_features=[])
        result = idea_generation.generate_due(self.store, context,
            lambda *_: {'concepts': [unsupported]}, NOW,
            {'last_generated_at': '2026-11-01T10:00:00+02:00', 'weekly_interval_days': 7,
             'reserve_weeks': 2, 'refill_weeks': 4, 'max_candidates': 12})
        self.assertEqual(result['accepted'], 0)
        self.assertEqual(result['rejected'], 1)


if __name__ == '__main__':
    unittest.main()
