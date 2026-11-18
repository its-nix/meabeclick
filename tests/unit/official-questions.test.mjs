import '../isolate-lesson-data.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';
test('only the verified catalogue can grant an official source identity',async()=>{
 const m=await import('../../src/lib/server/lesson/official-questions.ts').catch(()=>null);assert.ok(m,'catalogue exists');
 const q=m.officialQuestion('moe-2025b-35571-1c2');assert.ok(q,'a catalogue question resolves by id');
 assert.match(q.transcript,/x\^4/);assert.equal(q.kind,'adapted');assert.equal(q.answer,'1/30');
 assert.equal(m.officialQuestion('forged'),null);
 assert.equal(m.officialQuestion('../x'),null);assert.equal(m.officialQuestion('https://evil.test'),null);
 const forged={...q,id:'forged',verified:true};assert.throws(()=>m.verifyImport(forged,Buffer.from('%PDF-changed')),/hash|verification/i);
 assert.throws(()=>m.verifyImport({...q,crop:[-1,0,100,100]},Buffer.from('%PDF-changed')),/crop/i);
 assert.throws(()=>m.verifyImport(q,Buffer.from('%PDF-changed')),/hash/i);
 // Exact antiderivative, computed independently of catalogue answer text.
 assert.ok(Math.abs((0-((-1)**6/6+(-1)**5/5))-1/30)<1e-14);
});
