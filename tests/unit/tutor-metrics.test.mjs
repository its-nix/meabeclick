import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const modelUrl = new URL('../../src/lib/tutor-metrics.ts', import.meta.url);
test('approved shell has no observed values or fabricated freshness', async () => {
  const model = await import(modelUrl).catch(() => null);
  assert.ok(model, 'static metric definitions must exist');
  assert.deepEqual(model.metricGroups.map(g => g.id), ['operations', 'business', 'learning']);
  assert.equal(model.metricGroups.flatMap(g => g.metrics).length, 14);
  for (const metric of model.metricGroups.flatMap(g => g.metrics)) {
    assert.equal(metric.actual, null, metric.id);
    assert.equal(metric.availability, 'NOT_AVAILABLE', metric.id);
    assert.equal(metric.asOf, null, metric.id);
    assert.ok(metric.definition && metric.window && metric.reason, metric.id);
  }
});

test('shell has no observation readers, calculations, tracking, or learning-record inputs', () => {
  const model = readFileSync(modelUrl, 'utf8');
  const server = readFileSync(new URL('../../src/routes/app/metrics/+page.server.ts', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../../src/routes/app/metrics/+page.svelte', import.meta.url), 'utf8');
  assert.deepEqual([...server.matchAll(/import[^;]*from ['"]([^'"]+)['"]/g)].map(m => m[1]), ['$server/auth.ts', './$types']);
  assert.ok(server.indexOf('requireAuth(event)') < server.indexOf('return {}'));
  assert.doesNotMatch(model, /^import\b/m);
  for (const source of [model, server, page]) {
    assert.doesNotMatch(source, /fetch\s*\(|\bSELECT\b|\bDatabaseSync\b|\bhandle\s*\(|localStorage|sessionStorage|\$effect|\$props|\{@html/);
  }
  assert.match(page, /<dd class="unknown">לא ידוע/);
  assert.doesNotMatch(page, /metric\.actual\s*\?\?|metric\.actual\s*\|\|/);
});
