/**
 * Short-lived, single-use credentials for passwordless family entry.
 *
 * Raw secrets exist only in the issuance response. SQLite stores hashes,
 * redemption is one conditional UPDATE, and reissue revokes older unused
 * credentials for exactly the same account/student scope.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { handle, inTransaction } from './db.ts';
import type { FamilyIdentity, FamilyKind } from './family-auth.ts';

const TTL_MS = 15 * 60 * 1000;
const INVITATION_TTL_MS = 48 * 60 * 60 * 1000;
const MAX_AUDIT_ROWS = 10_000;

export type CredentialIssuer = {
  type: 'self_service' | 'parent' | 'admin' | 'system';
  id?: number | null;
};

type IssuedLink = {
  id: string;
  link: string;
  createdAt: number;
  expiresAt: number;
};

function digest(secret: string): string {
  return createHash('sha256').update(`link:${secret}`).digest('hex');
}

function insertCredential(
  scopeKind: FamilyKind,
  scopeId: number,
  secret: string,
  issuer: CredentialIssuer,
  createdAt: string,
  expiresAt: string,
): string {
  const id = randomUUID();
  handle().prepare(`
    INSERT INTO access_credentials (
      id, channel, scope_kind, scope_id, secret_hash, created_at, expires_at,
      consumed_at, revoked_at, issuer_type, issuer_id, audit_reason
    ) VALUES (?, 'link', ?, ?, ?, ?, ?, NULL, NULL, ?, ?, 'issued')
  `).run(
    id, scopeKind, scopeId, digest(secret), createdAt, expiresAt,
    issuer.type, issuer.id ?? null,
  );
  return id;
}

function revokeUnused(scopeKind: FamilyKind, scopeId: number, now: string): void {
  handle().prepare(`
    UPDATE access_credentials
    SET revoked_at = ?, audit_reason = 'superseded'
    WHERE scope_kind = ? AND scope_id = ?
      AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?
  `).run(now, scopeKind, scopeId, now);
}

function linkFor(secret: string): string {
  const site = process.env.SITE_URL?.replace(/\/+$/, '') ?? '';
  return `${site}/enter#${secret}`;
}

type AuditOutcome = 'consumed' | 'unknown' | 'malformed' | 'expired' | 'replayed' | 'revoked';

function recordAudit(credentialId: string | null, outcome: AuditOutcome, at: string): void {
  const inserted = handle().prepare(`
    INSERT INTO access_credential_audit (credential_id, outcome, at) VALUES (?, ?, ?)
  `).run(credentialId, outcome, at);
  const newestId = Number(inserted.lastInsertRowid);
  if (newestId > MAX_AUDIT_ROWS) {
    handle().prepare(`DELETE FROM access_credential_audit WHERE id <= ?`)
      .run(newestId - MAX_AUDIT_ROWS);
  }
}

export function issueAccountCredential(accountId: number, issuer: CredentialIssuer): IssuedLink {
  return inTransaction(() => {
    const createdAt = Date.now();
    const createdIso = new Date(createdAt).toISOString();
    const expiresAt = createdAt + TTL_MS;
    const secret = randomBytes(32).toString('base64url');
    revokeUnused('account', accountId, createdIso);
    const id = insertCredential('account', accountId, secret, issuer, createdIso, new Date(expiresAt).toISOString());
    return { id, link: linkFor(secret), createdAt, expiresAt };
  });
}

export function issueStudentCredentials(studentId: number, issuer: CredentialIssuer): IssuedLink {
  return inTransaction(() => {
    const createdAt = Date.now();
    const createdIso = new Date(createdAt).toISOString();
    const expiresAt = createdAt + INVITATION_TTL_MS;
    const secret = randomBytes(32).toString('base64url');
    revokeUnused('student', studentId, createdIso);
    const id = insertCredential('student', studentId, secret, issuer, createdIso, new Date(expiresAt).toISOString());
    return { id, link: linkFor(secret), createdAt, expiresAt };
  });
}

export function consumeLinkCredential(rawSecret: unknown): FamilyIdentity | null {
  const secret = String(rawSecret ?? '');
  const now = new Date().toISOString();
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) {
    recordAudit(null, 'malformed', now);
    return null;
  }
  return inTransaction(() => {
    const row = handle().prepare(`
      SELECT id, scope_kind, scope_id, expires_at, consumed_at, revoked_at FROM access_credentials
      WHERE channel = 'link' AND secret_hash = ?
    `).get(digest(secret)) as {
      id: string; scope_kind: FamilyKind; scope_id: number;
      expires_at: string; consumed_at: string | null; revoked_at: string | null;
    } | undefined;
    if (!row) {
      recordAudit(null, 'unknown', now);
      return null;
    }
    const updated = handle().prepare(`
      UPDATE access_credentials
      SET consumed_at = ?, audit_reason = 'consumed'
      WHERE id = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?
    `).run(now, row.id, now);
    const outcome = updated.changes === 1
      ? 'consumed'
      : row.revoked_at ? 'revoked' : row.consumed_at ? 'replayed' : row.expires_at <= now ? 'expired' : 'unknown';
    recordAudit(row.id, outcome, now);
    return updated.changes === 1 ? { kind: row.scope_kind, id: row.scope_id } : null;
  });
}

/** Read only: neither a chat preview nor starting Google consumes the invitation. */
export function peekLinkCredential(secret: unknown): { credentialId: string; identity: FamilyIdentity } | null {
  if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
  const row = handle().prepare(`SELECT id, scope_kind, scope_id FROM access_credentials
    WHERE channel = 'link' AND secret_hash = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?`)
    .get(digest(secret), new Date().toISOString()) as { id: string; scope_kind: FamilyKind; scope_id: number } | undefined;
  return row ? { credentialId: row.id, identity: { kind: row.scope_kind, id: row.scope_id } } : null;
}

/** Server-only handle captured before OAuth; recheck expiry/revocation at completion. */
export function consumeCredentialId(id: string): FamilyIdentity | null {
  return inTransaction(() => {
    const now = new Date().toISOString();
    const row = handle().prepare(`SELECT scope_kind, scope_id FROM access_credentials WHERE id = ? AND channel = 'link'`)
      .get(id) as { scope_kind: FamilyKind; scope_id: number } | undefined;
    if (!row) return null;
    const result = handle().prepare(`UPDATE access_credentials SET consumed_at = ?, audit_reason = 'consumed'
      WHERE id = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?`).run(now, id, now);
    if (result.changes !== 1) return null;
    recordAudit(id, 'consumed', now);
    return { kind: row.scope_kind, id: row.scope_id };
  });
}
