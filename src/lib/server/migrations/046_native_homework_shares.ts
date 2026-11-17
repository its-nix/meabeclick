/** Which approved homework Docs the site has shared with which student Google account, so withdrawal can revoke exactly that grant. */
export const sql = `
CREATE TABLE native_homework_shares (
 material_id TEXT PRIMARY KEY,
 student_id INTEGER NOT NULL REFERENCES students_v2(id),
 doc_id TEXT NOT NULL,
 email TEXT,
 status TEXT NOT NULL CHECK (status IN ('shared','no_google_email','failed','revoked')),
 code TEXT,
 updated_at TEXT NOT NULL
);
`;
