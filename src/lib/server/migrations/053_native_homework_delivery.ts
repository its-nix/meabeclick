export const sql = `
CREATE TABLE native_homework_delivery (
 material_id TEXT PRIMARY KEY,
 student_id INTEGER NOT NULL REFERENCES students_v2(id),
 doc_id TEXT NOT NULL,
 resource_key TEXT,
 ready INTEGER NOT NULL DEFAULT 0 CHECK (ready IN (0,1)),
 access_mode TEXT NOT NULL CHECK (access_mode IN ('named','link'))
);
CREATE TABLE native_homework_grants (
 material_id TEXT NOT NULL,
 doc_id TEXT NOT NULL,
 grantee TEXT NOT NULL,
 role TEXT CHECK (role IN ('reader','writer')),
 permission_id TEXT,
 PRIMARY KEY(material_id,doc_id,grantee)
);
INSERT OR IGNORE INTO native_homework_grants(material_id,doc_id,grantee) SELECT material_id,doc_id,lower(email) FROM native_homework_shares WHERE status='shared' AND email IS NOT NULL;
INSERT OR IGNORE INTO native_homework_grants(material_id,doc_id,grantee) SELECT material_id,doc_id,lower(email) FROM native_homework_revocations;
`;
