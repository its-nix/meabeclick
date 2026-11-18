/**
 * Removes the legacy lesson generator's operational state. Lessons are
 * prepared only through the Drive-native pipeline (`native_lesson_jobs`).
 *
 * Dropped:
 *  - `library_items`, `library_uses`, `lesson_engines`: the prepared-library
 *    cache (which master lesson serves which skill, which booking lessons
 *    were copied from one, which were imported from another engine).
 *  - `drive_items`: Drive file ids and sync baselines of the removed
 *    per-student lesson-document sync.
 *  - `learning_retired_lessons`: the archived slugs, which only the removed
 *    library excluded from selection. The archive receipt keeps them
 *    (`learning_archive.slugs`).
 *
 * Kept, because they are history the native pipeline or the Drive archive
 * still reads: `lessons`, `lessons_v2`, `lesson_materials` (published plan
 * and slides of earlier lessons), `learning_assignments` (which earlier
 * practice each student was given; the native preparation brief reads it so
 * a source question is not repeated), `lesson_report_notes.teaching_coverage`,
 * `homework.booking_id` / `held_until`, `learning_archive` (the cutover
 * receipt) and `engine_status` (the engine alert on the dashboard).
 *
 * The drops are IF EXISTS because migrations may be applied out of order.
 */
export const sql = `
DROP TABLE IF EXISTS library_uses;
DROP TABLE IF EXISTS library_items;
DROP TABLE IF EXISTS lesson_engines;
DROP TABLE IF EXISTS drive_items;
DROP TABLE IF EXISTS learning_retired_lessons;
`;
