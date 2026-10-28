#!/usr/bin/env node
/**
 * Local-only, single-process dry run of an idempotent signal classifier.
 * Reads one JSON record from stdin and writes one JSON result to stdout.
 * No network, Hermes, Kanban, cron, project database, or messaging access.
 * Actionable hashes remain deduplicated in state (max 1000; fail closed when full).
 * Single-process only: concurrent invocations are not safe. The embedded outbox
 * is a durable synthetic local handoff record, not a real queued task/message.
 *
 * Usage: node scripts/agent-loop-dry-run.mjs /path/to/scratch-state.json
 * Input: {"fingerprint":"opaque-synthetic-id","actionable":true|false}
 */
import { createHash } from 'node:crypto';
import { closeSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const MAX_INPUT_BYTES = 4096;
const VERSION = 2;
const MAX_HANDLED = 1000;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function readState(path) {
  try {
    const state = JSON.parse(readFileSync(path, 'utf8'));
    if (!state || Array.isArray(state) || state.version !== VERSION
        || !Array.isArray(state.handledActionableHashes) || !Array.isArray(state.outbox)
        || state.handledActionableHashes.length > MAX_HANDLED) {
      throw new Error('invalid state shape');
    }
    const hashes = state.handledActionableHashes;
    if (hashes.some((hash) => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))
        || new Set(hashes).size !== hashes.length) throw new Error('invalid handled hashes');
    if (state.outbox.length !== hashes.length) throw new Error('outbox/handled count mismatch');
    const outboxKeys = new Set();
    const outboxHashes = new Set();
    for (const item of state.outbox) {
      if (!item || Array.isArray(item) || typeof item !== 'object'
          || !/^[a-f0-9]{64}$/.test(item.fingerprintHash ?? '')
          || !/^[a-f0-9]{64}$/.test(item.idempotencyKey ?? '')
          || item.status !== 'LOCAL_SYNTHETIC_HANDOFF') throw new Error('invalid outbox entry');
      const expectedKey = createHash('sha256')
        .update(`agent-loop-dry-run:v${VERSION}:${item.fingerprintHash}`).digest('hex');
      if (item.idempotencyKey !== expectedKey || outboxKeys.has(item.idempotencyKey)
          || outboxHashes.has(item.fingerprintHash)) throw new Error('inconsistent outbox entry');
      outboxKeys.add(item.idempotencyKey);
      outboxHashes.add(item.fingerprintHash);
    }
    if (hashes.some((hash) => !outboxHashes.has(hash))) throw new Error('outbox/handled mismatch');
    return state;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new Error('state is unreadable or invalid; refusing to overwrite it');
  }
}

const statePath = process.argv[2];
if (!statePath || process.argv.length !== 3) fail('usage: node scripts/agent-loop-dry-run.mjs <explicit-local-state-path>');

let input;
try {
  const raw = readFileSync(0, 'utf8');
  if (Buffer.byteLength(raw, 'utf8') > MAX_INPUT_BYTES) fail('input too large');
  input = JSON.parse(raw);
} catch {
  fail('stdin must contain one small JSON object');
}
if (!input || Array.isArray(input) || typeof input !== 'object'
    || typeof input.fingerprint !== 'string' || !input.fingerprint.trim()
    || typeof input.actionable !== 'boolean') {
  fail('expected {"fingerprint":"non-empty opaque id","actionable":boolean}');
}

const fingerprintHash = createHash('sha256').update(input.fingerprint).digest('hex');
let previous;
try {
  previous = readState(statePath);
} catch (error) {
  fail(error.message);
}
const handled = previous?.handledActionableHashes ?? [];
const duplicate = handled.includes(fingerprintHash);
const idempotencyKey = createHash('sha256').update(`agent-loop-dry-run:v${VERSION}:${fingerprintHash}`).digest('hex');
const nextHandled = input.actionable && !duplicate ? [...handled, fingerprintHash] : handled;
if (nextHandled.length > MAX_HANDLED) fail('handled-action retention limit reached; refusing to discard deduplication history');
const outbox = previous?.outbox ?? [];
const result = input.actionable && !duplicate
  ? { status: 'PROPOSED_ACTION', idempotencyKey }
  : { status: 'NO_CHANGE' };
const nextOutbox = input.actionable && !duplicate
  ? [...outbox, { idempotencyKey, fingerprintHash, status: 'LOCAL_SYNTHETIC_HANDOFF' }]
  : outbox;

// Healthy observations never enter the handled set. The JSON outbox is durable
// local evidence only; it does not enqueue a real Kanban task or send a message.
const nextState = JSON.stringify({ version: VERSION, handledActionableHashes: nextHandled, outbox: nextOutbox }) + '\n';
const tempPath = join(dirname(statePath), `.${basename(statePath)}.${process.pid}.tmp`);
let fd;
try {
  fd = openSync(tempPath, 'wx', 0o600);
  writeFileSync(fd, nextState, 'utf8');
  closeSync(fd);
  fd = undefined;
  renameSync(tempPath, statePath);
} catch {
  if (fd !== undefined) closeSync(fd);
  try { unlinkSync(tempPath); } catch { /* no temp file to remove */ }
  fail('could not persist local dry-run state');
}
process.stdout.write(`${JSON.stringify(result)}\n`);