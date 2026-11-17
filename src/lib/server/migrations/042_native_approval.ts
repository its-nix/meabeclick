/** Mirror of the Sheet's approval ticks. The Sheet is the source of truth; the sync fills these. */
export const sql = `
ALTER TABLE native_lesson_jobs ADD COLUMN approved_release_id TEXT;
ALTER TABLE native_lesson_jobs ADD COLUMN approved_sheet_revision TEXT;
ALTER TABLE native_lesson_jobs ADD COLUMN approved_at TEXT;
`;
