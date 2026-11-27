import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const currentCommit = 'a'.repeat(40);
const currentDigest = 'sha256:' + 'b'.repeat(64);
const newerCommit = 'c'.repeat(40);

async function fixture(t, {
  mainTip = currentCommit,
  tagImageId = 'sha256:verified-id',
  runningImageId = 'sha256:verified-id',
  overrideImage = null,
  forcedConfigImage = null,
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'prod-deploy-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const script = join(directory, 'deploy-production.sh');
  const log = join(directory, 'ops.log');
  await copyFile(new URL('../../server/deploy-production.sh', import.meta.url), script);
  await writeFile(join(directory, 'docker-compose.yml'),
    'services:\n  app:\n    image: ghcr.io/its-nix/meabeclick:${APP_TAG}\n');
  if (overrideImage) {
    await writeFile(join(directory, 'docker-compose.override.yml'),
      `services:\n  app:\n    image: ${overrideImage}\n`);
  }

  await writeFile(join(directory, 'git'), `#!/bin/bash
printf 'git %s\\n' "$*" >> "$OPS_LOG"
case "$1" in
  fetch) exit 0 ;;
  rev-parse)
    if [[ "$2" == "origin/main" ]]; then printf '%s\\n' '${mainTip}'; else printf '%s\\n' '${currentCommit}'; fi
    ;;
  merge) exit 0 ;;
  *) exit 1 ;;
esac
`, { mode: 0o755 });

  await writeFile(join(directory, 'docker'), `#!/bin/bash
printf 'docker APP_TAG=%s %s\\n' "\${APP_TAG:-}" "$*" >> "$OPS_LOG"
case "$1" in
  pull) exit 0 ;;
  image)
    if [[ "$3" == *"@"* ]]; then
      printf 'sha256:verified-id\\n'
    else
      printf '%s\\n' '${tagImageId}'
    fi
    ;;
  compose)
    if [[ " $* " == *' config --format json'* ]]; then
      if [[ -n '${forcedConfigImage ?? ''}' ]]; then
        printf '{"services":{"app":{"image":"%s"}}}\\n' '${forcedConfigImage ?? ''}'
        exit 0
      fi
      # Resolve services.app.image across -f files in Compose merge order (last wins).
      shift
      files=()
      while [[ $# -gt 0 ]]; do
        if [[ "$1" == "-f" ]]; then
          files+=("$2")
          shift 2
        else
          shift
        fi
      done
      resolved=""
      for f in "\${files[@]}"; do
        img=$(awk '/^[[:space:]]*image:[[:space:]]*/ { sub(/^[[:space:]]*image:[[:space:]]*/, ""); print; exit }' "$f")
        if [[ -n "$img" ]]; then
          resolved="\${img//\\$\\{APP_TAG\\}/\${APP_TAG:-}}"
        fi
      done
      printf '{"services":{"app":{"image":"%s"}}}\\n' "$resolved"
      exit 0
    fi
    if [[ " $* " == *' ps '* ]]; then printf 'prod-container\\n'; fi
    ;;
  inspect)
    printf '%s\\n' '${runningImageId}'
    ;;
  exec) cat >/dev/null ;;
  *) exit 1 ;;
esac
`, { mode: 0o755 });

  function run(commit, digest) {
    const child = spawn('bash', [script], {
      cwd: directory,
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        OPS_LOG: log,
        PRODUCTION_REPO_DIR: directory,
        PRODUCTION_LOCK_FILE: join(directory, '.prod.lock'),
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    t.after(() => { child.kill(); });
    child.stdin.end([commit, digest, ''].join('\n'));
    return once(child, 'close').then(([code]) => ({ code, stdout, stderr }));
  }

  return { run, log };
}

test('production deploy pins checkout and container to the exact verified SHA and digest',
  { skip: process.platform !== 'linux', timeout: 10_000 }, async (t) => {
    const { run, log } = await fixture(t);
    const result = await run(currentCommit, currentDigest);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`^Deployed and verified production commit ${currentCommit} \\(${currentDigest}\\)$`, 'm'));
    const opsLog = await readFile(log, 'utf8');
    assert.ok(opsLog.includes(`git merge --ff-only ${currentCommit}`));
    assert.match(opsLog, new RegExp(`docker APP_TAG=${currentCommit} compose -f docker-compose\\.yml -f .+pin-image\\.compose\\.yml config --format json`));
    assert.match(opsLog, new RegExp(`docker APP_TAG=${currentCommit} compose -f docker-compose\\.yml -f .+pin-image\\.compose\\.yml up -d --no-build --pull never`));
  });

test('a host-local docker-compose.override.yml setting another app image cannot bypass the verified digest pin',
  { skip: process.platform !== 'linux', timeout: 10_000 }, async (t) => {
    const { run, log } = await fixture(t, { overrideImage: 'ghcr.io/its-nix/meabeclick:unverified-cached' });
    const result = await run(currentCommit, currentDigest);
    assert.equal(result.code, 0, result.stderr);
    const opsLog = await readFile(log, 'utf8');
    // The generated pin file must follow docker-compose.override.yml so the
    // effective app image resolves to the verified immutable digest before up.
    assert.match(opsLog, /compose -f docker-compose\.yml -f docker-compose\.override\.yml -f .+pin-image\.compose\.yml config --format json/);
    assert.match(opsLog, /compose -f docker-compose\.yml -f docker-compose\.override\.yml -f .+pin-image\.compose\.yml up -d --no-build --pull never/);
  });

test('production deploy aborts before starting Compose if effective app image differs from the verified digest',
  { skip: process.platform !== 'linux', timeout: 10_000 }, async (t) => {
    const { run, log } = await fixture(t, { forcedConfigImage: 'ghcr.io/its-nix/meabeclick:unverified-cached' });
    const result = await run(currentCommit, currentDigest);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Effective Compose app image .* does not match verified digest/);
    const opsLog = await readFile(log, 'utf8');
    assert.doesNotMatch(opsLog, / up -d /);
  });

test('production deploy skips without mutating the box when main moved ahead',
  { skip: process.platform !== 'linux', timeout: 10_000 }, async (t) => {
    const { run, log } = await fixture(t, { mainTip: newerCommit });
    const result = await run(currentCommit, currentDigest);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`Skipped production commit ${currentCommit} because main is ${newerCommit}`));
    const opsLog = await readFile(log, 'utf8');
    assert.doesNotMatch(opsLog, /git merge|docker compose/);
  });

test('production deploy refuses rollout when commit tag image ID differs from verified digest',
  { skip: process.platform !== 'linux', timeout: 10_000 }, async (t) => {
    const { run, log } = await fixture(t, { tagImageId: 'sha256:tampered-id' });
    const result = await run(currentCommit, currentDigest);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /does not match verified digest/);
    const opsLog = await readFile(log, 'utf8');
    assert.doesNotMatch(opsLog, /docker compose/);
  });

test('production deploy fails if running container image ID differs from verified digest',
  { skip: process.platform !== 'linux', timeout: 10_000 }, async (t) => {
    const { run } = await fixture(t, { runningImageId: 'sha256:stale-id' });
    const result = await run(currentCommit, currentDigest);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Running production container image .* does not match verified image/);
  });
