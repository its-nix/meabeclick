/** Preparation is available before class; homework follows the filed report. */
export const sql = `
ALTER TABLE learning_assignments ADD COLUMN booking_id INTEGER REFERENCES bookings_v2(id);
ALTER TABLE learning_assignments ADD COLUMN node_id INTEGER REFERENCES plan_nodes(id);
ALTER TABLE learning_assignments ADD COLUMN held_until TEXT;
ALTER TABLE learning_assignments ADD COLUMN practice_state TEXT NOT NULL DEFAULT 'assigned'
  CHECK (practice_state IN ('held', 'assigned', 'withdrawn'));
ALTER TABLE learning_assignments ADD COLUMN practice_material_slug TEXT;
CREATE INDEX learning_assignments_booking ON learning_assignments(booking_id);
`;
