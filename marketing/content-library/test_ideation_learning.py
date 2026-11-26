import json
import tempfile
import unittest
from pathlib import Path

import autonomous
import content_pipeline
import machine


class IdeationLearningTests(unittest.TestCase):
    def test_rules_keep_scope_and_observations_link_only_to_exact_concept(self):
        with tempfile.TemporaryDirectory() as raw:
            root=Path(raw).resolve();store=content_pipeline.Store(root/'ledger.sqlite3')
            run,_=store.claim_stage('ideation','fixture','2026-11-01T00:00:00Z')
            concept=store.save_concepts(run,[{'audience':'Teens','format':'equation-choice','hook_he':'איזה צעד שומר על השוויון?'}])[0]
            store.save_content_item('concept-'+concept,concept,'P123-artifact','verified',{'format':'equation-choice','audience':'Teens'})
            queue=machine.Queue(root/'queue.sqlite3')
            queue.db.execute("INSERT INTO feedback_rules(id,scope,format_id,rule,origin,state,revision) VALUES('g','global',NULL,'Keep captions clear','feedback','active',1)")
            queue.db.execute("INSERT INTO feedback_rules(id,scope,format_id,rule,origin,state,revision) VALUES('f','format','equation-choice','Use one equation per screen','feedback','active',1)")
            queue.db.execute("INSERT INTO observations(id,payload) VALUES('o',?)",(json.dumps({'provider':'buffer','network':'instagram','account':'brand','provider_post_id':'remote','artifact_id':'P123-artifact','window_start':'2026-10-01T00:00:00Z','window_end':'2026-10-08T00:00:00Z','metrics':{'views':100,'conversions':99},'utm_content':'other-artifact'}),))
            context=autonomous._idea_context({'ideation_context':{'verified_features':[]},'creative_preferences':[{'scope':'global','rule':'Keep captions clear'},{'scope':'format','format_id':'equation-choice','rule':'Use one equation per screen'}]}, {'ideas':[]},2,store,queue)
            self.assertEqual([r['scope'] for r in context['active_rules']],['global','format'])
            self.assertEqual(context['outcome_summary'][0]['concept_id'],concept)
            self.assertEqual(context['outcome_summary'][0]['conversion_attribution'],'unknown')
            self.assertIsNone(context['outcome_summary'][0]['metrics']['conversions'])
            self.assertNotIn('comment',json.dumps(context))
            queue.close();store.close()

    def test_unlinked_observation_does_not_claim_concept_lineage(self):
        with tempfile.TemporaryDirectory() as raw:
            root=Path(raw).resolve();store=content_pipeline.Store(root/'ledger.sqlite3');queue=machine.Queue(root/'queue.sqlite3')
            queue.db.execute("INSERT INTO observations(id,payload) VALUES('o',?)",(json.dumps({'provider':'buffer','network':'instagram','account':'brand','provider_post_id':'remote','artifact_id':'P999','window_start':'2026-10-01T00:00:00Z','window_end':'2026-10-08T00:00:00Z','metrics':{'views':9}}),))
            context=autonomous._idea_context({}, {'ideas':[]},2,store,queue)
            self.assertIsNone(context['outcome_summary'][0]['concept_id'])
            queue.close();store.close()


if __name__=='__main__':unittest.main()
