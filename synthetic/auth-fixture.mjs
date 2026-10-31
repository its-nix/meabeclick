import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { verifySyntheticDatabase } from './database-policy.mjs';
import { replaceSyntheticDatabase } from './database-seed.mjs';
import { seedSyntheticPortal, verifySyntheticPortal } from './portal-fixture.mjs';

// Only the production issuer generates secrets. Never emit the join code.
export function issueSyntheticAuth(db, issueStudentCredentials) {
  verifySyntheticDatabase(db); // both access tables MUST start empty
  const issued = issueStudentCredentials(92001, { type: 'system' });
  const token = issued.link.split('#')[1];
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const credentials = db.prepare('SELECT * FROM access_credentials ORDER BY id').all();
  assert.equal(credentials.length, 2);
  assert.deepEqual(credentials.map(r => r.channel).sort(), ['join', 'link']);
  for (const row of credentials) {
    assert.equal(row.scope_kind, 'student');
    assert.equal(row.scope_id, 92001);
    assert.equal(row.issuer_type, 'system');
    assert.equal(row.issuer_id, null);
    assert.equal(row.created_at, new Date(issued.createdAt).toISOString());
    assert.equal(row.expires_at, new Date(issued.expiresAt).toISOString());
    assert.equal(issued.expiresAt - issued.createdAt, 15 * 60_000);
    assert.equal(row.consumed_at, null);
    assert.equal(row.revoked_at, null);
    assert.equal(row.audit_reason, 'issued');
    const raw = row.channel === 'link' ? token : issued.joinCode.replaceAll('-', '');
    assert.equal(row.secret_hash, createHash('sha256').update(`${row.channel}:${raw}`).digest('hex'));
  }
  const fixture = {
    token, credentials, id: issued.id, expiresAt: issued.expiresAt,
    auditStart: Number(db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'access_credential_audit'").get()?.seq ?? 0),
  };
  verifySyntheticAuth(db, fixture, 'issued');
  return fixture;
}

export function verifySyntheticAuth(db, fixture, phase) {
  assert.ok(['issued', 'consumed', 'replayed'].includes(phase), 'unknown lifecycle phase');
  assert.ok(Date.now() < fixture.expiresAt, 'synthetic link expired; fail closed');
  const audits = db.prepare('SELECT * FROM access_credential_audit ORDER BY id').all();
  const outcomes = phase === 'issued' ? [] : phase === 'consumed' ? ['consumed'] : ['consumed', 'replayed'];
  assert.equal(audits.length, outcomes.length, 'access_credential_audit exact count');
  for (const [index, outcome] of outcomes.entries()) {
    const at = audits[index].at;
    assert.ok(Number.isFinite(Date.parse(at)) && Date.parse(at) >= Date.parse(fixture.credentials[0].created_at)
      && Date.parse(at) < fixture.expiresAt, 'audit timestamp out of issuance window');
    assert.deepEqual({ ...audits[index] }, {
      id: fixture.auditStart + index + 1, credential_id: fixture.id, outcome, at,
    }, 'access_credential_audit exact scope/outcome');
  }
  if (phase !== 'issued') {
    if (!fixture.consumedAt) fixture.consumedAt = audits[0].at;
    assert.equal(audits[0].at, fixture.consumedAt, 'consumption changed on replay');
  }
  const expected = fixture.credentials.map(row => row.id === fixture.id && phase !== 'issued'
    ? { ...row, consumed_at: fixture.consumedAt, audit_reason: 'consumed' } : row);
  verifySyntheticDatabase(db, { access_credentials: expected, access_credential_audit: audits });
}

// Private pipe protocol: caller captures stdout, never a terminal/log/file.
// No network endpoint, auth bypass, deterministic secret or production path.
async function serve() {
  if (process.env.SYNTHETIC_TEST_MODE !== '1' || process.env.DB_PATH !== '/synthetic-data/synthetic.db'
    || readFileSync(process.env.SYNTHETIC_DATA_MARKER || '/synthetic-data/.meabeclick-synthetic-volume', 'utf8') !== 'meabeclick-synthetic-volume-v1\n'
    || process.stdout.isTTY) throw new Error('synthetic auth handoff refused');
  const { handle } = await import('../src/lib/server/db.ts');
  const { issueStudentCredentials } = await import('../src/lib/server/access-credentials.ts');
  const db = handle();
  const timer = setTimeout(() => process.exit(1), 90_000);
  try {
    // Repeat the exact baseline twice, including clearing prior consumed/audit rows.
    for (let i = 0; i < 2; i++) {
      replaceSyntheticDatabase(db);
      seedSyntheticPortal('/synthetic-data/portal');
      verifySyntheticPortal('/synthetic-data/portal');
      verifySyntheticDatabase(db);
    }
    const fixture = issueSyntheticAuth(db, issueStudentCredentials);
    process.stdout.write(JSON.stringify({ token: fixture.token }) + '\n');
    let next = 'consumed';
    for await (const phase of createInterface({ input: process.stdin })) {
      assert.equal(phase, next, 'unexpected fixture protocol phase');
      verifySyntheticAuth(db, fixture, phase);
      verifySyntheticPortal('/synthetic-data/portal');
      process.stdout.write(JSON.stringify({ verified: phase }) + '\n');
      if (phase === 'replayed') break;
      next = 'replayed';
    }
  } finally { clearTimeout(timer); db.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await serve().catch(() => { console.error('[synthetic] auth fixture failed (details suppressed to protect handoff)'); process.exitCode = 1; });
}
