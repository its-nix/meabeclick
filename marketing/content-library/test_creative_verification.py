import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import engine
import creative_verification as cv
from test_creative_fixtures import tiny_video, passing_reviewer, attest


class VerificationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory();cls.root=Path(cls.tmp.name).resolve()
        source=cls.root/'source';source.mkdir();(source/'index.html').write_text('<html><body>1 + 1 = 2</body></html>')
        cls.bundle=engine.freeze({'post':{'id':'P001','title':'Test math'},'constraints':{'audio':'silent'}},source,tiny_video(cls.root/'tiny.mp4'),cls.root/'artifacts')
        cls.ref=attest(cls.bundle,'caption','cta',cls.root/'verified')
    @classmethod
    def tearDownClass(cls):cls.tmp.cleanup()
    def package(self):return {'bundle':str(self.bundle),'caption':'caption','cta':'cta','creative_verification':self.ref}
    def altered(self,mutate):
        report=json.loads(Path(self.ref['path']).read_text());mutate(report)
        path=self.root/(next(tempfile._get_candidate_names())+'.json');cv._write(path,report)
        package=self.package();package['creative_verification']=cv._ref(path);return package
    def test_missing_reference_blocks(self):
        with self.assertRaisesRegex(ValueError,'verification'):cv.require({'bundle':'absent','caption':'caption','cta':'cta'})
    def test_validated_report_is_not_owner_approval(self):
        self.assertIs(cv.require(self.package())['owner_approved'],False)
    def test_media_context_caption_cta_policy_tampering_block(self):
        for key,value in [('caption','changed'),('cta','changed')]:
            p=self.package();p[key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):cv.require(p)
        for key in ('artifact_id','media_sha256','context_sha256','policy_sha256'):
            with self.subTest(key=key),self.assertRaises(ValueError):cv.require(self.altered(lambda r:r.update({key:'forged'})))
    def test_report_checksum_and_missing_file_block(self):
        p=self.package();p['creative_verification']={**self.ref,'sha256':'0'*64}
        with self.assertRaises(ValueError):cv.require(p)
        p['creative_verification']={'path':str(self.root/'missing.json'),'sha256':'0'*64}
        with self.assertRaises(ValueError):cv.require(p)
    def test_motion_timing_readability_math_unverified_blocks(self):
        for check in ('motion','timing','readability','math','teaching'):
            def mutate(r):r['roles'][0]['checks'][check]='unverified'
            with self.subTest(check=check),self.assertRaises(ValueError):cv.require(self.altered(mutate))
    def test_missing_coverage_and_same_session_block(self):
        for mutate in (lambda r:r['roles'][0]['coverage'].update(original_frame_indices=[0]),lambda r:r['roles'][0]['coverage'].update(sheet_ids=[]),lambda r:r['roles'][0]['coverage'].update(continuous_playback=True),lambda r:r['roles'][1].update(session_id=r['roles'][0]['session_id']),lambda r:r.update(owner_approved=True)):
            with self.assertRaises(ValueError):cv.require(self.altered(mutate))
    def test_referenced_frame_tampering_blocks_cached_report(self):
        e=cv._read_ref(cv.require(self.package())['evidence']);path=Path(e['frames'][0]['path']);original=path.read_bytes()
        try:
            path.write_bytes(b'tampered')
            with self.assertRaises(ValueError):cv.require(self.package())
            with self.assertRaises(ValueError):cv.inspect_candidate(self.bundle,'caption','cta',self.root/'verified',reviewer=passing_reviewer)
        finally:path.write_bytes(original)
    def test_auth_failure_does_not_retry_on_restart(self):
        directory=self.root/'unauthorized'
        with patch.dict(os.environ,{},clear=True):
            first=cv.process_candidate(self.bundle,'caption','cta',directory)
            self.assertEqual(first['status'],'needs_human')
        def forbidden(**kw):self.fail('cached failure retried')
        second=cv.process_candidate(self.bundle,'caption','cta',directory,reviewer=forbidden)
        self.assertEqual(second,first);self.assertEqual(second['revisions'],0)
    def test_two_independent_roles_and_cache_without_models(self):
        calls=[]
        def reviewer(**kw):calls.append(kw['role']);return passing_reviewer(**kw)
        state=cv.process_candidate(self.bundle,'caption','cta',self.root/'success',reviewer=reviewer)
        self.assertEqual(state['status'],'ready_for_human');self.assertFalse(state['owner_approved']);self.assertEqual(calls,list(cv.ROLES))
        cv.process_candidate(self.bundle,'caption','cta',self.root/'success',reviewer=lambda **kw:self.fail('cached success retried'))
    def test_safe_two_round_repairs_and_restart_budget(self):
        calls=[]
        def reviewer(**kw):
            r=passing_reviewer(**kw);r['verdict']='revise';r['checks']['math']='fail';r['findings']=[{'time_seconds':0,'severity':'P1','issue':'Math','change':'Change number'}]
            if kw['role']=='correctness_motion':
                n=1+len(calls)//2;r['patches']=[{'path':'index.html','before':f'{n} + 1','after':f'{n+1} + 1'}]
            calls.append(kw['role']);return r
        def render(project,output):return tiny_video(output)
        state=cv.process_candidate(self.bundle,'caption','cta',self.root/'repairs',reviewer=reviewer,render=render,repairer=lambda **kw:[p for r in kw['reports'] for p in r['patches']])
        self.assertEqual(state['status'],'needs_human');self.assertEqual(state['revisions'],2);self.assertEqual(len(state['attempts']),3);self.assertEqual(len(calls),6)
        self.assertIn('1 + 1',(self.bundle/'source'/'index.html').read_text())
        self.assertEqual(cv.process_candidate(self.bundle,'caption','cta',self.root/'repairs',reviewer=lambda **kw:self.fail('retried')),state)
    def test_unsafe_patch_escalates_and_consumes_round(self):
        def reviewer(**kw):
            r=passing_reviewer(**kw);r.update(verdict='revise',findings=[{'time_seconds':0,'severity':'P1','issue':'Layout','change':'New element'}]);r['patches']=[{'path':'index.html','before':'<body>','after':'<body><div>new</div>'}] if kw['role']=='correctness_motion' else [];return r
        calls=[]
        state=cv.process_candidate(self.bundle,'caption','cta',self.root/'unsafe',reviewer=reviewer,render=lambda *args:calls.append(args),repairer=lambda **kw:[p for r in kw['reports'] for p in r['patches']])
        self.assertEqual(state['status'],'needs_human');self.assertEqual(state['revisions'],1);self.assertEqual(calls,[])
    def test_separate_producer_gets_source_and_fresh_critics_do_not(self):
        roles=[];producers=[]
        def reviewer(**kw):
            self.assertNotIn('source',kw['context']);roles.append(kw['role'])
            r=passing_reviewer(**kw)
            if len(roles)<=2:r.update(verdict='revise',findings=[{'time_seconds':0,'severity':'P1','issue':'Math wrong','change':'Correct numeral'}]);r['checks']['math']='fail'
            return r
        def repairer(**kw):
            producers.append(kw);self.assertIn('1 + 1',kw['source'][0]['html']);self.assertEqual(kw['findings'][0]['issue'],'Math wrong')
            return [{'path':'index.html','before':'1 + 1','after':'2 + 1'}]
        result=cv.process_candidate(self.bundle,'producer','cta',self.root/'producer',reviewer=reviewer,repairer=repairer,render=lambda project,out:tiny_video(out))
        self.assertEqual(result['status'],'ready_for_human');self.assertEqual(result['revisions'],1);self.assertEqual(len(producers),1);self.assertEqual(len(roles),4)

    def test_cli_is_fresh_tools_disabled_and_no_source_prompt(self):
        from types import SimpleNamespace
        evidence=cv._read_ref(cv.require(self.package())['evidence']);evidence['_directory']=str(self.root/'cli-state');Path(evidence['_directory']).mkdir()
        evidence['evidence_sha256']=cv.require(self.package())['evidence']['sha256']
        isolated=self.root/'isolated-auth';isolated.mkdir();seen=[]
        def run(args,**kw):
            if args[1:]==['--version']:return SimpleNamespace(stdout='codex-cli 0.149.0\n')
            if args[1:]==['exec','--help']:return SimpleNamespace(stdout=' '.join(('--ignore-user-config','--ignore-rules','--ephemeral','--sandbox','--output-schema')))
            if args[1:]==['features','list']:return SimpleNamespace(stdout='\n'.join(f+' stable true' for f in cv.DISABLED_FEATURES))
            seen.append((args,kw));output=Path(args[args.index('--output-last-message')+1]);output.write_text(json.dumps(passing_reviewer(role='editorial',evidence=evidence,context={},policy=cv.policy_hash(),invocation_id='echo')))
            return SimpleNamespace(stdout=json.dumps({'type':'thread.started','thread_id':'actual-fresh-id'}))
        with patch.dict(os.environ,{'CODEX_REVIEW_HOME':str(isolated)}),patch.object(cv.shutil,'which',return_value='codex'),patch.object(cv,'_run',side_effect=run):
            response=cv._codex_review(role='editorial',evidence=evidence,context={'caption':'public'},policy=cv.policy_hash(),invocation_id='unique')
        args,kw=seen[0];self.assertEqual(response['session_id'],'actual-fresh-id')
        for flag in ('--ephemeral','--ignore-user-config','--ignore-rules'):self.assertIn(flag,args)
        self.assertEqual(args[args.index('--sandbox')+1],'read-only')
        self.assertNotIn('OPENAI_API_KEY',kw['env']);self.assertNotIn('1 + 1 = 2',kw['input']);self.assertNotIn('source_files',kw['input'])
        self.assertNotIn(str(self.bundle),args[args.index('--cd')+1])

    def test_cli_core_features_suffice_missing_core_and_wrong_version_block(self):
        from types import SimpleNamespace
        core={'apps','browser_use','code_mode','computer_use','hooks','plugins','shell_tool','unified_exec'}
        evidence=cv._read_ref(cv.require(self.package())['evidence']);evidence['_directory']=str(self.root)
        evidence['evidence_sha256']=cv.require(self.package())['evidence']['sha256']
        isolated=self.root/'compat-auth';isolated.mkdir();seen=[]
        available=set(core);version='codex-cli 0.149.0'
        def run(args,**kw):
            if args[1:]==['--version']:return SimpleNamespace(stdout=version+'\n')
            if args[1:]==['exec','--help']:return SimpleNamespace(stdout=' '.join(('--ignore-user-config','--ignore-rules','--ephemeral','--sandbox','--output-schema')))
            if args[1:]==['features','list']:return SimpleNamespace(stdout='\n'.join(f+' stable true' for f in available))
            seen.append(args);Path(args[args.index('--output-last-message')+1]).write_text(json.dumps(passing_reviewer(role='editorial',evidence=evidence,context={},policy=cv.policy_hash(),invocation_id='echo')))
            return SimpleNamespace(stdout=json.dumps({'type':'thread.started','thread_id':'fresh-linux'}))
        with patch.dict(os.environ,{'CODEX_REVIEW_HOME':str(isolated)}),patch.object(cv.shutil,'which',return_value='codex'),patch.object(cv,'_run',side_effect=run):
            cv._codex_review(role='editorial',evidence=evidence,context={},policy=cv.policy_hash(),invocation_id='unique')
            disabled={seen[0][i+1] for i,a in enumerate(seen[0]) if a=='--disable'}
            self.assertEqual(disabled,core)
            available.remove('shell_tool')
            with self.assertRaisesRegex(RuntimeError,'isolation'):cv._codex_review(role='editorial',evidence=evidence,context={},policy=cv.policy_hash(),invocation_id='unique')
            available=set(core);version='codex-cli 0.150.0'
            with self.assertRaisesRegex(RuntimeError,'version'):cv._codex_review(role='editorial',evidence=evidence,context={},policy=cv.policy_hash(),invocation_id='unique')
        self.assertEqual(len(seen),1)

    def test_repaired_child_technical_failure_blocks_before_new_critics(self):
        calls=[];validated=[]
        def reviewer(**kw):
            calls.append(kw['role']);r=passing_reviewer(**kw);r.update(verdict='revise',findings=[{'time_seconds':0,'severity':'P1','issue':'Math','change':'Number'}]);r['checks']['math']='fail';return r
        def validator(child):
            validated.append(child);self.assertEqual(engine.verify(child)['payload']['parent_artifact'],self.bundle.name)
            raise ValueError('Child technical QA failed')
        result=cv.process_candidate(self.bundle,'child-qa','cta',self.root/'child-qa',reviewer=reviewer,repairer=lambda **kw:[{'path':'index.html','before':'1 + 1','after':'2 + 1'}],render=lambda project,out:tiny_video(out),validate_bundle=validator)
        self.assertEqual(result['status'],'needs_human');self.assertEqual(result['revisions'],1);self.assertEqual(len(validated),1);self.assertEqual(len(calls),2)

    def test_exact_disabled_code_host_warning_is_not_a_tool_or_generic_error_bypass(self):
        warning='Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed; enable `features.code_mode_host` and install `codex-code-mode-host`.'
        events=[{'type':'thread.started','thread_id':'fresh'},{'type':'item.completed','item':{'type':'error','message':warning}},{'type':'turn.started'},{'type':'item.completed','item':{'type':'agent_message','text':'private response'}},{'type':'turn.completed'}]
        summary=cv._check_cli_events(events,{'code_mode','code_mode_host'})
        self.assertEqual(summary['warnings'],['code_mode_host_disabled']);self.assertNotIn('private response',json.dumps(summary));self.assertNotIn(warning,json.dumps(summary))
        with self.assertRaisesRegex(RuntimeError,'runtime error'):cv._check_cli_events(events,{'code_mode'})
        after_turn=[events[0],{'type':'turn.started'},events[1]]
        with self.assertRaisesRegex(RuntimeError,'runtime error'):cv._check_cli_events(after_turn,{'code_mode','code_mode_host'})
        for item in ({'type':'error','message':'Authentication failed'},{'type':'error','message':warning+' extra'},{'type':'command_execution','command':'cat private'},{'type':'mcp_tool_call','server':'private'},{'type':'todo_list','items':[]}):
            bad=copy.deepcopy(events);bad[1]['item']=item
            with self.assertRaises(RuntimeError):cv._check_cli_events(bad,{'code_mode','code_mode_host'})
        with self.assertRaisesRegex(RuntimeError,'runtime error'):cv._check_cli_events([{'type':'turn.failed','error':{'message':'private'}}],{'code_mode','code_mode_host'})

    def test_native_dense_pairs_cover_every_sample_and_cannot_be_omitted(self):
        report=cv.require(self.package());e=cv._read_ref(report['evidence']);dense=[s for s in e['sheets'] if s['id'].startswith('dense-')]
        self.assertEqual([i for s in dense for i in s['original_frame_indices']],e['dense_frame_indices'])
        for sheet in dense:
            self.assertLessEqual(len(sheet['original_frame_indices']),2)
            self.assertEqual(sheet['layout'],{'columns':2,'rows':1,'frame_width':e['width'],'frame_height':e['height'],'native_resolution':True})
            data=json.loads(cv._run(['ffprobe','-v','error','-show_streams','-of','json',sheet['path']]).stdout)
            self.assertEqual(data['streams'][0]['width'],2*e['width']);self.assertEqual(data['streams'][0]['height'],e['height']+32)
        def mutate(r):r['roles'][0]['coverage']['sheet_ids']=[sid for sid in r['roles'][0]['coverage']['sheet_ids'] if not sid.startswith('dense-')]
        with self.assertRaises(ValueError):cv.require(self.altered(mutate))

    def test_evidence_over100_attachments_blocks_before_decoding(self):
        meta={'frame_count':1800,'fps':'30','duration':60.0,'width':1080,'height':1920,'has_audio':False}
        with patch.object(cv,'_probe',return_value=meta),patch.object(cv,'_run',side_effect=AssertionError('must not decode oversized evidence')):
            with self.assertRaisesRegex(ValueError,'attachment budget'):cv._make_evidence(self.bundle,self.root/'oversized-evidence',cv._identity(self.bundle,'caption','cta'))

    def test_interrupted_state_becomes_terminal_block(self):
        identity=cv._identity(self.bundle,'interrupted','cta');directory=self.root/'interrupted'/('run-'+cv._digest(identity));directory.mkdir(parents=True)
        cv._write(directory/'state.json',{'status':'running','bundle':str(self.bundle),'verification':None,'attempts':[],'revisions':1,'max_revisions':2,'identity':identity,'owner_approved':False})
        state=cv.process_candidate(self.bundle,'interrupted','cta',self.root/'interrupted',reviewer=lambda **kw:self.fail('restarted interrupted attempt'))
        self.assertEqual(state['status'],'needs_human');self.assertEqual(state['revisions'],1)

    def test_failed_render_budget_survives_restart(self):
        def reviewer(**kw):
            r=passing_reviewer(**kw);r.update(verdict='revise',findings=[{'time_seconds':0,'severity':'P1','issue':'Math','change':'Number'}]);r['patches']=[{'path':'index.html','before':'1 + 1','after':'2 + 1'}] if kw['role']=='correctness_motion' else [];return r
        def fail(*a):raise RuntimeError('render failed')
        state=cv.process_candidate(self.bundle,'caption','cta',self.root/'render-fail',reviewer=reviewer,render=fail,repairer=lambda **kw:[p for r in kw['reports'] for p in r['patches']])
        self.assertEqual(state['revisions'],1)
        self.assertEqual(cv.process_candidate(self.bundle,'caption','cta',self.root/'render-fail',reviewer=lambda **kw:self.fail('retry')),state)

if __name__=='__main__':unittest.main()
