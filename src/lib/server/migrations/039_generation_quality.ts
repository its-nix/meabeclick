/** Private snapshot evidence is separate from customer material and public failure text. */
export const sql = `
CREATE TABLE lesson_generation_quality (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_slug TEXT NOT NULL REFERENCES lessons(slug),
  at TEXT NOT NULL,
  report TEXT NOT NULL
);
CREATE INDEX idx_generation_quality_slug ON lesson_generation_quality(lesson_slug, id);
`;
