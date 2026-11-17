/** Validated copies of Drive game files, written only when the Sheet approves a material. */
export const sql = `
CREATE TABLE native_games (
 id INTEGER PRIMARY KEY,
 material_id TEXT NOT NULL,
 release_id TEXT NOT NULL,
 student_id INTEGER NOT NULL REFERENCES students_v2(id),
 booking_id INTEGER REFERENCES bookings_v2(id),
 game_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK (kind IN ('region','axis','quiz')),
 content_json TEXT NOT NULL,
 source_file_id TEXT NOT NULL,
 source_revision TEXT NOT NULL,
 content_sha256 TEXT NOT NULL,
 approved_at TEXT NOT NULL,
 UNIQUE(material_id, release_id, game_id)
);
CREATE INDEX native_games_student ON native_games(student_id, booking_id);
`;
