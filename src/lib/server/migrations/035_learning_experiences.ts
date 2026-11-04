export const sql = `
CREATE TABLE learning_assignments (
  lesson_slug TEXT PRIMARY KEY REFERENCES lessons(slug),
  student_id INTEGER NOT NULL REFERENCES students_v2(id)
);
CREATE TABLE learning_progress (
  student_id INTEGER NOT NULL REFERENCES students_v2(id),
  lesson_slug TEXT NOT NULL REFERENCES lessons(slug),
  fingerprint TEXT NOT NULL,
  scene_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  hints INTEGER NOT NULL DEFAULT 0,
  solved INTEGER NOT NULL DEFAULT 0,
  visited INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(student_id, lesson_slug, fingerprint, scene_id)
);
CREATE TABLE learning_events (
  id TEXT PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students_v2(id),
  lesson_slug TEXT NOT NULL REFERENCES lessons(slug),
  fingerprint TEXT NOT NULL,
  scene_id TEXT NOT NULL,
  action TEXT NOT NULL,
  correct INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX learning_progress_student ON learning_progress(student_id, lesson_slug);
`;
