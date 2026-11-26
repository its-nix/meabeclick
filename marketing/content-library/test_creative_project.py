import tempfile
import unittest
from pathlib import Path

import creative_projects


CONCEPT = {
    'id':'C123', 'audience':'Teens', 'hook_he':'מה השתנה בשורה הזאת?',
    'premise':'פתרו משוואה ושימו לב לפעולה הראשונה.',
    'beats':['המשוואה מופיעה','הפעולות מתפצלות','האיזון נשמר'],
    'payoff':'חיסור ארבעה משני האגפים נותן את אותו פתרון.',
    'cta':'כתבו איזו פעולה בחרתם.', 'format':'equation-choice',
    'math_spec':{'equation':'2x+4=12','answer':4}, 'claims':[], 'source_needs':[],
    'production_requirements':['equation','choice-cards'],
    'novelty_rationale':'הפתיחה מתמקדת בבחירת צעד ולא בחישוב הסופי.'
}

MANIFEST = {
    'html':'<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><script src="assets/gsap.min.js"></script><style>@font-face{font-family:Heb;src:url("assets/fonts/heebo-hebrew-wght-normal.woff2")}@font-face{font-family:Lat;src:url("assets/fonts/heebo-latin-wght-normal.woff2")}</style></head><body><main id="root" data-composition-id="main" data-start="0" data-duration="15" data-width="1080" data-height="1920" data-fps="30"><h1>מה השתנה?</h1></main><script>window.__timelines=window.__timelines||{};window.__timelines.main=gsap.timeline({paused:true});</script></body></html>',
    'caption':'פתרו משוואה ובחרו את הצעד הראשון.',
    'alt_text':'משוואה מתפצלת לשלוש פעולות אפשריות, והפעולה המאוזנת נשארת.',
    'cta_category':'educational',
    'timeline':[{'start':0,'end':3,'action':'Hook'}, {'start':3,'end':12,'action':'Choice'}, {'start':12,'end':15,'action':'Payoff'}],
    'math_assertions':[{'expression':'(12-4)/2','result':4}],
    'claims_evidence':[], 'remote_assets':[]
}


class CreativeProjectTests(unittest.TestCase):
    def test_valid_project_is_written_with_pinned_local_brand_assets(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as raw:
            result=creative_projects.create_project(CONCEPT, {'verified_features':[]}, lambda *_: MANIFEST, Path(raw).resolve())
            self.assertEqual(result['status'],'ready')
            self.assertTrue((Path(result['project'])/'index.html').is_file())
            self.assertTrue((Path(result['project'])/'assets/logo.svg').is_file())
            self.assertTrue((Path(result['project'])/'assets/fonts/heebo-hebrew-wght-normal.woff2').is_file())
            self.assertEqual(result['manifest']['caption'], MANIFEST['caption'])

    def test_completed_project_can_be_reused_after_worker_restart(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as raw:
            root=Path(raw).resolve()
            first=creative_projects.create_project(CONCEPT,{'verified_features':[]},lambda *_:MANIFEST,root)
            second=creative_projects.create_project(CONCEPT,{'verified_features':[]},lambda *_:self.fail('must reuse exact project'),root)
            self.assertEqual(first['project'],second['project'])

    def test_concept_id_cannot_escape_project_directory(self):
        bad=dict(CONCEPT,id='../escape')
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as raw:
            with self.assertRaisesRegex(ValueError,'safe concept ID'):
                creative_projects.create_project(bad,{},lambda *_:MANIFEST,Path(raw).resolve())

    def test_rejects_path_traversal_and_symlink_inputs(self):
        unsafe=dict(MANIFEST, files={'../../outside':'oops'})
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as raw:
            with self.assertRaisesRegex(ValueError,'manifest|path'):
                creative_projects.create_project(CONCEPT,{},lambda *_:unsafe,Path(raw).resolve())

    def test_rejects_unlocked_dependency_or_external_script(self):
        external=dict(MANIFEST, html=MANIFEST['html'].replace('</head>','<script src="https://evil.example/x.js"></script></head>'))
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as raw:
            with self.assertRaisesRegex(ValueError,'remote|external'):
                creative_projects.create_project(CONCEPT,{},lambda *_:external,Path(raw).resolve())

    def test_rejects_animation_extensions_missing_from_pinned_gsap(self):
        source = MANIFEST['html'].replace('gsap.timeline', 'DrawSVGPlugin; gsap.timeline')
        with self.assertRaisesRegex(ValueError, 'unavailable GSAP extension'):
            creative_projects._validate({**MANIFEST, 'html':source}, CONCEPT, {})

    def test_math_assertion_must_evaluate_exactly(self):
        invalid=dict(MANIFEST,math_assertions=[{'expression':'2+2','result':5}])
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as raw:
            with self.assertRaisesRegex(ValueError,'[Mm]ath'):
                creative_projects.create_project(CONCEPT,{},lambda *_:invalid,Path(raw).resolve())

    def test_unverified_claim_and_incomplete_hebrew_copy_are_rejected(self):
        unverified=dict(MANIFEST,claims_evidence=[{'claim':'Tracks every skill','evidence_id':'FEATURE-X'}])
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as raw:
            with self.assertRaisesRegex(ValueError,'evidence'):
                creative_projects.create_project(CONCEPT,{'verified_features':[]},lambda *_:unverified,Path(raw).resolve())
        incomplete=dict(MANIFEST,alt_text='')
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as raw:
            with self.assertRaisesRegex(ValueError,'caption|alt'):
                creative_projects.create_project(CONCEPT,{},lambda *_:incomplete,Path(raw).resolve())

    def test_rejects_too_many_or_oversized_generated_files(self):
        invalid=dict(MANIFEST, source_files={'x'+str(i)+'.js':'x' for i in range(20)})
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as raw:
            with self.assertRaisesRegex(ValueError,'file|manifest'):
                creative_projects.create_project(CONCEPT,{},lambda *_:invalid,Path(raw).resolve())


if __name__=='__main__':unittest.main()
