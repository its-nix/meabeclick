"""Packaging safety and unattended runner behavior."""
import ast
from contextlib import redirect_stderr
from datetime import datetime, timedelta, timezone
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

HERE = Path(__file__).resolve().parent


def module(name):
    path = HERE/'vps'/f'{name}.py'
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


class ContextTests(unittest.TestCase):
    def test_context_contains_only_explicit_sources(self):
        builder = module('build-context')
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()/'repo'; root.mkdir()
            for relative in builder.REQUIRED_FILES:
                path = root/relative; path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('allowed')
            for relative in ('outputs/token.json', '.env', 'students/private.txt',
                             'marketing/content-library/posts/ad-parent-paper-sfx/secret.json',
                             'marketing/content-library/posts/tip-add18-v2/output.mp4',
                             'app/page.tsx', 'pricing/private.txt'):
                path=root/relative; path.parent.mkdir(parents=True,exist_ok=True); path.write_text('SECRET')
            dest=Path(tmp)/'context'; builder.build(root, dest)
            files={p.relative_to(dest).as_posix() for p in dest.rglob('*') if p.is_file()}
            self.assertEqual(files, set(builder.REQUIRED_FILES))
            self.assertFalse(any(b'SECRET' in p.read_bytes() for p in dest.rglob('*') if p.is_file()))

    def test_document_sources_match_machine_contract(self):
        tree=ast.parse((HERE/'machine.py').read_text())
        sources=next(ast.literal_eval(node.value) for node in tree.body
                     if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='DOCUMENT_SOURCES' for t in node.targets))
        self.assertEqual(set(module('build-context').DOCUMENTS),sources)

    def test_selected_symlink_rejected_before_copy(self):
        builder=module('build-context')
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve()/'repo'; root.mkdir()
            for relative in builder.REQUIRED_FILES:
                path=root/relative; path.parent.mkdir(parents=True,exist_ok=True); path.write_text('source')
            selected=root/builder.REQUIRED_FILES[0]; selected.unlink()
            secret=Path(tmp)/'secret';secret.write_text('PRIVATE');selected.symlink_to(secret)
            dest=Path(tmp)/'context'
            with self.assertRaisesRegex(ValueError, 'Symlink'): builder.build(root,dest)
            self.assertFalse(dest.exists())


class RunnerTests(unittest.TestCase):
    def test_failure_is_visible_and_next_tick_can_recover(self):
        runner=module('run-worker')
        with tempfile.TemporaryDirectory() as tmp:
            state=Path(tmp); cfg=state/'config.json';cfg.write_text(json.dumps({'state_dir':str(state)}))
            def failed(_): raise RuntimeError('secret credential value must not reach logs')
            with redirect_stderr(io.StringIO()) as log:
                self.assertEqual(runner.run_once(cfg, tick=failed), 1)
            self.assertIn('RuntimeError', log.getvalue())
            self.assertNotIn('secret', log.getvalue())
            heartbeat=json.loads((state/'worker-health.json').read_text())
            self.assertEqual(heartbeat['status'], 'error')
            self.assertEqual(heartbeat['error_type'], 'RuntimeError')
            self.assertNotIn('secret',json.dumps(heartbeat))
            self.assertEqual(runner.run_once(cfg,tick=lambda _: {'ready':False,'blocker_codes':['paused']}),0)
            heartbeat=json.loads((state/'worker-health.json').read_text())
            self.assertEqual(heartbeat['status'],'ok')
            self.assertFalse(heartbeat['ready'])
            self.assertEqual(heartbeat['blocker_codes'],['paused'])

    def test_health_rejects_errors_and_stale_heartbeat(self):
        runner=module('run-worker')
        with tempfile.TemporaryDirectory() as tmp:
            state=Path(tmp)
            self.assertFalse(runner.healthy(state))
            runner.heartbeat(state,status='ok')
            self.assertTrue(runner.healthy(state))
            runner.heartbeat(state,status='error')
            self.assertFalse(runner.healthy(state))
            (state/'worker-health.json').write_text(json.dumps({'status':'ok','checked_at':(datetime.now(timezone.utc)-timedelta(hours=2)).isoformat()}))
            self.assertFalse(runner.healthy(state))

    def test_once_cli_does_not_loop(self):
        runner=module('run-worker')
        with tempfile.TemporaryDirectory() as tmp:
            cfg=Path(tmp)/'cfg.json';cfg.write_text(json.dumps({'state_dir':tmp}))
            calls=[]
            self.assertEqual(runner.main(['--once','--config',str(cfg)],tick=lambda path: calls.append(path) or {}),0)
            self.assertEqual(len(calls),1)


if __name__ == '__main__': unittest.main()
