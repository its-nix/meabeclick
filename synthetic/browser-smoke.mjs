import { createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { loopbackUrlIssue } from './runtime-policy.mjs';
import { createOriginProxy } from './browser-origin-proxy.mjs';

const SECRET = 'synthetic-test-secret-not-for-production-7ee72572';
const STUDENT_ID = 92001;
const STUDENT_CODE = 'synthetic-student-gamma';
const TASK = 'פתרו x² = 16 והסבירו את שתי התשובות — משימת בדיקה';
const EXPECTED_GRADE = 'נבדק — יפה מאוד';
const requestedBaseUrl = process.argv[2];
const CDP_TIMEOUT_MS = 5_000;
const OVERALL_TIMEOUT_MS = 45_000;

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`[synthetic] ${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

const issue = loopbackUrlIssue(requestedBaseUrl, requestedBaseUrl);
if (issue) throw new Error(`[synthetic] browser smoke target rejected: ${issue}`);
const baseUrl = new URL(requestedBaseUrl).origin;

const chrome = process.env.CHROME_BIN || [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find(existsSync);
if (!chrome) throw new Error('[synthetic] browser smoke requires Chrome/Chromium or CHROME_BIN');

const profile = await mkdtemp(join(tmpdir(), 'mb-'));
const proxy = await createOriginProxy(baseUrl);
const browser = spawn(chrome, [
  `--proxy-server=${proxy.url}`,
  '--proxy-bypass-list=<-loopback>',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
  '--disable-quic',
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--disable-extensions',
  '--disable-popup-blocking',
  '--headless=new',
  '--remote-debugging-port=0',
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-domain-reliability',
  '--disable-features=OptimizationHints,MediaRouter,Translate',
  '--disable-sync',
  '--metrics-recording-only',
  '--password-store=basic',
  '--use-mock-keychain',
  '--window-size=390,844',
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let browserStderr = '';
let browserError;
browser.on('error', (error) => { browserError = error; });
browser.stderr.on('data', (chunk) => { browserStderr += chunk; });

async function devtoolsPort() {
  const file = join(profile, 'DevToolsActivePort');
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const [port] = (await readFile(file, 'utf8')).trim().split('\n');
      if (port) return Number(port);
    } catch {
      // Chrome writes the file only after its debugging endpoint is ready.
    }
    if (browserError) throw browserError;
    if (browser.exitCode !== null || browser.signalCode !== null) {
      throw new Error(`[synthetic] browser exited before startup (${browser.exitCode ?? browser.signalCode}): ${browserStderr}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`[synthetic] browser debugging endpoint did not start: ${browserStderr}`);
}

async function pageSocket(port) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(1_000),
      }).then((response) => response.json());
      const target = targets.find((entry) => entry.type === 'page');
      if (target?.webSocketDebuggerUrl) return target.webSocketDebuggerUrl;
    } catch {
      // Retry until Chrome publishes its initial page target.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('[synthetic] browser page target did not become available');
}

let pageOriginViolation = false;
function cdp(socket) {
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    // Reporting only; the browser-wide proxy already prevents contact, even
    // for targets not attached to this page's debugging session.
    const url = message.params?.request?.url ?? (message.method === 'Network.webSocketCreated' ? message.params?.url : null);
    if (url && /^(https?|wss?):/.test(url) && new URL(url).origin !== baseUrl) pageOriginViolation = true;
    if (!message.id) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  const rejectPending = () => {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('[synthetic] browser debugging connection closed'));
    }
    pending.clear();
  };
  socket.addEventListener('close', rejectPending, { once: true });
  socket.addEventListener('error', rejectPending, { once: true });
  return (method, params = {}) => new Promise((resolve, reject) => {
    const callId = ++id;
    const timer = setTimeout(() => {
      pending.delete(callId);
      reject(new Error(`[synthetic] browser command ${method} timed out after ${CDP_TIMEOUT_MS}ms`));
    }, CDP_TIMEOUT_MS);
    pending.set(callId, { resolve, reject, timer });
    try {
      socket.send(JSON.stringify({ id: callId, method, params }));
    } catch (error) {
      clearTimeout(timer);
      pending.delete(callId);
      reject(error);
    }
  });
}

async function waitFor(call, expression, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.result.value) return result.result.value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const snapshot = await call('Runtime.evaluate', {
    expression: `({ url: location.href, text: document.body.innerText, cards: [...document.querySelectorAll('.card')].map((card) => ({ text: card.innerText, html: card.outerHTML })) })`,
    returnByValue: true,
  }).catch(() => null);
  throw new Error(`[synthetic] rendered UI assertion timed out: ${expression}\n${JSON.stringify(snapshot?.result?.value)}`);
}

let socket;
let interrupt;
const interrupted = new Promise((_, reject) => { interrupt = reject; });
const onSignal = () => interrupt(new Error('[synthetic] browser smoke interrupted'));
process.on('SIGTERM', onSignal);
process.on('SIGINT', onSignal);
try {
  await withTimeout(Promise.race([interrupted, (async () => {
    const port = await devtoolsPort();
    socket = new WebSocket(await pageSocket(port));
    await withTimeout(new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    }), CDP_TIMEOUT_MS, 'browser debugging connection');
    const call = cdp(socket);
    await call('Network.enable');
    await call('Page.enable');
    await call('Runtime.enable');

    const payload = `s.${STUDENT_ID}.${Date.now() + 60_000}`;
    const signature = createHmac('sha256', SECRET).update(payload).digest('base64url');
    const token = `${payload}.${signature}`;
    await call('Page.navigate', { url: `${baseUrl}/enter?t=${encodeURIComponent(token)}` });

    await waitFor(call, `document.querySelector('.bottom-nav') && document.body.innerText.includes('שיעורי בית')`);
    const locationResult = await call('Runtime.evaluate', { expression: 'location.origin + location.pathname + location.search', returnByValue: true });
    if (locationResult.result.value !== `${baseUrl}/app/student?s=${STUDENT_CODE}`) {
      throw new Error(`[synthetic] browser reached unexpected student route: ${locationResult.result.value}`);
    }

    await call('Page.navigate', { url: `${baseUrl}/app/student?s=${STUDENT_CODE}&v=hw` });
    await waitFor(call, `document.querySelector('.bottom-nav button[aria-current="page"]')?.textContent?.includes('שיעורי בית')`);

    const rendered = await waitFor(call, `(() => {
      const cards = [...document.querySelectorAll('.card')];
      const card = cards.find((item) => item.textContent?.includes(${JSON.stringify(TASK)}));
      if (!card || !card.checkVisibility()) return false;
      const badge = card.querySelector('.badge.graded.ok');
      const replay = [...card.querySelectorAll('a')].find((item) => item.textContent?.includes('לשחק שוב'));
      return badge?.textContent?.trim() === ${JSON.stringify(EXPECTED_GRADE)} && Boolean(replay?.checkVisibility())
        ? { task: ${JSON.stringify(TASK)}, submittedLabel: replay.textContent.trim(), gradeLabel: badge.textContent.trim() }
        : false;
    })()`);

    if (pageOriginViolation) throw new Error('[synthetic] browser page attempted to escape the exact synthetic origin');
    console.log(`[synthetic] rendered student homework passed: ${JSON.stringify(rendered)}`);
  })()]), OVERALL_TIMEOUT_MS, 'rendered browser smoke');
} finally {
  try {
    if (socket && socket.readyState !== WebSocket.CLOSED) socket.close();
    if (browser.exitCode === null) browser.kill('SIGTERM');
    await withTimeout(new Promise((resolve) => {
      if (browser.exitCode !== null || browser.signalCode !== null) resolve();
      else browser.once('close', resolve);
    }), 2_000, 'browser shutdown').catch(async () => {
      if (browser.exitCode === null) browser.kill('SIGKILL');
      await withTimeout(new Promise((resolve) => {
        if (browser.exitCode !== null || browser.signalCode !== null) resolve();
        else browser.once('close', resolve);
      }), 2_000, 'forced browser shutdown');
    });
  } finally {
    await proxy.close();
    await rm(profile, { recursive: true, force: true });
    process.off('SIGTERM', onSignal);
    process.off('SIGINT', onSignal);
  }
}
