import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { on, once } from 'node:events';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const currentCommit = 'a'.repeat(40);
const currentDigest = 'sha256:' + 'b'.repeat(64);
const olderCommit = 'c'.repeat(40);
const olderDigest = 'sha256:' + 'd'.repeat(64);

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'staging-deploy-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const script = join(directory, 'deploy.sh');
  const log = join(directory, 'docker.log');
  await copyFile(new URL('../../server/staging/deploy.sh', import.meta.url), script);
  await writeFile(join(directory, 'git'), `#!/bin/bash
printf '%s\\trefs/heads/main\\n' '${currentCommit}'
`, { mode: 0o755 });
  await writeFile(join(directory, 'flock'), `#!/bin/bash
printf 'waiting for deployment lock\\n'
exec /usr/bin/flock "$@"
`, { mode: 0o755 });
  await writeFile(join(directory, 'docker'), `#!/bin/bash
printf '%s %s\\n' "\${STAGING_IMAGE:-}" "$*" >> "$DOCKER_LOG"
case "$1" in
  login) IFS= read -r token; [[ "$token" == synthetic-token ]] ;;
  buildx) printf '%s\\n' '${currentDigest}' ;;
  image|inspect) printf 'test-image\\n' ;;
  compose)
    if [[ " $* " == *' ps '* ]]; then printf 'stage-container\\n'; fi
    if [[ " $* " == *' up '* && "\${STALL_STARTUP:-}" == 1 ]]; then
      trap 'printf "stalled startup received SIGTERM\\n" >> "$DOCKER_LOG"; exit 143' TERM
      printf 'stalled Compose startup entered\\n'
      sleep 30 &
      wait $!
    fi
    ;;
  exec)
    if [[ "$2" == "-i" ]]; then
      cat >/dev/null
    else
      shift 2
      if [[ -f staging.env ]]; then
        node --env-file=staging.env "\${@:2}"
      else
        "$@"
      fi
    fi
    ;;
  *) exit 1 ;;
esac
`, { mode: 0o755 });
  await writeFile(join(directory, 'timeout'), `#!/bin/bash
if [[ "\${STALL_STARTUP:-}" == 1 && " $* " == *' up '* ]]; then
  shift 2
  printf '%s\\n' "$$" > "$TIMEOUT_PID"
  exec /usr/bin/timeout --kill-after=1s 25s "$@"
fi
exec /usr/bin/timeout "$@"
`, { mode: 0o755 });

  function start(command, args, env = {}) {
    const child = spawn(command, args, {
      cwd: directory,
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, DOCKER_LOG: log, TIMEOUT_PID: join(directory, 'timeout.pid'), ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    t.after(() => { child.kill(); });
    const result = once(child, 'close').then(([code]) => ({ code, stdout, stderr }));
    return { child, result };
  }

  function request(commit, digest, env) {
    const run = start('bash', [script], env);
    run.child.stdin.end([commit, digest, 'app[bot]', 'synthetic-token', ''].join('\n'));
    return run;
  }

  return { directory, start, request, log, timeoutPid: join(directory, 'timeout.pid') };
}

async function waitForLine(run, text) {
  const chunks = on(run.child.stdout, 'data', { signal: AbortSignal.timeout(3000), close: ['end'] });
  let stdout = '';
  for await (const [chunk] of chunks) {
    stdout += chunk;
    if (text.test(stdout)) return;
  }
  const { stderr } = await run.result;
  assert.fail('Command exited before reporting ' + text + '. ' + stderr);
}

test('staging verifies the current digest even when an older request arrives while it waits',
  { skip: process.platform !== 'linux', timeout: 10_000 }, async (t) => {
    const { start, request, log } = await fixture(t);
    const holder = start('/usr/bin/flock', ['--exclusive', '.deploy.lock',
      'bash', '-c', 'echo holding; read -r release']);
    await waitForLine(holder, /holding/);

    const current = request(currentCommit, currentDigest);
    await waitForLine(current, /waiting for deployment lock/);
    const older = request(olderCommit, olderDigest);
    await waitForLine(older, /waiting for deployment lock/);
    holder.child.stdin.end('release\n');

    const [active, skipped] = await Promise.all([current.result, older.result]);
    assert.equal(active.code, 0, active.stderr);
    assert.match(active.stdout, new RegExp(`Verified staging .* for ${currentDigest}`));
    assert.equal(skipped.code, 0, skipped.stderr);
    assert.match(skipped.stdout, new RegExp(`Skipped staging commit ${olderCommit}`));
    const dockerLog = await readFile(log, 'utf8');
    assert.ok(dockerLog.includes(`@${currentDigest} compose --env-file /dev/null --project-name meabeclick-staging -f compose.yml up `));
    assert.ok(!dockerLog.includes(olderDigest));
  });

test('staging rejects a cached digest that differs from the published commit tag',
  { skip: process.platform !== 'linux', timeout: 10_000 }, async (t) => {
    const { request, log } = await fixture(t);
    const mismatch = await request(currentCommit, olderDigest).result;
    assert.equal(mismatch.code, 1);
    assert.match(mismatch.stderr, /Published digest .* does not match the staging request/);
    const dockerLog = await readFile(log, 'utf8');
    assert.ok(dockerLog.includes(`ghcr.io/its-nix/meabeclick:${currentCommit}`));
    assert.doesNotMatch(dockerLog, /image inspect|compose/);
  });

test('a timed-out Compose startup releases the staging lock',
  { skip: process.platform !== 'linux', timeout: 10_000 }, async (t) => {
    const { request, log, timeoutPid } = await fixture(t);
    const stalled = request(currentCommit, currentDigest, { STALL_STARTUP: '1' });
    await waitForLine(stalled, /stalled Compose startup entered/);
    const next = request(currentCommit, currentDigest);
    await waitForLine(next, /waiting for deployment lock/);
    assert.equal(stalled.child.exitCode, null);
    assert.equal(next.child.exitCode, null);
    process.kill(Number(await readFile(timeoutPid, 'utf8')), 'SIGALRM');

    const [timeout, recovered] = await Promise.all([stalled.result, next.result]);
    assert.equal(timeout.code, 124, timeout.stderr);
    assert.equal(recovered.code, 0, recovered.stderr);
    assert.match(recovered.stdout, /Verified staging startup/);
    const dockerLog = await readFile(log, 'utf8');
    const interrupted = dockerLog.indexOf('stalled startup received SIGTERM');
    assert.ok(interrupted >= 0 && interrupted < dockerLog.lastIndexOf(' up --detach'));
  });

async function makeLocalTls(directory) {
  const { execFileSync } = await import('node:child_process');
  const keyPath = join(directory, 'tls-key.pem');
  const certPath = join(directory, 'tls-cert.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath, '-out', certPath, '-days', '1',
    '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1',
  ], { stdio: 'ignore' });
  const [key, cert] = await Promise.all([readFile(keyPath), readFile(certPath)]);
  return { key, cert, certPath };
}

async function startStagingTlsBackend(t, directory, {
  exposeBooking = false,
  exposeLogin = false,
  releaseHeader = `${currentCommit} ghcr.io/its-nix/meabeclick@${currentDigest}`,
  stagingEnv = "ADMIN_PASSWORD='stage-admin-secret'\n",
} = {}) {
  const { createServer } = await import('node:https');
  await writeFile(join(directory, 'https.compose.yml'), 'services: {}\n');
  await writeFile(join(directory, 'proxy-password'), 'stage-proxy-secret\n');
  await writeFile(join(directory, 'staging.env'), stagingEnv);
  const tls = await makeLocalTls(directory);

  const expectedAuth = 'Basic ' + Buffer.from('operator:stage-proxy-secret').toString('base64');
  const server = createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    const bypassAuth =
      (exposeBooking && req.url === '/booking') ||
      (exposeLogin && req.url === '/api/login');
    if (!bypassAuth && req.headers.authorization !== expectedAuth) {
      res.writeHead(401, { 'www-authenticate': 'Basic realm="restricted"' });
      res.end();
      return;
    }
    if (req.url === '/booking') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex, nofollow',
      });
      res.end('<html><body><h1>הזמנת שיעור</h1></body></html>');
      return;
    }
    if (req.url === '/api/login' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}');
        if (parsed.password === 'stage-admin-secret') {
          res.writeHead(200, { 'set-cookie': 'session=valid-stage; Path=/; HttpOnly; Secure' });
          res.end('{}');
        } else {
          // Simulates SvelteKit's 401 wrong-password response (no WWW-Authenticate: Basic).
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end('{"error":"סיסמה שגויה"}');
        }
      });
      return;
    }
    if (req.url === '/api/me') {
      const authenticated = (req.headers.cookie || '').includes('session=valid-stage');
      const headers = { 'content-type': 'application/json' };
      if (authenticated && releaseHeader) headers['x-meabeclick-release'] = releaseHeader;
      res.writeHead(200, headers);
      res.end(JSON.stringify({ authenticated }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();
  return { url: `https://127.0.0.1:${port}`, certPath: tls.certPath };
}

test('staging verifies HTTPS basic auth, booking page, tutor login (including quoted staging.env), and release header over real TLS when https.compose.yml is present',
  { skip: process.platform !== 'linux', timeout: 15_000 }, async (t) => {
    const { directory, request, log } = await fixture(t);
    const tls = await startStagingTlsBackend(t, directory, {
      stagingEnv: "ADMIN_PASSWORD='stage-admin-secret'\n",
    });

    const run = await request(currentCommit, currentDigest, {
      STAGING_PUBLIC_URL: tls.url,
      STAGING_CA_CERT: tls.certPath,
    }).result;
    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, new RegExp(`Verified staging startup, booking page, tutor session, and HTTPS ingress for ${currentDigest}`));
    const dockerLog = await readFile(log, 'utf8');
    assert.ok(dockerLog.includes('-f compose.yml -f https.compose.yml up '));
    assert.ok(dockerLog.includes('exec stage-container node -e '));
  });

test('staging HTTPS probe fails if unauthenticated requests are not rejected with 401',
  { skip: process.platform !== 'linux', timeout: 20_000 }, async (t) => {
    const { createServer } = await import('node:https');
    const { directory, request } = await fixture(t);
    await writeFile(join(directory, 'https.compose.yml'), 'services: {}\n');
    await writeFile(join(directory, 'proxy-password'), 'stage-proxy-secret\n');
    await writeFile(join(directory, 'staging.env'), 'ADMIN_PASSWORD=stage-admin-secret\n');
    const tls = await makeLocalTls(directory);

    const server = createServer({ key: tls.key, cert: tls.cert }, (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"authenticated":false}');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const { port } = server.address();

    const run = await request(currentCommit, currentDigest, {
      STAGING_PUBLIC_URL: `https://127.0.0.1:${port}`,
      STAGING_CA_CERT: tls.certPath,
    }).result;
    assert.equal(run.code, 1);
    assert.match(run.stderr, /without credentials to return 401 Basic challenge, got 200/);
  });

test('staging HTTPS probe fails when /api/me is protected but /booking is exposed anonymously',
  { skip: process.platform !== 'linux', timeout: 15_000 }, async (t) => {
    const { directory, request } = await fixture(t);
    const tls = await startStagingTlsBackend(t, directory, { exposeBooking: true });

    const run = await request(currentCommit, currentDigest, {
      STAGING_PUBLIC_URL: tls.url,
      STAGING_CA_CERT: tls.certPath,
    }).result;
    assert.equal(run.code, 1);
    assert.match(run.stderr, /\/booking without credentials to return 401 Basic challenge, got 200/);
  });

test('staging HTTPS probe fails when /api/me and /booking are protected but /api/login is exposed anonymously',
  { skip: process.platform !== 'linux', timeout: 15_000 }, async (t) => {
    const { directory, request } = await fixture(t);
    const tls = await startStagingTlsBackend(t, directory, { exposeLogin: true });

    const run = await request(currentCommit, currentDigest, {
      STAGING_PUBLIC_URL: tls.url,
      STAGING_CA_CERT: tls.certPath,
    }).result;
    assert.equal(run.code, 1);
    assert.match(run.stderr, /\/api\/login without credentials to return 401 Basic challenge, got 401/);
  });

test('staging HTTPS probe rejects a healthy backend serving a stale or wrong release identifier',
  { skip: process.platform !== 'linux', timeout: 15_000 }, async (t) => {
    const { directory, request } = await fixture(t);
    const staleRelease = `${olderCommit} ghcr.io/its-nix/meabeclick@${olderDigest}`;
    const tls = await startStagingTlsBackend(t, directory, { releaseHeader: staleRelease });

    const run = await request(currentCommit, currentDigest, {
      STAGING_PUBLIC_URL: tls.url,
      STAGING_CA_CERT: tls.certPath,
    }).result;
    assert.equal(run.code, 1);
    assert.match(run.stderr, /Expected staging HTTPS \/api\/me x-meabeclick-release/);
  });

test('staging HTTPS probe refuses plaintext http:// URLs without sending credentials',
  { skip: process.platform !== 'linux', timeout: 10_000 }, async (t) => {
    const { createServer } = await import('node:http');
    const { directory, request } = await fixture(t);
    await writeFile(join(directory, 'https.compose.yml'), 'services: {}\n');
    await writeFile(join(directory, 'proxy-password'), 'stage-proxy-secret\n');
    await writeFile(join(directory, 'staging.env'), 'ADMIN_PASSWORD=stage-admin-secret\n');

    let received = 0;
    const server = createServer((_req, res) => {
      received += 1;
      res.writeHead(200).end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const { port } = server.address();

    const run = await request(currentCommit, currentDigest, {
      STAGING_PUBLIC_URL: `http://127.0.0.1:${port}`,
    }).result;
    assert.equal(run.code, 1);
    assert.match(run.stderr, /Staging public URL must use https:\/\//);
    assert.equal(received, 0, 'must never transmit credentials or requests over plaintext HTTP');
  });

test('staging ignores the learning overlay without HTTPS', { skip: process.platform !== 'linux' }, async t => {
  const { directory, request, log } = await fixture(t);
  await writeFile(join(directory, 'learning.compose.yml'), 'services: {}\n');
  const run = await request(currentCommit, currentDigest).result;
  assert.equal(run.code, 0, run.stderr);
  const commands = await readFile(log, 'utf8');
  assert.match(commands, /-f compose\.yml up /);
  assert.doesNotMatch(commands, /learning\.compose\.yml/);
});

test('staging loads the learning overlay over HTTPS only with a proxy configuration',
  { skip: process.platform !== 'linux' }, async t => {
    const { directory, request, log } = await fixture(t);
    const tls = await startStagingTlsBackend(t, directory);
    await writeFile(join(directory, 'learning.compose.yml'), 'services: {}\n');
    const env = { STAGING_PUBLIC_URL: tls.url, STAGING_CA_CERT: tls.certPath };
    const missing = await request(currentCommit, currentDigest, env).result;
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /learning-squid\.conf/);
    assert.doesNotMatch(await readFile(log, 'utf8'), / compose /);

    await writeFile(join(directory, 'learning-squid.conf'), 'http_access deny all\n');
    const run = await request(currentCommit, currentDigest, env).result;
    assert.equal(run.code, 0, run.stderr);
    assert.match(await readFile(log, 'utf8'), /-f compose\.yml -f https\.compose\.yml -f learning\.compose\.yml up /);
  });
