"""Opt-in local Docker checks; never reads or changes production configuration."""
import hashlib
import http.client
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest

VPS = Path(__file__).resolve().parent
IMAGE = 'caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b'


@unittest.skipUnless(os.environ.get('RUN_MEDIA_SERVER_TESTS') == '1', 'set RUN_MEDIA_SERVER_TESTS=1 for local Docker checks')
class MediaServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.public = Path(cls.temp.name)
        cls.public.chmod(0o755)
        cls.data = b'\x00\x00\x00\x18ftypmp42approved frozen test bytes'
        cls.filename = hashlib.sha256(cls.data).hexdigest() + '.mp4'
        (cls.public / cls.filename).write_bytes(cls.data)
        (cls.public / 'manifest.json').write_text('private decoy')
        (cls.public / 'source').mkdir()
        (cls.public / 'source' / 'index.html').write_text('private decoy')
        for path in cls.public.rglob('*'):
            path.chmod(0o755 if path.is_dir() else 0o644)
        cls.container = subprocess.check_output([
            'docker', 'run', '-d', '--read-only', '--user', '1002:1002',
            '--cap-drop', 'ALL', '--cap-add', 'NET_BIND_SERVICE', '--security-opt', 'no-new-privileges:true',
            '-p', '127.0.0.1::8080',
            '--mount', f'type=bind,source={VPS / "Caddy.media"},target=/etc/caddy/Caddyfile,readonly',
            '--mount', f'type=bind,source={cls.public},target=/media/public,readonly',
            IMAGE, 'caddy', 'run', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile',
        ], text=True).strip()
        try:
            for _ in range(30):
                inspection = json.loads(subprocess.check_output(['docker', 'inspect', cls.container], text=True))[0]
                mapping = inspection['NetworkSettings']['Ports'].get('8080/tcp')
                if mapping:
                    cls.port = int(mapping[0]['HostPort'])
                    break
                if not inspection['State']['Running']:
                    raise RuntimeError(subprocess.check_output(['docker', 'logs', cls.container], text=True, stderr=subprocess.STDOUT))
                time.sleep(0.1)
            else: raise RuntimeError('Docker did not report the local port binding')
            for _ in range(50):
                try:
                    if cls.request('/')[0] == 404: break
                except (ConnectionError, OSError): pass
                time.sleep(0.1)
            else: raise RuntimeError('Local media container did not become ready')
        except BaseException:
            subprocess.run(['docker', 'rm', '-f', '-v', cls.container], check=False, capture_output=True)
            cls.temp.cleanup()
            raise

    @classmethod
    def tearDownClass(cls):
        subprocess.run(['docker', 'rm', '-f', '-v', cls.container], check=True, capture_output=True)
        cls.temp.cleanup()

    @classmethod
    def request(cls, path, method='GET', headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', cls.port, timeout=3)
        try:
            connection.request(method, path, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally: connection.close()

    def test_compose_overlay_is_isolated(self):
        config = json.loads(subprocess.check_output([
            'docker', 'compose', '-p', 'content-machine',
            '-f', str(VPS / 'compose.yaml'), '-f', str(VPS / 'compose.media.yaml'),
            'config', '--format', 'json',
        ], env=dict(os.environ, CONTENT_MACHINE_SITE_NETWORK='validation-only'), text=True))
        media = config['services']['media']
        self.assertFalse(media.get('ports'))
        self.assertTrue(media['read_only'])
        self.assertEqual(media['user'], '1002:1002')
        self.assertEqual({v['target'] for v in media['volumes']}, {'/etc/caddy/Caddyfile', '/media/public'})
        self.assertTrue(all(v['read_only'] for v in media['volumes']))
        self.assertEqual(config['networks']['site']['name'], 'validation-only')
        self.assertTrue(config['networks']['site']['external'])
        self.assertEqual(set(media['networks']), {'site'})

    def test_exact_bytes_head_and_range(self):
        status, headers, body = self.request('/' + self.filename)
        self.assertEqual(status, 200)
        self.assertEqual(body, self.data)
        self.assertEqual(headers.get('X-Content-Type-Options'), 'nosniff')
        self.assertEqual(self.request('/' + self.filename, 'HEAD')[0], 200)
        status, headers, body = self.request('/' + self.filename, headers={'Range': 'bytes=0-3'})
        self.assertEqual(status, 206)
        self.assertEqual(body, self.data[:4])

    def test_all_other_paths_and_write_methods_404(self):
        for path in ('/', '/manifest.json', '/source/index.html', '/source/', '/../state/queue.sqlite3', '/%2e%2e/state/queue.sqlite3', '/a.mp4', '/' + '0' * 64 + '.mp4', '/' + self.filename + '/extra'):
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 404)
        for method in ('POST', 'PUT', 'DELETE', 'OPTIONS'):
            with self.subTest(method=method):
                self.assertEqual(self.request('/' + self.filename, method)[0], 404)


if __name__ == '__main__': unittest.main()
