import copy
import json
from pathlib import Path
import unittest
import factory
import planner

class PlannerTests(unittest.TestCase):
    def setUp(self): self.snapshot=json.loads(Path(__file__).with_name('library.json').read_text())
    def test_library_fallback_is_two_valid_distinct_tip_variations(self):
        result=planner.weekly_plan(self.snapshot,'2026-11-22')
        self.assertEqual(len(result['requests']),2)
        self.assertTrue(all(r['post_id']=='P003' for r in result['requests']))
        self.assertNotEqual(result['requests'][0]['parameters'],result['requests'][1]['parameters'])
        self.assertEqual(len(factory.plan_batch(self.snapshot,result['requests'])),2)
        self.assertEqual(result['status'],'proposal');self.assertEqual(result['approval'],'required')
        self.assertEqual(result['slots'],['2026-11-22T19:30:00+02:00','2026-11-25T19:30:00+02:00'])
    def test_weekly_determinism_variation_and_day_normalization(self):
        before=copy.deepcopy(self.snapshot)
        first=planner.weekly_plan(self.snapshot,'2026-11-22')
        self.assertEqual(first,planner.weekly_plan(self.snapshot,'2026-11-25'))
        second=planner.weekly_plan(self.snapshot,'2026-11-29')
        self.assertNotEqual(first['requests'][0]['parameters'],second['requests'][0]['parameters'])
        self.assertEqual(self.snapshot,before)
        for request in first['requests']+second['requests']: self.assertTrue(20<=request['parameters']['start']<=79)
    def test_native_parent_recipe_is_selected_without_legacy_maze(self):
        parent=copy.deepcopy(self.snapshot['queue'][0]);parent['id']='P004';self.snapshot['queue'].append(parent)
        recipe=copy.deepcopy(self.snapshot['recipes'][0]);recipe[0]='R004PAPER';recipe[1]='P004';self.snapshot['recipes'].append(recipe)
        result=planner.weekly_plan(self.snapshot,'2026-11-22')
        self.assertEqual(result['requests'][1]['post_id'],'P004')
        self.assertEqual(result['requests'][1]['recipe_id'],'R004PAPER')
        self.assertEqual(len(factory.plan_batch(self.snapshot,result['requests'])),2)
    def test_incompatible_parent_falls_back_and_missing_tip_blocks(self):
        parent=copy.deepcopy(self.snapshot['queue'][0]);parent['id']='P004';self.snapshot['queue'].append(parent)
        recipe=copy.deepcopy(self.snapshot['recipes'][0]);recipe[0]='R004PAPER';recipe[1]='P004';recipe[3]='H999@1';self.snapshot['recipes'].append(recipe)
        self.assertTrue(all(r['post_id']=='P003' for r in planner.weekly_plan(self.snapshot,'2026-11-22')['requests']))
        self.snapshot['recipes']=[r for r in self.snapshot['recipes'] if r[0]!='R003']
        result=planner.weekly_plan(self.snapshot,'2026-11-22')
        self.assertEqual(result['requests'],[]);self.assertEqual(result['slots'],[])
    def test_observations_must_be_closed_and_do_not_establish_winners(self):
        row={'artifact_id':'a','provider_post_id':'p','window_start':'2099-01-01T00:00:00Z','window_end':'2099-01-08T00:00:00Z','metrics':{'reach':100}}
        with self.assertRaises(ValueError):planner.weekly_plan(self.snapshot,'2026-11-22',[row])
        row.update(window_start='2026-11-01T00:00:00Z',window_end='2026-11-08T00:00:00Z')
        result=planner.weekly_plan(self.snapshot,'2026-11-22',[row])
        self.assertIsNone(result['experiment']['winner']);self.assertIn('proposal',result['experiment']['status'])
    def test_summer_slots_use_jerusalem_daylight_time(self):
        self.assertEqual(planner.weekly_plan(self.snapshot,'2027-06-06')['slots'][0],'2027-06-06T19:30:00+03:00')

if __name__=='__main__':unittest.main()
