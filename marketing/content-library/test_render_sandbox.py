import json
import sys
import socket
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import render_sandbox
sys.path.insert(0,str(Path(__file__).parent/'renderer'))
import egress_proxy
import run_renderer


class EgressPolicyTests(unittest.TestCase):
    def test_allows_public_https_host_and_pins_single_resolved_ip(self):
        calls=[]
        def resolver(host,port,type):
            calls.append(host)
            return [(socket.AF_INET,socket.SOCK_STREAM,6,'',('93.184.216.34',port))]
        target=egress_proxy.resolve_public_target('example.org:443',resolver=resolver)
        self.assertEqual(target,('example.org',443,'93.184.216.34'))
        self.assertEqual(calls,['example.org'])

    def test_blocks_private_loopback_link_local_metadata_and_non_https_ports(self):
        for address in ('127.0.0.1','10.0.0.5','169.254.169.254','::1','fe80::1','fd00::1'):
            with self.subTest(address=address):
                resolver=lambda host,port,type,a=address:[(socket.AF_INET6 if ':' in a else socket.AF_INET,socket.SOCK_STREAM,6,'',(a,port))]
                with self.assertRaisesRegex(ValueError,'public'):
                    egress_proxy.resolve_public_target('example.org:443',resolver=resolver)
        with self.assertRaises(ValueError):egress_proxy.resolve_public_target('example.org:80')

    def test_mixed_public_and_private_dns_answers_fail_closed(self):
        def resolver(host,port,type):
            return [(socket.AF_INET,socket.SOCK_STREAM,6,'',('93.184.216.34',port)),
                    (socket.AF_INET,socket.SOCK_STREAM,6,'',('10.0.0.2',port))]
        with self.assertRaisesRegex(ValueError,'public'):
            egress_proxy.resolve_public_target('example.org:443',resolver=resolver)

    def test_dns_rebinding_is_not_re_resolved_after_validation(self):
        calls=[]
        def resolver(host,port,type):
            calls.append(host)
            return [(socket.AF_INET,socket.SOCK_STREAM,6,'',('93.184.216.34' if len(calls)==1 else '127.0.0.1',port))]
        target=egress_proxy.resolve_public_target('example.org:443',resolver=resolver)
        self.assertEqual(target[2],'93.184.216.34')
        self.assertEqual(len(calls),1)


class RendererProtocolTests(unittest.TestCase):
    def test_stage_and_collect_bind_job_to_project_and_media_hash(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as raw:
            root=Path(raw).resolve();project=root/'project';project.mkdir()
            (project/'index.html').write_text('<html><body>demo</body></html>')
            client=render_sandbox.RenderClient(root/'spool',poll_seconds=.01)
            job=client.stage(project,'job-123',timeout=30)
            self.assertEqual(job['status'],'queued')
            media=job['job_dir']/'output'/'asset.mp4';media.parent.mkdir(exist_ok=True);media.write_bytes(b'fake-video')
            result={'job_id':'job-123','input_sha256':job['input_sha256'],'status':'ready',
                    'media_sha256':__import__('engine').sha(media),'media_path':'output/asset.mp4',
                    'source_manifest':job['source_manifest'],'asset_manifest':[], 'render_log':'ok'}
            (job['job_dir']/'result.json').write_text(json.dumps(result))
            collected=client.collect('job-123')
            self.assertEqual(collected['status'],'ready')
            self.assertEqual(collected['media_path'],media)

    def test_remote_assets_are_fetched_with_provenance_and_size_limits(self):
        class Headers:
            def get_content_type(self):return 'image/png'
        class Response:
            headers=Headers()
            def geturl(self):return 'https://cdn.example.org/shape.png'
            def read(self,n):
                nonlocal sent
                if sent:return b''
                sent=True;return b'\x89PNG\r\n\x1a\nPNGDATA'
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as raw:
            root=Path(raw).resolve();project=root/'project';project.mkdir()
            (project/'index.html').write_text('<html></html>')
            (project/'project-manifest.json').write_text(json.dumps({'remote_assets':[{'url':'https://cdn.example.org/shape.png','path':'assets/remote-1.png','license':'CC0','purpose':'illustration'}]}))
            client=render_sandbox.RenderClient(root/'spool');job=client.stage(project,'asset-1',timeout=20)
            sent=False
            class Opener:
                def open(self,request,timeout):return Response()
            receipt=run_renderer.fetch_remote_assets(job['job_dir'],opener=Opener())
            self.assertEqual(receipt[0]['license'],'CC0')
            self.assertTrue((job['job_dir']/'input/assets/remote-1.png').is_file())
            client.validate_request(job['job_dir'])

    def test_remote_asset_rejects_mime_spoofing(self):
        class Headers:
            def get_content_type(self):return 'image/png'
        class Response:
            headers=Headers()
            sent=False
            def geturl(self):return 'https://cdn.example.org/fake.png'
            def read(self,n):
                if self.sent:return b''
                self.sent=True;return b'<html>not an image</html>'
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as raw:
            root=Path(raw).resolve();project=root/'project';project.mkdir()
            (project/'index.html').write_text('<html></html>')
            (project/'project-manifest.json').write_text(json.dumps({'remote_assets':[{'url':'https://cdn.example.org/fake.png','path':'assets/remote-1.png','license':'CC0','purpose':'illustration'}]}))
            job=render_sandbox.RenderClient(root/'spool').stage(project,'asset-spoof',timeout=20)
            class Opener:
                def open(self,request,timeout):return Response()
            with self.assertRaisesRegex(ValueError,'bytes do not match'):
                run_renderer.fetch_remote_assets(job['job_dir'],opener=Opener())

    def test_remote_asset_path_cannot_escape_job_input(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as raw:
            root=Path(raw).resolve();project=root/'project';project.mkdir()
            (project/'index.html').write_text('<html></html>')
            (project/'project-manifest.json').write_text(json.dumps({'remote_assets':[{'url':'https://cdn.example.org/shape.png','path':'../../escape.png','license':'CC0','purpose':'illustration'}]}))
            job=render_sandbox.RenderClient(root/'spool').stage(project,'asset-2',timeout=20)
            with self.assertRaisesRegex(ValueError,'output path'):
                run_renderer.fetch_remote_assets(job['job_dir'],opener=object())

    def test_renderer_rejects_tampered_source_and_untrusted_job_paths(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as raw:
            root=Path(raw).resolve();project=root/'project';project.mkdir()
            (project/'index.html').write_text('<html></html>')
            client=render_sandbox.RenderClient(root/'spool')
            client.stage(project,'job-abc',timeout=20)
            staged=root/'spool'/'job-abc'/'input'/'index.html';staged.write_text('<html>mutated</html>')
            with self.assertRaisesRegex(ValueError,'source|hash'):
                client.validate_request(root/'spool'/'job-abc')
            with self.assertRaisesRegex(ValueError,'job ID'):
                client.stage(project,'../escape',timeout=20)

    def test_process_job_uses_fixed_renderer_command_and_writes_hash_bound_result(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as raw:
            root=Path(raw).resolve();project=root/'project';project.mkdir();(project/'index.html').write_text('<html>hello</html>')
            client=render_sandbox.RenderClient(root/'spool');job=client.stage(project,'render-1',timeout=20)
            def renderer(project_dir,output,timeout):
                target=output/'asset.mp4';target.write_bytes(b'video');return 'render ok'
            result=run_renderer.process_job(job['job_dir'],renderer=renderer)
            self.assertEqual(result['status'],'ready')
            self.assertEqual(result['media_sha256'],__import__('engine').sha(job['job_dir']/'output'/'asset.mp4'))


if __name__=='__main__':unittest.main()
