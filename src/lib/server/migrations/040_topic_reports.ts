/** Immutable, tutor-only coverage and fail-closed practice release provenance. */
export const sql = `
ALTER TABLE lesson_reports ADD COLUMN filing_revision INTEGER NOT NULL DEFAULT 0;
CREATE TABLE lesson_report_revisions (
 id INTEGER PRIMARY KEY, report_id INTEGER NOT NULL REFERENCES lesson_reports(id),
 revision INTEGER NOT NULL, source TEXT NOT NULL CHECK(source IN ('manual','material')),
 snapshot_json TEXT, topics_json TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(report_id,revision)
);
CREATE TABLE lesson_report_assessments (
 id INTEGER PRIMARY KEY, revision_id INTEGER NOT NULL REFERENCES lesson_report_revisions(id),
 passed INTEGER NOT NULL, assessment_json TEXT NOT NULL, created_at TEXT NOT NULL
);
ALTER TABLE homework ADD COLUMN withheld_report_revision INTEGER REFERENCES lesson_report_revisions(id);
ALTER TABLE homework ADD COLUMN topic_provenance TEXT;
CREATE INDEX report_revision_latest ON lesson_report_revisions(report_id,revision DESC);
`;
