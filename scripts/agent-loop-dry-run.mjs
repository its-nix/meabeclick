#!/usr/bin/env node
/**
 * Local-only, single-process dry run of an idempotent signal classifier.
 * Reads one JSON record from stdin and writes one JSON result to stdout.
 * No network, Hermes, Kanban, cron, project database, or messaging access.
 *
 * Usage: node scripts/agent-loop-dry-run.mjs /path/to/scratch-state.json
 * Input: {"fingerprint":"opaque-synthetic-id","actionable":true|false}
 */
import { createHash } from 'node:crypto';
import { closeSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const MAX_INPUT_BYTES = 4096;
const VERSION = 1;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function readState(path) {
  try {
    const state = JSON.parse(readFileSync(path, 'utf8'));
    if (state?.version !== VERSION || typeof state.fingerprintHash !== 'string') {
      throw new Error('invalid state shape');
    }
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
const duplicate = previous?.fingerprintHash === fingerprintHash;
const idempotencyKey = createHash('sha256').update(`agent-loop-dry-run:v${VERSION}:${fingerprintHash}`).digest('hex');
const result = input.actionable && !duplicate
  ? { status: 'PROPOSED_ACTION', idempotencyKey }
  : { status: 'NO_CHANGE' };

const nextState = JSON.stringify({ version: VERSION, fingerprintHash }) + '\n';
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
