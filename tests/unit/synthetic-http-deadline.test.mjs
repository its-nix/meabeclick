import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

for (const mode of ['headers', 'stream-body', 'lifecycle-up', 'lifecycle-verify']) {
  test(`HTTP total deadline aborts ${mode} and releases lifecycle`, { timeout: 8_000 }, async () => {
    let streamClosed = false;
    let streamStarted = false;
    const server = createServer((req, res) => {
      if (mode === 'headers' || req.url.startsWith('/api/portal/')) {
        streamStarted = true;
        if (mode !== 'headers') res.writeHead(200, { 'content-type': 'application/json' });
        const interval = mode === 'headers' ? null : setInterval(() => res.write(' '), 25);
        res.on('close', () => { clearInterval(interval); streamClosed = true; });
      } else if (req.url.startsWith('/enter?')) {
        res.writeHead(303, { location: '/app/student?s=synthetic-student-gamma', 'set-cookie': 'maab_family=synthetic' }).end();
      } else { res.end('synthetic page'); }
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const dir = await mkdtemp(join(tmpdir(), 'synthetic-deadline-'));
    const bin = join(dir, 'bin');
    const scripts = join(dir, 'scripts');
    await mkdir(bin);
    await mkdir(scripts);
    const log = join(dir, 'calls.log');
    const source = await readFile('scripts/synthetic-vps.sh', 'utf8');
    const lifecycle = join(scripts, 'synthetic-vps.sh');
    await writeFile(lifecycle, source.replace('/tmp/meabeclick-synthetic-${UID}.lock.d', join(dir, 'lock.d')));
    await writeFile(join(bin, 'docker'), '#!/bin/bash\nprintf "docker %s\\n" "$*" >> "$CALL_LOG"\n', { mode: 0o755 });
    await writeFile(join(bin, 'node'), `#!/bin/bash
if [[ "$1" == synthetic/http-smoke.mjs ]]; then
  exec "$REAL_NODE" "$REAL_HTTP_SMOKE" "$STREAM_ORIGIN" 300
fi
printf 'browser invoked\n' >> "$CALL_LOG"
`, { mode: 0o755 });
    let child;
    try {
      const started = performance.now();
      const result = await new Promise((r) => {
        child = mode.startsWith('lifecycle-')
          ? spawn('bash', [lifecycle, mode.slice('lifecycle-'.length)], { detached: true, env: {
            PATH: `${bin}:${process.env.PATH}`, CALL_LOG: log,
            REAL_NODE: process.execPath, REAL_HTTP_SMOKE: resolve('synthetic/http-smoke.mjs'), STREAM_ORIGIN: origin,
          } })
          : spawn(process.execPath, ['synthetic/http-smoke.mjs', origin, '300'], { detached: true });
        let output = '';
        child.stdout.on('data', (c) => { output += c; });
        child.stderr.on('data', (c) => { output += c; });
        const timer = setTimeout(() => process.kill(-child.pid, 'SIGKILL'), 2_500);
        child.on('close', (status, signal) => { clearTimeout(timer); r({ status, signal, output }); });
      });
      assert.equal(result.signal, null, `smoke required forced termination: ${result.output}`);
      assert.notEqual(result.status, 0, result.output);
      assert.match(result.output, /HTTP smoke total deadline/);
      assert.ok(performance.now() - started < 2_000, 'deadline did not bound total command duration');
      assert.ok(streamStarted, 'adversarial response not exercised');
      assert.ok(streamClosed, 'pending response/socket not aborted');
      if (mode.startsWith('lifecycle-')) {
        const calls = await readFile(log, 'utf8');
        assert.match(calls, /compose --env-file \/dev\/null --project-name meabeclick-synthetic --file .* down --volumes --remove-orphans/);
        assert.doesNotMatch(calls, /browser invoked/);
        const reacquired = spawn('bash', [lifecycle, 'down'], { env: { PATH: `${bin}:${process.env.PATH}`, CALL_LOG: log } });
        const status = await new Promise((r) => reacquired.on('close', r));
        assert.equal(status, 0, 'lifecycle retained the lock after timeout');
      }
    } finally {
      if (child?.exitCode === null) child.kill('SIGKILL');
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      await rm(dir, { recursive: true, force: true });
    }
  });
}
