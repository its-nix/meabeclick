import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const S=await import('../../src/lib/server/native-learning/public-sample.ts');
const {renderVisualDeck}=await import('../../src/lib/server/visual-deck-render.ts');

test('the sample is a valid quiz with choice, number and open rounds',()=>{
 const g=S.sampleBundle().games[0];assert.equal(g.kind,'quiz');
 assert.deepEqual([...new Set(g.rounds.map(r=>r.check?.kind??r.grading))].sort(),['choice','number','tutor-review']);
});
test('rendered page keeps answers server-side',()=>{
 const html=renderVisualDeck(S.sampleBundle(),{view:'game',gameId:S.SAMPLE_GAME_ID,baseUrl:'/sample-game',actionUrl:'/api/sample-game',version:S.SAMPLE_VERSION,activitiesOnly:true});
 assert.ok(!html.includes('"answer"')&&!html.includes('"hints"'));
 for(const r of S.sampleBundle().games[0].rounds){assert.ok(!html.includes(r.solution),r.id);for(const h of r.hints)assert.ok(!html.includes(h),r.id);}
});
test('sessions grade correct and wrong, and cap memory',()=>{
 const id=S.startSampleSession(),r=S.sampleBundle().games[0].rounds[0];
 const body=(input,eventId)=>({version:S.SAMPLE_VERSION,taskId:r.id,action:'attempt',input,eventId});
 assert.equal(S.sampleGameAction(id,body(2,'a')).correct,false);
 assert.equal(S.sampleGameAction(id,body(0,'b')).correct,true);
 assert.throws(()=>S.sampleGameAction('missing',body(0,'c')),/./);
 assert.equal(S.ensureSampleSession(id),id);assert.notEqual(S.ensureSampleSession('nope'),'nope');
});
test('the landing page links the native sample, not the legacy lesson',()=>{
 const page=readFileSync('src/routes/+page.svelte','utf8');
 assert.ok(page.includes('href="/sample-game"'));assert.ok(!page.includes('/learn/parabolas'));
});
