import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as dates from '../../src/lib/dates.ts';

test('booking day chips show only the weekday, including across month boundaries', () => {
  assert.equal(typeof dates.bookingDayLabel, 'function');
  assert.equal(dates.bookingDayLabel('יום שני, 2 נובמבר'), 'שני');
  assert.equal(dates.bookingDayLabel('יום רביעי, 30 דצמבר'), 'רביעי');
  assert.equal(dates.bookingDayLabel('יום שישי, 1 ינואר'), 'שישי');
  assert.equal(dates.bookingDayLabel('יום שבת, 31 אוקטובר'), 'שבת');
  assert.equal(dates.bookingDayLabel('תאריך אחר'), 'תאריך אחר');
});

test('booking keeps the full date accessible and visible below the weekday chips', () => {
  const page = readFileSync('src/routes/booking/+page.svelte', 'utf8');
  assert.match(page, /aria-label=\{group\.label\}/);
  assert.match(page, /\{bookingDayLabel\(group\.label\)\}/);
  assert.match(page, /class="day-label">\{dayGroups\[openDay\]\.label\}/);
});
