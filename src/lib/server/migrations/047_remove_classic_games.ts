/**
 * Removes the classic game system. Games are played only from the approved
 * Drive-native copies (`native_games`), and their results live in
 * `native_results`; nothing reads or writes these any more.
 *
 * Dropped: the classic play log (`results_v2`, and `results` for plays that
 * could not be attributed to a student), the link from a classic game to a
 * plan skill (`game_skills`), the tutor-managed lesson games and their
 * published revisions (`lesson_game_revisions` before the table it points
 * at), and the catalogue example exercises (`game_filler`).
 *
 * `homework.template` and `homework.data_id` named the classic game a task
 * was backed by; homework is a Google Doc now, so both columns go.
 * No data is carried over: nothing has real users yet. The drops are
 * IF EXISTS because migrations may be applied out of order.
 */
export const sql = `
DROP TABLE IF EXISTS lesson_game_revisions;
DROP TABLE IF EXISTS lesson_game_assignments;
DROP TABLE IF EXISTS game_skills;
DROP TABLE IF EXISTS game_filler;
DROP TABLE IF EXISTS results_v2;
DROP TABLE IF EXISTS results;
ALTER TABLE homework DROP COLUMN template;
ALTER TABLE homework DROP COLUMN data_id;
`;
