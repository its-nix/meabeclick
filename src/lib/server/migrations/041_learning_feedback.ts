/** Feedback is private editorial work. Acceptance never publishes student material. */
export const sql = `
CREATE TABLE learning_feedback_artifacts (
 file_id TEXT PRIMARY KEY,
 title TEXT NOT NULL,
 mime_type TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('slides','homework','sheet')),
 booking_id INTEGER REFERENCES bookings_v2(id),
 source_version TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'collecting',
 feedback_hash TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE learning_feedback_comments (
 file_id TEXT NOT NULL REFERENCES learning_feedback_artifacts(file_id),
 comment_id TEXT NOT NULL,
 content TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(file_id,comment_id)
);
CREATE TABLE learning_feedback_runs (
 id INTEGER PRIMARY KEY,
 file_id TEXT NOT NULL REFERENCES learning_feedback_artifacts(file_id),
 state TEXT NOT NULL CHECK(state IN ('queued','working','awaiting-review','applying','accepted','blocked','stale','rejected','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0,
 lease_until TEXT,
 source_revision TEXT NOT NULL,
 content_hash TEXT NOT NULL,
 source_version TEXT NOT NULL,
 feedback_hash TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 comments TEXT NOT NULL,
 proposal TEXT,
 validation TEXT,
 result TEXT,
 error_code TEXT,
 accepted_at TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(file_id,fingerprint)
);
CREATE INDEX learning_feedback_pending ON learning_feedback_runs(state,lease_until,id);
CREATE TABLE learning_feedback_policies (
 id INTEGER PRIMARY KEY,
 run_id INTEGER NOT NULL UNIQUE REFERENCES learning_feedback_runs(id),
 guidance TEXT NOT NULL,
 created_at TEXT NOT NULL,
 revoked_at TEXT
);
CREATE TABLE learning_feedback_notifications (
 run_id INTEGER NOT NULL REFERENCES learning_feedback_runs(id),
 phase TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','working','completed')),
 attempts INTEGER NOT NULL DEFAULT 0,
 lease_until TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(run_id,phase)
);
CREATE TRIGGER cancel_learning_feedback AFTER UPDATE OF status ON bookings_v2
WHEN NEW.status <> 'confirmed'
BEGIN
 UPDATE learning_feedback_artifacts SET state='cancelled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE booking_id=NEW.id;
 UPDATE learning_feedback_runs SET state='cancelled',lease_until=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE file_id IN (SELECT file_id FROM learning_feedback_artifacts WHERE booking_id=NEW.id)
 AND state IN ('queued','working','awaiting-review','applying','blocked');
END;
`;
