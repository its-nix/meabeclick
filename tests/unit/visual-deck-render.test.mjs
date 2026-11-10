import {test} from 'node:test';import assert from 'node:assert/strict';import {visualDeckFixture} from '../visual-deck-fixture.mjs';
test('composed slides and private notes are separate documents',async()=>{
 const m=await import('../../src/lib/server/visual-deck-render.ts').catch(()=>null);assert.ok(m,'composed slide renderer exists');
 const p=visualDeckFixture();p.slides[0].presenterNotes.explanation='PRIVATE-NOTE';p.tasks[0].solution='PRIVATE-SOLUTION';
 const html=m.renderVisualDeck(p,{view:'lesson'});assert.equal((html.match(/data-slide="/g)||[]).length,20);assert.match(html,/logo-slate\.svg/);assert.match(html,/layout-compare/);assert.ok(!html.includes('PRIVATE-'));assert.ok(!html.includes('"answer"'));
 const notes=m.renderVisualDeck(p,{view:'presenter'});assert.match(notes,/PRIVATE-NOTE/);assert.match(notes,/target="lesson-audience"/);
});
test('preview attempts support hints and reveals without claiming assisted success as independent',async()=>{
 const m=await import('../../src/lib/server/visual-pilot.ts').catch(()=>null);assert.ok(m,'isolated preview checker exists');
 const p=visualDeckFixture(),task=p.tasks[0],session=m.createPreviewSession('v1',100);
 assert.throws(()=>m.previewAction(session,'v1',task,'solution',null,'s0',101),/attempt/i);
 const first=m.previewAction(session,'v1',task,'attempt','4','a1',102);assert.equal(first.correct,false);
 assert.deepEqual(m.previewAction(session,'v1',task,'attempt','4','a1',103),first);
 assert.match(m.previewAction(session,'v1',task,'hint',null,'h1',104).message,/رצוע|רצוע/);
 assert.ok(m.previewAction(session,'v1',task,'solution',null,'s1',105).message);
 const helped=m.previewAction(session,'v1',task,'attempt','38','a2',106);assert.equal(helped.correct,true);assert.equal(helped.independent,false);
 const fresh=m.createPreviewSession('v1',100);assert.equal(m.previewAction(fresh,'v1',task,'attempt','38','b1',107).independent,true);
 const retry=m.createPreviewSession('v1',100);m.previewAction(retry,'v1',task,'attempt','4','r1',107);assert.equal(m.previewAction(retry,'v1',task,'attempt','38','r2',108).independent,false);
 assert.throws(()=>m.previewAction(fresh,'v2',task,'attempt','38','b2',108),/stale/i);
 assert.throws(()=>m.previewAction(fresh,'v1',task,'attempt','38','b2',20_000_000),/stale/i);
});
