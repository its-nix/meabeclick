import { test, after } from 'node:test';
import { fakeAuthTransport, respondAuthFixture } from '../helpers/synthetic-auth-transport.mjs';
const transport = await fakeAuthTransport();
after(() => transport.close());
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const chrome = process.env.CHROME_BIN || ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const close = async (server) => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); };

for (const mode of ['same-origin', 'redirect', 'resources-workers-targets-websocket', 'signal']) {
  test(`real Chrome exact-origin boundary: ${mode}`, { skip: !chrome, timeout: 25_000 }, async () => {
    let contacts = 0;
    const sentinel = createServer((_req, res) => { contacts++; res.end('sentinel'); });
    sentinel.on('connection', () => { contacts++; });
    sentinel.on('upgrade', (_req, socket) => { contacts++; socket.destroy(); });
    const foreign = await listen(sentinel);
    const requests = [];
    const server = createServer((req, res) => {
      requests.push(req.url);
      if (mode === 'signal') {
        setTimeout(() => child?.kill('SIGTERM'), 100);
        res.end('synthetic stalled UI');
      } else if (req.url === '/enter') {
        res.setHeader('content-type', 'text/html; charset=utf-8');
        if (mode === 'redirect') res.writeHead(303, { location: `${foreign}/redirect` }).end();
        else res.end(`<!doctype html><html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;600;700;800;900&display=swap"></head><body><button>כניסה לדף האישי</button><script>
          const token = location.hash.slice(1); history.replaceState(null, '', '/enter');
          document.querySelector('button').onclick = async () => {
            const res = await fetch('/api/access/redeem', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
            location.replace((await res.json()).destination);
          };
        </script></body></html>`);
      } else if (respondAuthFixture(req, res)) {
        // Protocol fixture only, never normal-app smoke evidence.
      } else if (req.url === '/service-worker.js') {
        res.setHeader('content-type', 'text/javascript');
        res.end(`self.addEventListener('install', event => event.waitUntil(fetch('${foreign}/service-worker').catch(()=>{})));`);
      } else if (req.url === '/worker.js') {
        res.setHeader('content-type', 'text/javascript');
        res.end(`fetch('${foreign}/worker').catch(()=>{}); new WebSocket('${foreign.replace('http:', 'ws:')}/worker-ws');`);
      } else {
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(`<!doctype html><html><body>
          <nav class="bottom-nav"><button aria-current="page">שיעורי בית</button></nav>
          <section class="card" style="display:none">פתרו x² = 16 והסבירו את שתי התשובות — משימת בדיקה
          <span class="badge graded ok">נבדק — יפה מאוד</span><a href="#">לשחק שוב</a></section>
          ${mode === 'same-origin' ? '' : `<img src="${foreign}/image"><iframe src="${foreign}/frame"></iframe>
          <script>
            fetch('${foreign}/fetch').catch(()=>{});
            fetch('${foreign.replace('http:', 'https:')}/tls-fetch').catch(()=>{});
            navigator.serviceWorker.register('/service-worker.js').catch(()=>{});
            new Worker('/worker.js');
            new Worker(URL.createObjectURL(new Blob(["fetch('${foreign}/blob-worker').catch(()=>{})"], {type:'text/javascript'})));
            window.open('${foreign}/popup');
            new WebSocket('${foreign.replace('http:', 'ws:')}/ws');
            new WebSocket('${foreign.replace('http:', 'wss:')}/tls-ws');
          </script>`}
          <script>setTimeout(()=>document.querySelector('.card').style.display='block', 700)</script>
          </body></html>`);
      }
    });
    const origin = await listen(server);
    const dir = await mkdtemp(join(tmpdir(), 'sb-'));
    const wrapper = join(dir, 'chrome');
    await writeFile(wrapper, `#!/bin/bash
printf '%s' "$$" > "$HOME/chrome-pid"
for arg in "$@"; do
  case "$arg" in --user-data-dir=*) printf '%s' "\${arg#--user-data-dir=}" > "$HOME/chrome-profile" ;; esac
done
exec "$REAL_CHROME" "$@"
`, { mode: 0o755 });
    let child;
    try {
      const result = await new Promise((resolve) => {
        child = spawn(process.execPath, ['synthetic/browser-smoke.mjs', origin], {
          env: { ...transport.env, HOME: dir, CHROME_BIN: wrapper, REAL_CHROME: chrome, TMPDIR: tmpdir() },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.on('data', (c) => { output += c; });
        child.stderr.on('data', (c) => { output += c; });
        const timer = setTimeout(() => child.kill('SIGKILL'), 22_000);
        child.on('close', (status, signal) => { clearTimeout(timer); resolve({ status, signal, output }); });
      });
      assert.equal(result.signal, null, result.output);
      assert.equal(contacts, 0, `off-origin sentinel contacts: ${contacts}\n${result.output}`);
      assert.ok(requests.some((url) => url === '/enter'), `entry was never exercised: ${result.output}`);
      if (mode === 'resources-workers-targets-websocket') {
        assert.ok(requests.includes('/worker.js'), 'dedicated worker was not exercised');
        assert.ok(requests.includes('/service-worker.js'), 'service worker was not exercised');
      }
      if (mode === 'same-origin') {
        assert.equal(result.status, 0, result.output);
        assert.match(result.output, /rendered student homework passed/);
      } else {
        assert.notEqual(result.status, 0, result.output);
      }
      const profile = await readFile(join(dir, 'chrome-profile'), 'utf8');
      const pid = Number(await readFile(join(dir, 'chrome-pid'), 'utf8'));
      await assert.rejects(access(profile), { code: 'ENOENT' }, 'Chrome profile survived smoke shutdown');
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, 'Chrome process survived smoke shutdown');
    } finally {
      if (child?.exitCode === null) child.kill('SIGKILL');
      await close(server);
      await close(sentinel);
      await rm(dir, { recursive: true, force: true });
    }
  });
}
