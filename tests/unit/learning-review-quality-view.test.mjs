import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const directory = await mkdtemp(join(tmpdir(), 'review-quality-view-'));
process.env.DB_PATH = join(directory, 'test.db');
after(() => rm(directory, { recursive: true, force: true }));
const review = await import('../../src/lib/server/learning-review.ts');

test('historical review bundles disclose absent quality evidence without claiming approval', () => {
  const html = review.renderReviewQuality(review.reviewCorpus.cases[0]);
  assert.match(html, /לא תועד דוח איכות/);
  assert.match(html, /אישור פדגוגי/);
});
test('review quality displays escaped findings and binds its pass to the current candidate', () => {
  const item = structuredClone(review.reviewCorpus.cases[0]);
  item.qualityReport = { version: 1, scope: 'generation-snapshot', status: 'passed', at: '2026-11-08T00:00:00Z', engine: 'fixture', model: 'fixture', attempts: [
    { candidateHash: '0'.repeat(64), critique: 'failed', issues: [{ path: 'homework[0]', code: 'critique.math', message: '<script>alert(1)</script>' }] },
    { candidateHash: createHash('sha256').update(JSON.stringify(item.plan)).digest('hex'), critique: 'passed', issues: [], checks: [{ path: 'homework[0]', math: 'pass', answerKey: 'pass', context: 'pass', teaching: 'pass', explanation: 'The worked calculation and answer agree.' }] },
  ] };
  const html = review.renderReviewQuality(item);
  assert.match(html, /הבדיקות עברו עבור הגרסה הזו/);
  assert.match(html, /נכונות: תקין/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  item.plan.title += ' changed';
  const stale = review.renderReviewQuality(item);
  assert.match(stale, /הדוח מתייחס לגרסה אחרת/);
  assert.doesNotMatch(stale, /הבדיקות עברו עבור הגרסה הזו/);
});
