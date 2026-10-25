/**
 * Short-lived, single-use credentials for passwordless family entry.
 *
 * Raw secrets exist only in the issuance response. SQLite stores hashes,
 * redemption is one conditional UPDATE, and reissue revokes older unused
 * credentials for exactly the same account/student scope.
 */
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { handle, inTransaction } from './db.ts';
import type { FamilyIdentity, FamilyKind } from './family-auth.ts';

const TTL_MS = 15 * 60 * 1000;
const JOIN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const JOIN_LENGTH = 8;
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

export type IssuedStudentCredentials = IssuedLink & { joinCode: string };

function digest(channel: 'link' | 'join', secret: string): string {
  return createHash('sha256').update(`${channel}:${secret}`).digest('hex');
}

function normalizeJoinCode(input: unknown): string {
  return String(input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function generateJoinCode(): string {
  let value = '';
  for (let i = 0; i < JOIN_LENGTH; i++) value += JOIN_ALPHABET[randomInt(JOIN_ALPHABET.length)];
  return value;
}

function formatJoinCode(value: string): string {
  return `${value.slice(0, 4)}-${value.slice(4)}`;
}

function insertCredential(
  channel: 'link' | 'join',
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, 'issued')
  `).run(
    id, channel, scopeKind, scopeId, digest(channel, secret), createdAt, expiresAt,
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
    const id = insertCredential('link', 'account', accountId, secret, issuer, createdIso, new Date(expiresAt).toISOString());
    return { id, link: linkFor(secret), createdAt, expiresAt };
  });
}

export function issueStudentCredentials(studentId: number, issuer: CredentialIssuer): IssuedStudentCredentials {
  return inTransaction(() => {
    const createdAt = Date.now();
    const createdIso = new Date(createdAt).toISOString();
    const expiresAt = createdAt + TTL_MS;
    const expiresIso = new Date(expiresAt).toISOString();
    const linkSecret = randomBytes(32).toString('base64url');
    revokeUnused('student', studentId, createdIso);
    const id = insertCredential('link', 'student', studentId, linkSecret, issuer, createdIso, expiresIso);

    let joinCode = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      joinCode = generateJoinCode();
      try {
        insertCredential('join', 'student', studentId, joinCode, issuer, createdIso, expiresIso);
        break;
      } catch (error) {
        if (attempt === 4) throw error;
      }
    }
    return { id, link: linkFor(linkSecret), joinCode: formatJoinCode(joinCode), createdAt, expiresAt };
  });
}

function consume(channel: 'link' | 'join', rawSecret: unknown): FamilyIdentity | null {
  const secret = channel === 'join' ? normalizeJoinCode(rawSecret) : String(rawSecret ?? '');
  const now = new Date().toISOString();
  const malformed = channel === 'join'
    ? secret.length !== JOIN_LENGTH
    : !/^[A-Za-z0-9_-]{43}$/.test(secret);
  if (malformed) {
    recordAudit(null, 'malformed', now);
    return null;
  }
  return inTransaction(() => {
    const row = handle().prepare(`
      SELECT id, scope_kind, scope_id, expires_at, consumed_at, revoked_at FROM access_credentials
      WHERE channel = ? AND secret_hash = ?
    `).get(channel, digest(channel, secret)) as {
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

export const consumeLinkCredential = (secret: unknown): FamilyIdentity | null => consume('link', secret);
export const consumeJoinCredential = (code: unknown): FamilyIdentity | null => consume('join', code);
