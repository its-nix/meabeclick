/**
 * One-time family entry credentials. Raw link secrets and join codes are
 * deliberately absent from this schema: only SHA-256 digests persist.
 */
export const sql = `
CREATE TABLE access_credentials (
  id           TEXT PRIMARY KEY,
  channel      TEXT NOT NULL CHECK (channel IN ('link', 'join')),
  scope_kind   TEXT NOT NULL CHECK (scope_kind IN ('account', 'student')),
  scope_id     INTEGER NOT NULL,
  secret_hash  TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  consumed_at  TEXT,
  revoked_at   TEXT,
  issuer_type  TEXT NOT NULL CHECK (issuer_type IN ('self_service', 'parent', 'admin', 'system')),
  issuer_id    INTEGER,
  audit_reason TEXT
);
CREATE INDEX idx_access_credentials_scope
  ON access_credentials(scope_kind, scope_id, consumed_at, revoked_at, expires_at);

CREATE TABLE access_credential_audit (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  credential_id TEXT,
  outcome       TEXT NOT NULL CHECK (outcome IN ('consumed', 'unknown', 'malformed', 'expired', 'replayed', 'revoked')),
  at            TEXT NOT NULL,
  FOREIGN KEY (credential_id) REFERENCES access_credentials(id) ON DELETE SET NULL
);
`;
