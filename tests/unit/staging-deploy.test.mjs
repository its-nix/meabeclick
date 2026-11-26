import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
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
printf '%s %s\\n' "$STAGING_IMAGE" "$*" >> "$DOCKER_LOG"
case "$1" in
  image|inspect) printf 'test-image\\n' ;;
  compose)
    if [[ " $* " == *' ps '* ]]; then printf 'stage-container\\n'; fi
    if [[ " $* " == *' up '* && "\${STALL_STARTUP:-}" == 1 ]]; then exec sleep 30; fi
    ;;
  exec) cat >/dev/null ;;
  *) exit 1 ;;
esac
`, { mode: 0o755 });
  await writeFile(join(directory, 'timeout'), `#!/bin/bash
if [[ "\${STALL_STARTUP:-}" == 1 && " $* " == *' up '* ]]; then
  shift 2
  exec /usr/bin/timeout --kill-after=1s 0.1s "$@"
fi
exec /usr/bin/timeout "$@"
`, { mode: 0o755 });

  function start(command, args, env = {}) {
    const child = spawn(command, args, {
      cwd: directory,
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, DOCKER_LOG: log, ...env },
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

  return { start, request, log };
}

async function waitForLine(run, text) {
  await Promise.race([
    once(run.child.stdout, 'data', { signal: AbortSignal.timeout(3000) })
      .then(([chunk]) => assert.match(chunk, text)),
    run.result.then(({ stderr }) => assert.fail('Command exited before reporting ' + text + '. ' + stderr)),
  ]);
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
    assert.ok(dockerLog.includes(`@${currentDigest} compose --env-file /dev/null --project-name meabeclick-staging up `));
    assert.ok(!dockerLog.includes(olderDigest));
  });

test('a timed-out Compose startup releases the staging lock',
  { skip: process.platform !== 'linux', timeout: 10_000 }, async (t) => {
    const { request } = await fixture(t);
    const stalled = request(currentCommit, currentDigest, { STALL_STARTUP: '1' });
    await waitForLine(stalled, /waiting for deployment lock/);
    const next = request(currentCommit, currentDigest);
    const [timeout, recovered] = await Promise.all([stalled.result, next.result]);
    assert.equal(timeout.code, 124, timeout.stderr);
    assert.equal(recovered.code, 0, recovered.stderr);
    assert.match(recovered.stdout, /Verified staging startup/);
  });
