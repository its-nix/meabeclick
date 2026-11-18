// How the lesson engine (Codex) is located, and how its failures are named.
//
// Written after a production outage in which the Claude subscription's Claude
// Code entitlement was revoked. The CLI answered, on STDOUT with stderr empty:
//
//   Your organization has disabled Claude subscription access for Claude Code
//
// The runner captured only stderr, so the cause — "renew a subscription" —
// was never written down. Failures are now classified from both streams.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';


const {
  engineBin, engineHasCredentials, classifyOutput, LessonGenerationError,
} = await import('../../src/lib/server/lesson/engine.ts');

const ENV_KEYS = ['CODEX_BIN', 'CODEX_HOME', 'OPENAI_API_KEY'];

/** Runs fn with the engine-related environment set to exactly `env`, and
 *  restores whatever was there before. The suite runs in one process, so
 *  leaking any of these would make later tests depend on order. */
async function withEnv(env, fn) {
  const saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    for (const k of ENV_KEYS) delete process.env[k];
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  }
}

test('engineBin honours the test override', async () => {
  await withEnv({}, () => assert.equal(engineBin(), 'codex'));
  await withEnv({ CODEX_BIN: '/opt/codex' }, () => assert.equal(engineBin(), '/opt/codex'));
});

/* ───────────────────────── credentials ───────────────────────── */

test('codex credentials come from auth.json on disk, or an API key', async () => {
  // Not an env var, unlike CLAUDE_CODE_OAUTH_TOKEN: `codex login` writes a
  // file and refreshes it in place. That difference is the whole deployment
  // story — the container mounts a path instead of receiving a secret.
  const empty = await mkdtemp(join(tmpdir(), 'codex-home-'));
  const authed = await mkdtemp(join(tmpdir(), 'codex-home-'));
  await writeFile(join(authed, 'auth.json'), '{"auth_mode":"chatgpt"}');

  await withEnv({ CODEX_HOME: empty }, () => assert.equal(engineHasCredentials(), false));
  await withEnv({ CODEX_HOME: authed }, () => assert.equal(engineHasCredentials(), true));
  await withEnv({ CODEX_HOME: empty, OPENAI_API_KEY: 'sk-test' },
    () => assert.equal(engineHasCredentials(), true));
});


/* ───────────────────────── failure classification ───────────────────────── */

test('the sentence that caused the outage is recognised as an auth failure', () => {
  assert.equal(
    classifyOutput('Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API key instead'),
    'engine-auth',
  );
  assert.equal(classifyOutput('Not logged in. Please run codex login.'), 'engine-auth');
  assert.equal(classifyOutput('stream error: 401 Unauthorized'), 'engine-auth');
});

test('running out of credits is its own kind, not a generic failure', () => {
  // Verbatim from the first end-to-end production run. It was reported as
  // engine-failed — accurate, and useless to the tutor: the credential was
  // fine, nothing was broken, and the answer was "wait or top up".
  assert.equal(
    classifyOutput("ERROR: You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 7:38 PM."),
    'engine-quota',
  );
  assert.equal(classifyOutput('429 Too Many Requests'), 'engine-quota');
  assert.equal(classifyOutput('RESOURCE_EXHAUSTED'), 'engine-quota');
});

test('a quota message is not mistaken for an expired credential', () => {
  // A quota error can carry "429", which the auth phrases also match. Being
  // told to renew a credential that is working sends you to re-authorise
  // something that was never the problem.
  assert.equal(classifyOutput('429 rate limit exceeded, unauthorized retry'), 'engine-quota');
});

test('an unrecognised failure is left unclassified rather than guessed at', () => {
  // It must narrow a failure or say nothing — never invent one. The
  // unmatched case still logs its full output, so nothing is lost but the
  // more specific dashboard message.
  assert.equal(classifyOutput('ENOSPC: no space left on device'), null);
  assert.equal(classifyOutput(''), null);
});
