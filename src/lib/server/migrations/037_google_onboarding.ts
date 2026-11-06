/** Google subjects are credentials; family/student IDs remain authorization. */
export const sql = `
CREATE TABLE google_identities (
  subject TEXT PRIMARY KEY,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('account', 'student')),
  scope_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (scope_kind, scope_id)
);
CREATE TABLE google_auth_flows (
  state_hash TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  nonce TEXT NOT NULL,
  verifier TEXT NOT NULL,
  intent TEXT NOT NULL CHECK (intent IN ('login', 'link', 'invite', 'tutor')),
  scope_kind TEXT,
  scope_id INTEGER,
  credential_id TEXT,
  next_path TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  claimed_at TEXT,
  profile TEXT
);
ALTER TABLE access_credentials ADD COLUMN invitation_id TEXT;
CREATE INDEX idx_access_invitation ON access_credentials(invitation_id);
`;
