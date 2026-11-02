import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function refreshHarness(api, existing = {}) {
  const source = readFileSync('src/routes/app/dashboard/+page.svelte', 'utf8');
  const start = source.indexOf('  async function refreshActivity(');
  const fn = source.slice(start, source.indexOf('\n  async function ', start + 5));
  const state = { api, activitySequence: {}, activityLoading: {}, activityError: {}, serverExtras: existing, chargesFor: {} };
  const js = ts.transpileModule(fn, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return { ...state, refresh: new Function(...Object.keys(state), js + '; return refreshActivity;')(...Object.values(state)) };
}
const activity = { nextLesson: { date: '2027-08-02' }, homework: [{ id: '1' }], sessions: [] };
test('failed charges never discard successfully fetched next lesson and homework', async () => {
  const h = refreshHarness(async path => path.startsWith('/api/payments')
    ? new Response('{}', { status: 503 }) : Response.json(activity));
  await h.refresh('example');
  assert.deepEqual(h.serverExtras.example, activity);
  assert.equal(h.activityError.example, '');
  assert.equal(h.activityLoading.example, false);
});
test('failed activity reads retain labelled last-known learning data', async () => {
  const h = refreshHarness(async () => new Response('{}', { status: 503 }), { example: activity });
  await assert.rejects(h.refresh('example'));
  assert.deepEqual(h.serverExtras.example, activity);
  assert.ok(h.activityError.example);
  assert.equal(h.activityLoading.example, false);
});
test('a late activity response cannot overwrite a newer confirmed response', async () => {
  let first;
  let calls = 0;
  const h = refreshHarness(async path => {
    if (path.startsWith('/api/payments')) return Response.json({ charges: [] });
    calls++;
    return calls === 1 ? new Promise(resolve => { first = resolve; }) : Response.json({ ...activity, homework: [] });
  });
  const older = h.refresh('example');
  await h.refresh('example');
  first(Response.json(activity));
  await older;
  assert.deepEqual(h.serverExtras.example.homework, []);
});
