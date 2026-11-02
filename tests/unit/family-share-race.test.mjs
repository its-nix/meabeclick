import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function sharingHarness() {
  const source = readFileSync('src/routes/app/parent/+page.svelte', 'utf8');
  const extract = name => {
    const start = source.indexOf('  async function ' + name + '(');
    return source.slice(start, source.indexOf('\n  async function ', start + 5));
  };
  const pending = [];
  const js = ts.transpileModule(extract('openStudent') + extract('loadShare'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const fixture = new Function('fetch', 'fetchPortal', 'toDashboardShape', 'document', 'history', 'location', `
    let currentId='child-a', loading=false, loadError='', CURRENT=null;
    let share=null, shareOpen=false, shareConfirm=false, showLink=false, copied=false;
    let shareBusy=false, shareErr='', shareGeneration=0;
    ${js}
    return { issue:loadShare, select:openStudent, state:()=>({currentId,share,shareOpen,shareBusy,shareErr}) };
  `)(() => new Promise(resolve => pending.push(resolve)), async code => ({name:code}), x => x, {}, {replaceState(){}}, {});
  return { ...fixture, respond: (index, name) => pending[index](Response.json({name,link:'/synthetic-only',joinCode:'TEST-ONLY'})) };
}
test('a delayed access response cannot appear on a different child board', async () => {
  const h = sharingHarness();
  const pending = h.issue();
  await h.select('child-b');
  h.respond(0, 'Child A'); await pending;
  assert.equal(h.state().currentId, 'child-b');
  assert.equal(h.state().share, null);
  assert.equal(h.state().shareOpen, false);
});
test('returning to the first child does not revive an invalidated access request', async () => {
  const h = sharingHarness();
  const pending = h.issue();
  await h.select('child-b'); await h.select('child-a');
  h.respond(0, 'Old child A'); await pending;
  assert.equal(h.state().share, null);
});
test('an old access response cannot clear a newer child request busy state', async () => {
  const h = sharingHarness();
  const older = h.issue(); await h.select('child-b');
  const newer = h.issue();
  h.respond(0, 'Child A'); await older;
  assert.equal(h.state().shareBusy, true);
  h.respond(1, 'Child B'); await newer;
  assert.equal(h.state().share.name, 'Child B');
  assert.equal(h.state().shareBusy, false);
});
