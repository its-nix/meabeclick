/**
 * Migration 032 — tutor-managed games attached to live generated lessons.
 *
 * `lessons` (not lessons_v2) is intentional: it is the table the generation
 * pipeline writes. Published bodies are immutable rows keyed by data_id;
 * editing an assignment only changes its draft body.
 */
export const sql = `
CREATE TABLE lesson_game_assignments (
  id                TEXT PRIMARY KEY,
  lesson_id         INTEGER NOT NULL REFERENCES lessons(id),
  student_id        INTEGER NOT NULL REFERENCES students_v2(id),
  template          TEXT NOT NULL,
  title             TEXT NOT NULL,
  position          INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  draft_body        TEXT NOT NULL,
  draft_revision    INTEGER NOT NULL DEFAULT 1,
  published_data_id TEXT,
  node_id           INTEGER REFERENCES plan_nodes(id),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  published_at      TEXT
);
CREATE INDEX idx_lesson_games_student ON lesson_game_assignments(student_id, status);
CREATE INDEX idx_lesson_games_lesson ON lesson_game_assignments(lesson_id, position);

CREATE TABLE lesson_game_revisions (
  data_id       TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES lesson_game_assignments(id),
  body          TEXT NOT NULL,
  published_at  TEXT NOT NULL
);
CREATE INDEX idx_lesson_game_revisions_assignment
  ON lesson_game_revisions(assignment_id, published_at DESC);
`;
