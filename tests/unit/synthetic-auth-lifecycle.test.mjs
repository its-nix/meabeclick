import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('production-issued synthetic link lifecycle is exact, replay-safe and resets twice', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    const { handle } = await import('./src/lib/server/db.ts');
    const { issueStudentCredentials, consumeLinkCredential } = await import('./src/lib/server/access-credentials.ts');
    const { replaceSyntheticDatabase } = await import('./synthetic/database-seed.mjs');
    const { verifySyntheticDatabase } = await import('./synthetic/database-policy.mjs');
    const { issueSyntheticAuth, verifySyntheticAuth } = await import('./synthetic/auth-fixture.mjs');
    const db = handle();
    try {
      for (let run = 0; run < 2; run++) {
        replaceSyntheticDatabase(db);
        verifySyntheticDatabase(db);
        const fixture = issueSyntheticAuth(db, issueStudentCredentials);
        assert.match(fixture.token, /^[A-Za-z0-9_-]{43}$/);
        assert.equal(JSON.stringify(db.prepare('SELECT * FROM access_credentials').all()).includes(fixture.token), false);
        verifySyntheticAuth(db, fixture, 'issued');
        const expiresAt = fixture.expiresAt;
        fixture.expiresAt = Date.now() - 1;
        assert.throws(() => verifySyntheticAuth(db, fixture, 'issued'), /expired/);
        fixture.expiresAt = expiresAt;
        assert.deepEqual(consumeLinkCredential(fixture.token), { kind: 'student', id: 92001 });
        verifySyntheticAuth(db, fixture, 'consumed');
        assert.equal(consumeLinkCredential(fixture.token), null);
        verifySyntheticAuth(db, fixture, 'replayed');
        db.exec('CREATE TABLE unexpected_synthetic (id INTEGER)');
        assert.throws(() => verifySyntheticAuth(db, fixture, 'replayed'), /table inventory/);
        db.exec('DROP TABLE unexpected_synthetic');
        db.exec('DROP TABLE marketing_events');
        assert.throws(() => verifySyntheticAuth(db, fixture, 'replayed'), /table inventory/);
        db.exec('CREATE TABLE marketing_events (id INTEGER)');
        db.exec('INSERT INTO marketing_events VALUES (123)');
        assert.throws(() => verifySyntheticAuth(db, fixture, 'replayed'), /marketing_events/);
        db.exec('DELETE FROM marketing_events');
        db.exec("UPDATE access_credentials SET issuer_type = 'admin' WHERE channel = 'join'");
        assert.throws(() => verifySyntheticAuth(db, fixture, 'replayed'), /access_credentials/);
      }
      replaceSyntheticDatabase(db);
      verifySyntheticDatabase(db);
    } finally { db.close(); }
  `], { env: { PATH: process.env.PATH, DB_PATH: ':memory:' }, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
});
