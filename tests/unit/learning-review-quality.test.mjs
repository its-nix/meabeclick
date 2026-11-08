import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import * as validation from '../../scripts/learning-review-validation.mjs';

const directories = [];
after(() => Promise.all(directories.map(directory => rm(directory, { recursive: true, force: true }))));
const hash = value => createHash('sha256').update(value).digest('hex');
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'review-quality-')); directories.push(directory);
  const plan = { title: 'דוגמה מדומה' };
  const report = { version: 1, scope: 'generation-snapshot', status: 'passed', at: '2026-11-08T00:00:00Z', engine: 'fixture', model: 'fixture',
    attempts: [{ candidateHash: hash(JSON.stringify(plan)), issues: [], critique: 'passed' }] };
  const content = JSON.stringify(report);
  await writeFile(join(directory, 'case.quality.json'), content);
  return { directory, plan, report, item: { brief: { id: 'case' }, qualitySha256: hash(content) } };
}

test('review quality evidence is checksum-verified and bound to the exact candidate', async () => {
  const { directory, plan, report, item } = await fixture();
  assert.deepEqual(await validation.readVerifiedQualityReport(directory, item, plan, true), report);
  await assert.rejects(validation.readVerifiedQualityReport(directory, item, { ...plan, title: 'שונה' }, true), /candidate/);
});
test('changed quality evidence cannot be packaged under the previous checksum', async () => {
  const { directory, plan, item } = await fixture();
  await writeFile(join(directory, 'case.quality.json'), '{}');
  await assert.rejects(validation.readVerifiedQualityReport(directory, item, plan, true), /checksum/);
});
test('new batches require quality evidence while historical batches remain readable', async () => {
  const { directory, plan, item } = await fixture();
  delete item.qualitySha256;
  assert.equal(await validation.readVerifiedQualityReport(directory, item, plan), null);
  await assert.rejects(validation.readVerifiedQualityReport(directory, item, plan, true), /Missing generation quality/);
});
test('a failed critique cannot be represented as passed review evidence', async () => {
  const { directory, plan, report, item } = await fixture();
  report.attempts[0].critique = 'failed';
  const content = JSON.stringify(report);
  item.qualitySha256 = hash(content);
  await writeFile(join(directory, 'case.quality.json'), content);
  await assert.rejects(validation.readVerifiedQualityReport(directory, item, plan, true), /passed/);
});
