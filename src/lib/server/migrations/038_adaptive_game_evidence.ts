/** Nullable evidence preserves historical scores. Practice evidence never advances a learning plan. */
export const sql = `
ALTER TABLE results_v2 ADD COLUMN question_evidence TEXT;
ALTER TABLE results ADD COLUMN question_evidence TEXT;
ALTER TABLE results ADD COLUMN hints INTEGER;
`;
