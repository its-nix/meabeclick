import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let access;
let db;
let accountId;
let firstStudentId;
let siblingId;

before(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'access-credentials-'));
  process.env.DB_PATH = join(dir, 'test.db');
  process.env.SITE_URL = 'https://example.test';
  access = await import(`../../src/lib/server/access-credentials.ts?test=${Date.now()}`);
  ({ handle: db } = await import(`../../src/lib/server/db.ts?test=${Date.now()}`));

  db().prepare(`INSERT INTO accounts (name, credential, is_self, created_at, email) VALUES (?, ?, 0, ?, ?)`)
    .run('משפחה', 'legacy-unused', new Date().toISOString(), 'family@example.test');
  accountId = Number(db().prepare(`SELECT id FROM accounts`).get().id);
  const addStudent = db().prepare(`
    INSERT INTO students_v2 (code, name, emoji, account_id, progress, credential, created_at)
    VALUES (?, ?, '🎓', ?, 0, 'legacy-unused', ?)
  `);
  firstStudentId = Number(addStudent.run('first', 'ראשון', accountId, new Date().toISOString()).lastInsertRowid);
  siblingId = Number(addStudent.run('sibling', 'אחות', accountId, new Date().toISOString()).lastInsertRowid);
});

test('account credentials are 15-minute, hashed at rest, and one-time', () => {
  const issued = access.issueAccountCredential(accountId, { type: 'self_service', id: accountId });
  assert.match(issued.link, /^https:\/\/example\.test\/enter#[A-Za-z0-9_-]{40,}$/);
  assert.equal(issued.expiresAt - issued.createdAt, 15 * 60 * 1000);

  const token = issued.link.split('#')[1];
  const stored = db().prepare(`SELECT * FROM access_credentials WHERE id = ?`).get(issued.id);
  assert.ok(stored.secret_hash);
  assert.equal(stored.secret_hash.includes(token), false);
  assert.equal(JSON.stringify(stored).includes(token), false);

  assert.deepEqual(access.consumeLinkCredential(token), { kind: 'account', id: accountId });
  assert.equal(access.consumeLinkCredential(token), null, 'replay must fail');
  assert.deepEqual(
    db().prepare(`SELECT outcome FROM access_credential_audit WHERE credential_id = ? ORDER BY id`).all(issued.id).map(row => row.outcome),
    ['consumed', 'replayed'],
  );
});

test('expired links fail with the same null result without logging their secret', () => {
  const issued = access.issueAccountCredential(accountId, { type: 'self_service', id: accountId });
  const token = issued.link.split('#')[1];
  db().prepare(`UPDATE access_credentials SET expires_at = ? WHERE id = ?`)
    .run(new Date(Date.now() - 1).toISOString(), issued.id);

  const messages = [];
  const original = console.error;
  console.error = (...parts) => messages.push(parts.join(' '));
  try {
    assert.equal(access.consumeLinkCredential(token), null);
  } finally {
    console.error = original;
  }
  assert.equal(messages.join('\n').includes(token), false);
  assert.equal(db().prepare(`SELECT outcome FROM access_credential_audit WHERE credential_id = ?`).get(issued.id).outcome, 'expired');
});

test('student issuance atomically replaces its unused link and code but not a sibling', () => {
  const first = access.issueStudentCredentials(firstStudentId, { type: 'parent', id: accountId });
  const sibling = access.issueStudentCredentials(siblingId, { type: 'parent', id: accountId });
  const replacement = access.issueStudentCredentials(firstStudentId, { type: 'parent', id: accountId });

  assert.equal(access.consumeLinkCredential(first.link.split('#')[1]), null, 'old link is revoked');
  assert.equal(access.consumeJoinCredential(first.joinCode), null, 'old code is revoked');
  assert.deepEqual(access.consumeJoinCredential(replacement.joinCode), { kind: 'student', id: firstStudentId });
  assert.deepEqual(access.consumeLinkCredential(sibling.link.split('#')[1]), { kind: 'student', id: siblingId });
});

test('join codes accept lowercase, spaces, and display hyphen while remaining hashed', () => {
  const issued = access.issueStudentCredentials(firstStudentId, { type: 'parent', id: accountId });
  const typed = ` ${issued.joinCode.toLowerCase().replace('-', ' - ')} `;
  const rows = db().prepare(`SELECT secret_hash FROM access_credentials WHERE scope_kind = 'student' AND scope_id = ?`).all(firstStudentId);
  assert.ok(rows.every(row => !row.secret_hash.includes(issued.joinCode.replace('-', ''))));
  assert.deepEqual(access.consumeJoinCredential(typed), { kind: 'student', id: firstStudentId });
  assert.equal(access.consumeJoinCredential(typed), null);
});

test('simultaneous redemption has exactly one winner', async () => {
  const issued = access.issueAccountCredential(accountId, { type: 'self_service', id: accountId });
  const token = issued.link.split('#')[1];

  const results = await Promise.all([
    Promise.resolve().then(() => access.consumeLinkCredential(token)),
    Promise.resolve().then(() => access.consumeLinkCredential(token)),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.deepEqual(results.find(Boolean), { kind: 'account', id: accountId });
});

test('malformed credentials are rejected and audited without storing the input', () => {
  const malformed = 'short-secret';
  assert.equal(access.consumeLinkCredential(malformed), null);
  const row = db().prepare(`SELECT outcome FROM access_credential_audit ORDER BY id DESC LIMIT 1`).get();
  assert.equal(row.outcome, 'malformed');
  const stored = db().prepare(`SELECT group_concat(outcome || ':' || COALESCE(credential_id, '')) AS audit FROM access_credential_audit`).get();
  assert.equal(String(stored.audit).includes(malformed), false);
});

test('credential audit retention is bounded under sustained invalid traffic', () => {
  for (let attempt = 0; attempt < 10_050; attempt++) {
    assert.equal(access.consumeLinkCredential('short-secret'), null);
  }
  const count = Number(db().prepare(`SELECT COUNT(*) AS count FROM access_credential_audit`).get().count);
  assert.ok(count <= 10_000, `audit grew to ${count} rows`);
});
