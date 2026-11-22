/** The difficulty level (1-3) of the round as played, copied from the approved game at record time. NULL for historical games and open rounds without a level. */
export const sql = `
ALTER TABLE native_results ADD COLUMN difficulty INTEGER CHECK (difficulty IS NULL OR difficulty BETWEEN 1 AND 3);
`;
