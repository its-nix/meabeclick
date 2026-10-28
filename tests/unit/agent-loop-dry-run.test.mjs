import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

test('healthy observation does not consume a later actionable transition', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mea-loop-dry-run-'));
  const state = join(dir, 'state.json');
  try {
    assert.equal(JSON.parse(run(state, { fingerprint: 'synthetic-a', actionable: false }).stdout).status, 'NO_CHANGE');
    const actionable = run(state, { fingerprint: 'synthetic-a', actionable: true });
    assert.equal(actionable.status, 0, actionable.stderr);
    assert.equal(JSON.parse(actionable.stdout).status, 'PROPOSED_ACTION');
    const saved = JSON.parse(readFileSync(state, 'utf8'));
    assert.equal(saved.outbox.length, 1);
    assert.equal(saved.outbox[0].status, 'LOCAL_SYNTHETIC_HANDOFF');
    assert.equal(saved.outbox[0].idempotencyKey, JSON.parse(actionable.stdout).idempotencyKey);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('interleaved actionable fingerprints are each handed off exactly once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mea-loop-dry-run-'));
  const state = join(dir, 'state.json');
  try {
    const statuses = [true, true, true, true, true].map((actionable, i) => {
      const fingerprint = ['A', 'B', 'A', 'C', 'B'][i];
      const result = run(state, { fingerprint: `synthetic-${fingerprint}`, actionable });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout).status;
    });
    assert.deepEqual(statuses, ['PROPOSED_ACTION', 'PROPOSED_ACTION', 'NO_CHANGE', 'PROPOSED_ACTION', 'NO_CHANGE']);
    const saved = JSON.parse(readFileSync(state, 'utf8'));
    assert.equal(saved.outbox.length, 3);
    assert.equal(new Set(saved.outbox.map((entry) => entry.idempotencyKey)).size, 3);
    assert.equal(saved.handledActionableHashes.length, 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
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

test('malformed or inconsistent v2 outbox state fails closed without replacing bytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mea-loop-dry-run-'));
  const state = join(dir, 'state.json');
  const validHash = 'a'.repeat(64);
  const malformedStates = [
    { version: 2, handledActionableHashes: [], outbox: 'invalid' },
    { version: 2, handledActionableHashes: [validHash], outbox: [] },
    { version: 2, handledActionableHashes: [], outbox: [{ fingerprintHash: validHash, idempotencyKey: 'b'.repeat(64), status: 'LOCAL_SYNTHETIC_HANDOFF' }] },
    { version: 2, handledActionableHashes: [validHash, validHash], outbox: [] },
    { version: 2, handledActionableHashes: ['not-a-hash'], outbox: [] },
    { version: 2, handledActionableHashes: [], outbox: [{ fingerprintHash: validHash, idempotencyKey: 'b'.repeat(64), status: 'CORRUPT' }] },
  ];
  try {
    for (const malformed of malformedStates) {
      const original = JSON.stringify(malformed);
      writeFileSync(state, original);
      const result = run(state, { fingerprint: 'synthetic-x', actionable: true });
      assert.notEqual(result.status, 0, original);
      assert.equal(result.stdout, '');
      assert.equal(readFileSync(state, 'utf8'), original);
      assert.match(result.stderr, /refusing to overwrite/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('retention limit fails closed instead of evicting deduplication history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mea-loop-dry-run-'));
  const state = join(dir, 'state.json');
  try {
    const hashes = Array.from({ length: 1000 }, (_, i) => i.toString(16).padStart(64, '0'));
    const outbox = hashes.map((fingerprintHash) => ({
      fingerprintHash,
      idempotencyKey: createHashForTest(fingerprintHash),
      status: 'LOCAL_SYNTHETIC_HANDOFF',
    }));
    const original = JSON.stringify({ version: 2, handledActionableHashes: hashes, outbox });
    writeFileSync(state, original);
    const result = run(state, { fingerprint: 'synthetic-overflow', actionable: true });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(readFileSync(state, 'utf8'), original);
    assert.match(result.stderr, /retention limit/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function createHashForTest(fingerprintHash) {
  return createHash('sha256').update(`agent-loop-dry-run:v2:${fingerprintHash}`).digest('hex');
}
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
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
