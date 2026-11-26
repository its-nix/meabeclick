#!/usr/bin/env bash
set -euo pipefail

image=${1:?Usage: smoke-release-image.sh IMAGE}
# No host volumes, credentials, listening ports, or outbound network.
container=$(docker run --detach --pull never --network none --read-only \
  --tmpfs /app/data:rw,nosuid,nodev,size=64m,uid=1000,gid=1000,mode=0700 \
  --env HOST=127.0.0.1 --env PORT=3000 \
  --env SITE_URL=http://127.0.0.1:3000 --env ORIGIN=http://127.0.0.1:3000 \
  --env PROTOCOL_HEADER=x-forwarded-proto \
  --env DATA_DIR=/app/data --env PORTAL_DIR=/app/data \
  --env CODEX_HOME=/app/data/ci-codex \
  --env ADMIN_PASSWORD=ci-synthetic-tutor --env SESSION_SECRET=ci-synthetic-session \
  --env GOOGLE_LOGIN_CLIENT_ID=ci-synthetic.apps.googleusercontent.com \
  --env GOOGLE_LOGIN_CLIENT_SECRET=ci-synthetic-secret \
  --env CALENDAR_ID=ci-calendar@example.test \
  --env CALENDAR_ICS_URLS=http://127.0.0.1:3001/empty.ics \
  --env NATIVE_LESSON_AUTHORING_ENABLED=false \
  "$image")

cleanup() {
  local status=$?
  if [[ "$status" != 0 ]]; then docker logs "$container" >&2 || true; fi
  docker rm --force --volumes "$container" >/dev/null || true
}
trap cleanup EXIT

# Executes in the container so the application can stay on an isolated loopback.
docker exec -i "$container" node --input-type=module - <<'JS'
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';

const origin = 'http://127.0.0.1:3000';
const request = (path, options = {}) => fetch(new URL(path, origin), {
  redirect: 'manual', signal: AbortSignal.timeout(5000), ...options,
});
const post = (path, body, cookie = '') => request(path, {
  method: 'POST', headers: { 'content-type': 'application/json', cookie, origin },
  body: JSON.stringify(body),
});
async function waitFor(check, label) {
  const deadline = Date.now() + 25_000;
  let lastError;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch (error) { lastError = error; }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${label}`, { cause: lastError });
}

const calendar = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/calendar' });
  res.end('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n');
});
await new Promise(resolve => calendar.listen(3001, '127.0.0.1', resolve));
try {
  await waitFor(async () => (await request('/api/me')).ok, 'the packaged app to start');
  mkdirSync(process.env.CODEX_HOME, { recursive: true });
  assert.match(execFileSync('codex', ['--version'], { encoding: 'utf8', timeout: 10_000 }), /codex/);
  assert.equal((await request('/booking')).status, 200, 'the public booking page renders');

  const login = await post('/api/login', { password: 'ci-synthetic-tutor' });
  assert.equal(login.status, 200, 'the tutor can sign in');
  const cookie = login.headers.get('set-cookie')?.split(';', 1)[0];
  assert.ok(cookie, 'tutor login returned a session cookie');
  assert.deepEqual(await (await request('/api/me', { headers: { cookie } })).json(), { authenticated: true });

  const start = new Date(Date.UTC(new Date().getUTCFullYear() + 1, 2, 15, 8));
  const end = new Date(start.getTime() + 45 * 60_000);
  const booking = await post('/api/book', {
    name: 'תלמיד בדיקת שחרור', subject: 'מתמטיקה', level: 'כיתה ט',
    email: 'release-smoke@example.test', phone: '0501234567',
    start: start.toISOString(), end: end.toISOString(), durationMin: 45,
  });
  assert.equal(booking.status, 200, 'the synthetic booking completes');
  const result = await booking.json();
  assert.equal(result.familyEmailed, false, 'the smoke sends no email');
  assert.equal(new URL(result.portal.link).origin, origin);
  assert.ok(new URL(result.portal.link).hash, 'booking returned a family handoff');

  const db = new DatabaseSync('/app/data/results.db', { readOnly: true });
  let job;
  try {
    job = db.prepare(`
      SELECT j.booking_id, j.student_id FROM native_lesson_jobs j
      JOIN students_v2 s ON s.id = j.student_id WHERE s.code = ?
    `).get(result.portal.code);
    assert.ok(job, 'the runtime created the native preparation job');
  } finally { db.close(); }

  const path = `/api/native-lessons/${job.booking_id}`;
  assert.equal((await request(path)).status, 401, 'draft API is private');
  const preparation = { request: 'תרגול פונקציות', priorKnowledge: 'מכיר גרפים בסיסיים' };
  assert.equal((await post(path, { studentId: job.student_id, preparation }, cookie)).status, 200);
  await waitFor(async () => {
    const response = await request(path, { headers: { cookie } });
    if (!response.ok) return false;
    const { job: prepared } = await response.json();
    return prepared.state === 'needs-preparation' && prepared.reason === 'authoring_disabled' && prepared.bundle === null;
  }, 'the private preparation worker to handle the booking');
  console.log('Release image smoke passed: boot, tutor session, synthetic booking, private preparation job');
} finally {
  await new Promise(resolve => calendar.close(resolve));
}
JS
