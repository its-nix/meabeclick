/** Help used on a round is persisted with its results, so a restart cannot turn a revealed solution into independent evidence. */
export const sql = `
ALTER TABLE native_results ADD COLUMN hints INTEGER NOT NULL DEFAULT 0;
ALTER TABLE native_results ADD COLUMN revealed INTEGER NOT NULL DEFAULT 0;
CREATE INDEX native_results_round ON native_results(student_id, booking_id, game_id, round_id, id);

/** Grants whose revoke failed after the Doc was shared with a newer address; retried until they succeed, so no grant goes untracked. */
CREATE TABLE native_homework_revocations (
 material_id TEXT NOT NULL,
 email TEXT NOT NULL,
 doc_id TEXT NOT NULL,
 code TEXT,
 updated_at TEXT NOT NULL,
 PRIMARY KEY (material_id, email)
);
`;
