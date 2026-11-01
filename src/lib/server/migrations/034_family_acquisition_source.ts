/** Family defaults are self-reported sources, not inferred attribution.
 * Historical booking snapshots and free text stay exactly as recorded. */
export const sql = `
CREATE TABLE family_acquisition_sources (
  account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('friend', 'google', 'instagram', 'school', 'other', 'unknown')),
  updated_at TEXT NOT NULL
);

INSERT INTO family_acquisition_sources (account_id, source, updated_at)
SELECT account_id, heard_from, at FROM (
  SELECT s.account_id, b.heard_from, b.at,
    ROW_NUMBER() OVER (PARTITION BY s.account_id ORDER BY datetime(b.at) DESC, b.id DESC) AS position
  FROM bookings_v2 b JOIN students_v2 s ON s.id = b.student_id
  WHERE b.status != 'cancelled'
    AND b.heard_from IN ('friend', 'google', 'instagram', 'school', 'other')
) WHERE position = 1;
`;
