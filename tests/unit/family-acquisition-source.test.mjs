import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from '../../src/lib/server/migrations/list.ts';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'family-source-')), 'results.db');
const { handle } = await import('../../src/lib/server/db.ts');
const A = await import('../../src/lib/server/acquisition-source.ts');
const db = handle();
db.exec(`INSERT INTO accounts (id, name, credential, created_at) VALUES (1, 'בדיקה', 'unused', '2026-01-01')`);

test('omitted answers initialize unknown but cannot overwrite a later correction', () => {
  assert.equal(A.familyAcquisitionSource(1), null);
  A.recordFamilyAcquisitionSource(1, 'unknown', false);
  assert.equal(A.familyAcquisitionSource(1), 'unknown');
  A.recordFamilyAcquisitionSource(1, 'google', true);
  A.recordFamilyAcquisitionSource(1, 'unknown', false);
  assert.equal(A.familyAcquisitionSource(1), 'google');
  assert.throws(() => A.recordFamilyAcquisitionSource(1, 'invalid', true));
  assert.equal(A.familyAcquisitionSource(1), 'google');
});

test('migration reuses recorded answers, ignores cancelled/unknown history, and never rewrites snapshots', () => {
  const legacy = new DatabaseSync(':memory:');
  for (const m of MIGRATIONS.filter(m => m.version < 34)) legacy.exec(m.sql);
  legacy.exec(`
    INSERT INTO accounts (id, name, credential, created_at) VALUES
      (1, 'משפחה א', 'unused', '2026-01-01'), (2, 'משפחה ב', 'unused', '2026-01-01');
    INSERT INTO students_v2 (id, code, name, account_id, credential, created_at) VALUES
      (1, 'one', 'א', 1, 'unused', '2026-01-01'), (2, 'two', 'ב', 2, 'unused', '2026-01-01');
    INSERT INTO bookings_v2 (student_id, start, "end", at, status, heard_from, heard_from_detail) VALUES
      (1, '2026-01-01', '2026-01-02', '2026-01-01', 'confirmed', 'other', 'historic detail'),
      (1, '2026-01-02', '2026-01-03', '2026-01-02', 'confirmed', 'google', NULL),
      (1, '2026-01-03', '2026-01-04', '2026-01-03', 'confirmed', NULL, NULL),
      (1, '2026-01-04', '2026-01-05', '2026-01-04', 'cancelled', 'school', NULL),
      (2, '2026-01-01', '2026-01-02', '2026-01-01', 'confirmed', NULL, NULL);
  `);
  const before = legacy.prepare('SELECT * FROM bookings_v2 ORDER BY id').all();
  legacy.exec(MIGRATIONS.find(m => m.version === 34).sql);
  assert.deepEqual(legacy.prepare('SELECT * FROM bookings_v2 ORDER BY id').all(), before);
  const defaults = legacy.prepare('SELECT account_id, source FROM family_acquisition_sources').all();
  assert.deepEqual(defaults.map(r => ({ ...r })), [{ account_id: 1, source: 'google' }]);
  assert.throws(() => legacy.exec(`INSERT INTO family_acquisition_sources VALUES (2, 'inferred', '2026-01-01')`));
  legacy.close();
});
