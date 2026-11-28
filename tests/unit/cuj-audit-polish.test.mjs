import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatDateTime, israelDay, israelTime } from '../../src/lib/dates.ts';
import { HEARD_FROM_LABELS, HEARD_FROM_OPTIONS } from '../../src/lib/marketing-labels.ts';
import { renderVisualDeck } from '../../src/lib/server/visual-deck-render.ts';
import { visualDeckFixture } from '../visual-deck-fixture.mjs';

test('date formatters guard against invalid or missing timestamps instead of throwing', () => {
  assert.equal(formatDateTime(''), '—');
  assert.equal(formatDateTime('not-a-date'), '—');
  assert.equal(israelDay(''), '');
  assert.equal(israelDay('invalid'), '');
  assert.equal(israelTime(''), '');
  assert.equal(israelTime('invalid'), '');
  assert.match(formatDateTime('2028-08-10T10:00:00+03:00'), /^10\/08\/2028 10:00$/);
});

test('HEARD_FROM_LABELS maps legacy social enum to Hebrew while keeping booking options unchanged', () => {
  assert.equal(HEARD_FROM_LABELS.social, 'פייסבוק/אינסטגרם');
  assert.equal(HEARD_FROM_LABELS.instagram, 'פייסבוק/אינסטגרם');
  assert.equal(HEARD_FROM_OPTIONS.some(o => o.value === 'social'), false);
});

test('public sample game carries favicon and booking CTAs while student player stays clean', () => {
  const sampleHtml = renderVisualDeck(visualDeckFixture(), {
    view: 'game',
    gameId: 'axis-game',
    baseUrl: '/sample-game',
    actionUrl: '/api/sample-game',
    version: 'v',
    activitiesOnly: true,
    publicSample: true,
  });
  assert.match(sampleHtml, /<link rel="icon" href="\/images\/favicon\.svg/);
  assert.match(sampleHtml, /<a class="sample-book-cta topbar-cta" href="\/booking">הזמנת שיעור<\/a>/);
  assert.match(sampleHtml, /<a class="sample-book-cta" href="\/booking">הזמנת שיעור<\/a>/);

  const studentHtml = renderVisualDeck(visualDeckFixture(), {
    view: 'game',
    gameId: 'axis-game',
    baseUrl: '/app/student/games',
    actionUrl: '/api/student-games/1',
    version: 'v',
    activitiesOnly: true,
    studentPlayer: true,
  });
  assert.match(studentHtml, /<link rel="icon" href="\/images\/favicon\.svg/);
  assert.ok(!studentHtml.includes('href="/booking"'));
});

test('BrandMark links always carry an accessible fallback label when decorative', () => {
  const src = readFileSync('src/lib/components/BrandMark.svelte', 'utf8');
  assert.match(src, /<a class="brand-mark-link" \{href\} aria-label=\{label \? undefined : '[^']+'\}>/);
});
