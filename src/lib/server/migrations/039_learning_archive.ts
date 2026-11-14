export const sql = `
CREATE TABLE learning_archive (
 id INTEGER PRIMARY KEY CHECK (id=1),
 archive_id TEXT NOT NULL UNIQUE,
 fingerprint TEXT NOT NULL,
 slugs TEXT NOT NULL,
 receipt TEXT
);
CREATE TABLE learning_retired_lessons (
 slug TEXT PRIMARY KEY,
 archive_id TEXT NOT NULL REFERENCES learning_archive(archive_id)
);
`;
