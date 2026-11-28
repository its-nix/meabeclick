import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

for (const action of ['up', 'verify', 'down', 'rebuild']) {
  test(`lifecycle bounds stalled Compose ${action} and reports unsuccessful cleanup`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'synthetic-bounds-'));
    try {
      await mkdir(join(dir, 'scripts'));
      await mkdir(join(dir, 'bin'));
      const source = await readFile('scripts/synthetic-vps.sh', 'utf8');
      const script = join(dir, 'scripts/synthetic-vps.sh');
      await writeFile(script, source.replace('/tmp/meabeclick-synthetic-${UID}.lock.d', join(dir, 'lock.d')));
      await writeFile(join(dir, 'bin', 'docker'), `#!/bin/bash
printf 'docker %s\n' "$*" >> "$LOG"
sleep 10
`, { mode: 0o755 });
      await writeFile(join(dir, 'bin', 'timeout'), `#!/bin/bash
printf 'timeout %s\n' "$*" >> "$LOG"
[[ "$1" == --signal=TERM && "$2" == --kill-after=5s ]] || exit 88
shift 3
exec /usr/bin/timeout --signal=TERM --kill-after=0.1s 0.15s "$@"
`, { mode: 0o755 });
      const log = join(dir, 'calls');
      const started = performance.now();
      const result = spawnSync('bash', [script, action], { env: { PATH: `${join(dir, 'bin')}:${process.env.PATH}`, LOG: log }, encoding: 'utf8', timeout: 2_000 });
      assert.equal(result.error, undefined, `lifecycle did not bound operation: ${result.error}`);
      assert.equal(result.status, 124, result.stderr);
      assert.ok(performance.now() - started < 1_500);
      const calls = await readFile(log, 'utf8');
      assert.match(calls, /timeout --signal=TERM --kill-after=5s \d+s docker compose --env-file \/dev\/null --project-name meabeclick-synthetic/);
      if (action === 'up' || action === 'verify') {
        assert.match(calls, /down --volumes --remove-orphans/);
        assert.match(result.stderr, /cleanup failed.*resources may remain/);
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}
