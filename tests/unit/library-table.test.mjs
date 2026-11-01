import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterLibraryRows } from '../../src/lib/library-table.ts';

const rows = [
  { templateId: 'math-8', topic: 'אלגברה', title: 'משוואות X', track: 'כיתה ח', item: { status: 'ready' } },
  { templateId: 'math-9', topic: 'אלגברה', title: 'משוואות X', track: 'כיתה ט', item: null },
  { templateId: 'math-8', topic: 'גאומטריה', title: 'זוויות', track: 'כיתה ח', item: { status: 'failed' } },
];
const all = { template: '', topic: '', status: '', search: '' };

test('the unfiltered library shows all tracks without mutating its source', () => {
  assert.deepEqual(filterLibraryRows(rows, all), rows);
  assert.equal(rows.length, 3);
});
test('column filters intersect rather than replacing each other', () => {
  assert.deepEqual(filterLibraryRows(rows, { ...all, template: 'math-8', topic: 'אלגברה', status: 'ready' }), [rows[0]]);
  assert.deepEqual(filterLibraryRows(rows, { ...all, template: 'math-9', status: 'ready' }), []);
});
test('unprepared is a real filter separate from failed and working', () => {
  assert.deepEqual(filterLibraryRows(rows, { ...all, status: 'none' }), [rows[1]]);
  assert.deepEqual(filterLibraryRows(rows, { ...all, status: 'failed' }), [rows[2]]);
});
test('search trims whitespace, supports Hebrew and ignores Latin letter case', () => {
  assert.deepEqual(filterLibraryRows(rows, { ...all, search: '  x  ' }), rows.slice(0, 2));
  assert.deepEqual(filterLibraryRows(rows, { ...all, search: 'זוויות' }), [rows[2]]);
  assert.deepEqual(filterLibraryRows(rows, { ...all, search: 'כיתה ט' }), [rows[1]]);
});
test('search combines with columns and preserves the original row identity', () => {
  const found = filterLibraryRows(rows, { ...all, template: 'math-9', topic: 'אלגברה', status: 'none', search: 'משוואות' });
  assert.equal(found.length, 1);
  assert.equal(found[0], rows[1]);
  assert.deepEqual(filterLibraryRows(rows, { ...all, search: 'no match' }), []);
});
