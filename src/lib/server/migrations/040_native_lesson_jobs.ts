/** Durable native drafts; no student release is implied by a review state. */
export const sql = `
CREATE TABLE native_lesson_jobs (
 id INTEGER PRIMARY KEY,
 booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings_v2(id),
 student_id INTEGER NOT NULL REFERENCES students_v2(id),
 state TEXT NOT NULL CHECK (state IN ('queued','preparing','needs-preparation','review','failed','cancelled')),
 snapshot TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 lease_until TEXT,
 retry_at TEXT,
 error_code TEXT,
 reason TEXT,
 bundle TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX native_lesson_jobs_pending ON native_lesson_jobs(state, retry_at, lease_until);
CREATE TRIGGER cancel_native_lesson_job AFTER UPDATE OF status ON bookings_v2
WHEN NEW.status <> 'confirmed'
BEGIN
 UPDATE native_lesson_jobs SET state='cancelled', lease_until=NULL, retry_at=NULL,
 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE booking_id=NEW.id;
END;
`;
