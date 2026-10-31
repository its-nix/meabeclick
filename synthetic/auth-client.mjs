import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

// A private anonymous pipe, not Docker logs or a persisted fixture file.
export async function openAuthFixture(signal) {
  const child = spawn('docker', ['compose', '--env-file', '/dev/null', '--project-name', 'meabeclick-synthetic',
    '--file', fileURLToPath(new URL('../docker-compose.synthetic.yml', import.meta.url)),
    'exec', '-T', 'app', 'node', 'synthetic/auth-fixture.mjs'], {
    stdio: ['pipe', 'pipe', 'pipe'], signal,
  });
  // Never forward subprocess output: it includes the ephemeral raw token.
  child.stderr.resume();
  let failure;
  child.on('error', () => { failure = new Error('[synthetic] fixture transport failed'); });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const read = async () => {
    const item = await lines.next();
    if (failure || item.done) throw new Error('[synthetic] fixture handoff ended unexpectedly');
    let body;
    try { body = JSON.parse(item.value); } catch { throw new Error('[synthetic] invalid private fixture protocol'); }
    return body;
  };
  const close = async () => {
    child.stdin.end();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await new Promise(resolve => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 2_000);
        child.once('close', () => { clearTimeout(timer); resolve(); });
      });
    }
  };
  try {
    const { token } = await read();
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('[synthetic] malformed fixture handoff');
    console.log('[synthetic] fixture handoff ready: twice-reseeded exact baseline; one production-issued student link + unused join; 15-minute TTL');
    return { token, close, check: async phase => {
      child.stdin.write(phase + '\n');
      if ((await read()).verified !== phase) throw new Error('[synthetic] lifecycle verification failed');
      console.log(`[synthetic] exhaustive all-table lifecycle readback passed: ${phase}`);
    } };
  } catch (error) { await close(); throw error; }
}

export async function assertStudentScope(baseUrl, cookie, signal, fetcher = globalThis.fetch) {
  const get = path => fetcher(`${baseUrl}${path}`, { headers: { cookie }, redirect: 'manual', signal });
  const family = await get('/api/family');
  const body = await family.json();
  const expected = { signedIn: true, kind: 'student', isSelf: false, canSeeParentView: false,
    accountName: 'הורה בדיקה אלפא', defaultStudent: 'synthetic-student-gamma',
    students: [{ code: 'synthetic-student-gamma', name: 'תלמידת בדיקה גמא', emoji: '🧪' }] };
  if (family.status !== 200 || family.headers.get('cache-control') !== 'no-store'
    || JSON.stringify(body) !== JSON.stringify(expected)) throw new Error('[synthetic] family scope was not exactly the single fictional student');
  for (const path of ['/api/portal/synthetic-student-gamma?kind=parent',
    '/api/portal/synthetic-sibling-sentinel', '/api/payments?student=synthetic-student-gamma']) {
    const denied = await get(path);
    if (denied.status !== 401) { await denied.body?.cancel(); throw new Error('[synthetic] parent/sibling/payment scope not denied'); }
    await denied.body?.cancel();
  }
}

export function assertRedeem(response, body) {
  if (response.status !== 200 || response.headers.get('cache-control') !== 'no-store'
    || JSON.stringify(body) !== JSON.stringify({ ok: true, destination: '/app/student?s=synthetic-student-gamma' })) {
    throw new Error('[synthetic] redeem did not return exact no-store student success');
  }
}
export function assertReplay(response, body) {
  if (response.status !== 401 || response.headers.get('cache-control') !== 'no-store'
    || response.headers.get('set-cookie') || JSON.stringify(body) !== JSON.stringify({
      error: 'הקישור כבר לא תקף. אפשר לבקש קישור אישי חדש — בלי לחכות למורה.',
    })) throw new Error('[synthetic] replay did not return generic invalid denial without session/destination');
}
