import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = new URL('../../scripts/agent-loop-dry-run.mjs', import.meta.url);

function run(statePath, input) {
  return spawnSync(process.execPath, [script.pathname, statePath], {
    input: JSON.stringify(input), encoding: 'utf8', timeout: 5000,
  });
}

test('dry-run proposes once for a changed actionable signal, then stays quiet', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mea-loop-dry-run-'));
  const state = join(dir, 'state.json');
  try {
    const first = run(state, { fingerprint: 'synthetic-a', actionable: true });
    assert.equal(first.status, 0, first.stderr);
    const proposal = JSON.parse(first.stdout);
    assert.equal(proposal.status, 'PROPOSED_ACTION');
    assert.match(proposal.idempotencyKey, /^[a-f0-9]{64}$/);
    assert.equal(first.stdout.includes('synthetic-a'), false);

    const repeat = run(state, { fingerprint: 'synthetic-a', actionable: true });
    assert.equal(repeat.status, 0, repeat.stderr);
    assert.deepEqual(JSON.parse(repeat.stdout), { status: 'NO_CHANGE' });

    const changed = run(state, { fingerprint: 'synthetic-b', actionable: true });
    assert.equal(changed.status, 0, changed.stderr);
    assert.equal(JSON.parse(changed.stdout).status, 'PROPOSED_ACTION');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('healthy/non-actionable input emits NO_CHANGE and repeated ticks remain quiet', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mea-loop-dry-run-'));
  const state = join(dir, 'state.json');
  try {
    for (let i = 0; i < 2; i += 1) {
      const result = run(state, { fingerprint: 'synthetic-healthy', actionable: false });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { status: 'NO_CHANGE' });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('invalid state fails closed without replacing the state file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mea-loop-dry-run-'));
  const state = join(dir, 'state.json');
  try {
    const original = '{broken state';
    writeFileSync(state, original);
    const result = run(state, { fingerprint: 'synthetic-x', actionable: true });
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(state, 'utf8'), original);
    assert.match(result.stderr, /refusing to overwrite/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('invalid input does not create state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mea-loop-dry-run-'));
  const state = join(dir, 'state.json');
  try {
    const result = spawnSync(process.execPath, [script.pathname, state], {
      input: '{"fingerprint":"synthetic"}', encoding: 'utf8', timeout: 5000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /expected/);
    assert.throws(() => readFileSync(state, 'utf8'), { code: 'ENOENT' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
