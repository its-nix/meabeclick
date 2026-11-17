/** Runtime store for native game results; the Progress tab receives appended rows. */
export const sql = `
CREATE TABLE native_results (
 id INTEGER PRIMARY KEY,
 student_id INTEGER NOT NULL REFERENCES students_v2(id),
 booking_id INTEGER REFERENCES bookings_v2(id),
 game_id TEXT NOT NULL,
 round_id TEXT NOT NULL,
 skill_node_id TEXT,
 outcome TEXT NOT NULL CHECK (outcome IN ('correct','assisted','incorrect','awaiting-review')),
 attempts INTEGER NOT NULL DEFAULT 1,
 seconds INTEGER,
 at TEXT NOT NULL
);
CREATE INDEX native_results_student ON native_results(student_id, at);
`;
