/**
 * Retires join codes. The login page no longer takes a code, so the
 * `join_codes` table, the `join` credentials in `access_credentials`, and
 * the `invitation_id` column that paired a link with its code have no reader.
 */
export const sql = `
DELETE FROM access_credentials WHERE channel = 'join';
DROP INDEX idx_access_invitation;
ALTER TABLE access_credentials DROP COLUMN invitation_id;
DROP TABLE join_codes;
`;
