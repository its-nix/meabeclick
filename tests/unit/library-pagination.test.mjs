import { test } from 'node:test';
import assert from 'node:assert/strict';
import { libraryPage } from '../../src/lib/library-table.ts';

test('library catalog pages contain at most 25 rows and clamp after filtering', () => {
  const rows = Array.from({length: 61}, (_, i) => i);
  assert.deepEqual(libraryPage(rows, 2), { page: 2, pages: 3, rows: rows.slice(25, 50) });
  assert.deepEqual(libraryPage(rows.slice(0, 2), 8), { page: 1, pages: 1, rows: [0, 1] });
  for (const page of [0, -1, NaN, 1.5, Infinity]) assert.equal(libraryPage(rows, page).page, 1);
  assert.deepEqual(libraryPage([], 9), { page: 1, pages: 1, rows: [] });
});
