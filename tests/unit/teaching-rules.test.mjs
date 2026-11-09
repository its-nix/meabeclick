import '../isolate-lesson-data.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as prep from '../../src/lib/server/lesson/prep.ts';

test('candidate generation supplies shared teaching rules while the default generation stays compatible',async()=>{
  assert.equal(typeof prep.buildPrompt,'function','the production prompt can be inspected at its boundary');
  const saved=process.env.LESSON_GENERATION_VERSION;
  try{
    delete process.env.LESSON_GENERATION_VERSION;
    const request={subject:'מתמטיקה',level:'כיתה י · 5 יח״ל',durationMin:90,request:'נגזרת'};
    const old=prep.buildPrompt(request);
    assert.ok(!old.includes('mea-teaching-v2'));
    process.env.LESSON_GENERATION_VERSION='2';
    const candidate=prep.buildPrompt(request);
    assert.match(candidate,/mea-teaching-v2/);
    assert.match(candidate,/5 יח״ל/);
    assert.match(candidate,/45|90|135/);
    assert.match(candidate,/נימוק פתוח.*מורה/);
  }finally{if(saved===undefined)delete process.env.LESSON_GENERATION_VERSION;else process.env.LESSON_GENERATION_VERSION=saved;}
});
