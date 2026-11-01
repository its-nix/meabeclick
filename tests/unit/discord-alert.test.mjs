import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'discord-alert-')), 'results.db');
const A = await import('../../src/lib/server/ops-alert.ts');
const HOOK = 'https://discord.com/api/webhooks/123456789/test-secret_token';
const channel = { kind: 'discord', webhookUrl: HOOK };
const quiet = { error() {}, warn() {} };

test('Discord configuration suppresses tutor fallback and rejects unsafe URLs without echoing them', () => {
  const configured = A.alertChannels({ OPS_DISCORD_WEBHOOK_URL: ' ' + HOOK + ' ', CALLMEBOT_API_KEY: 'unused' });
  assert.deepEqual(configured, { ok: true, channels: [channel] });
  assert.equal(A.channelLabel(channel), 'discord (OPS_DISCORD_WEBHOOK_URL)');
  for (const bad of [
    'http://discord.com/api/webhooks/123/token',
    'https://discord.com.evil.test/api/webhooks/123/token',
    'https://user:password@discord.com/api/webhooks/123/token',
    HOOK + '?thread_id=123', HOOK + '#fragment', HOOK + '\nheader',
    'https://discord.com/api/webhooks/not-a-number/token',
  ]) {
    const r = A.alertChannels({ OPS_DISCORD_WEBHOOK_URL: bad, CALLMEBOT_API_KEY: 'unused' });
    assert.equal(r.ok, false);
    assert.ok(!r.reason.includes(bad));
  }
});

test('Discord waits for a saved message, disables mentions, and bounds Unicode content', async () => {
  let request;
  const r = await A.sendDiscord('@everyone <@123> ' + '🦊'.repeat(2000), HOOK, async (url, init) => {
    request = { url, init };
    return Response.json({ id: '987654321' });
  });
  assert.deepEqual(r, { ok: true });
  assert.equal(request.url, HOOK + '?wait=true');
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.redirect, 'error');
  assert.ok(request.init.signal instanceof AbortSignal);
  const body = JSON.parse(request.init.body);
  assert.deepEqual(body.allowed_mentions, { parse: [] });
  assert.ok(body.content.length <= 2000);
  assert.ok(body.content.endsWith('…'));
  assert.ok(!body.content.isWellFormed || body.content.isWellFormed());
});

test('Discord refuses unconfirmed delivery and never exposes returned or thrown credentials', async () => {
  const responses = [
    new Response(HOOK, { status: 429 }),
    new Response(null, { status: 204 }),
    new Response(HOOK),
    Response.json({}),
    Response.json({ id: HOOK }),
  ];
  for (const response of responses) {
    const r = await A.sendDiscord('failure', HOOK, async () => response);
    assert.equal(r.ok, false);
    assert.ok(!r.error.includes('test-secret_token'));
  }
  const thrown = await A.sendDiscord('failure', HOOK, async () => { throw new Error(HOOK); });
  assert.deepEqual(thrown, { ok: false, error: 'Discord request failed' });
  let fetched = false;
  assert.equal((await A.sendDiscord('failure', 'https://example.com', async () => { fetched = true; })).ok, false);
  assert.equal(fetched, false);
});

test('shared delivery sends one Discord summary on failure, stays quiet when healthy, and surfaces rejection', async () => {
  const sends = [];
  const args = {
    tag: 'test-health', ok: true, message: null, report: {},
    channels: { ok: true, channels: [channel] }, log: quiet,
    send: async (text, c) => { sends.push({ text, c }); return { ok: true }; },
  };
  assert.equal((await A.deliverAlert(args)).status, 200);
  assert.equal(sends.length, 0);
  const sent = await A.deliverAlert({ ...args, ok: false, message: 'one failure summary' });
  assert.equal(sent.status, 200);
  assert.deepEqual(sends, [{ text: 'one failure summary', c: channel }]);
  assert.deepEqual(sent.body.sent, ['discord (OPS_DISCORD_WEBHOOK_URL)']);
  const rejected = await A.deliverAlert({ ...args, ok: false, message: 'failure',
    send: async () => ({ ok: false, error: 'Discord answered 429' }) });
  assert.equal(rejected.status, 502);
  assert.equal(rejected.body.sendFailures[0].channel, 'discord (OPS_DISCORD_WEBHOOK_URL)');
});

test('the real channel dispatcher routes Discord to the webhook sender', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      assert.equal(url, HOOK + '?wait=true');
      return Response.json({ id: '987654321' });
    };
    assert.deepEqual(await A.sendAlert('summary', channel), { ok: true });
  } finally {
    globalThis.fetch = original;
  }
});
