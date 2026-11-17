/**
 * Drops the per-scene progress log of the removed lesson-deck sync
 * (`learning_progress`, `learning_events`). Nothing writes them any more;
 * practice evidence is `native_results`. No data is carried over.
 */
export const sql = `
DROP TABLE IF EXISTS learning_events;
DROP TABLE IF EXISTS learning_progress;
`;
