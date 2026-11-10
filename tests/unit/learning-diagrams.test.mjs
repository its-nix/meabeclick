import '../isolate-lesson-data.mjs';import{test}from'node:test';import assert from'node:assert/strict';
test('automatic labelling uses checked geometry with visible identities',async()=>{
 const{canonicalLabelling,isCanonicalLabelling}=await import('../../src/lib/games/diagrams.ts');
 const triangle=canonicalLabelling({diagram:'right-triangle',title:'ניצבים ויתר',subject:'מתמטיקה'});assert.ok(triangle);assert.match(triangle.svg,/>a<\/text>/);assert.match(triangle.svg,/>b<\/text>/);assert.equal(triangle.targets.length,3);assert.ok(isCanonicalLabelling(triangle));
 const cylinder=canonicalLabelling({diagram:'cylinder',title:'רדיוס קוטר וגובה',subject:'מתמטיקה'});assert.match(cylinder.svg,/<circle[^>]*cx="120"[^>]*cy="125"[^>]*r="75"/);assert.match(cylinder.svg,/x1="120" y1="50" x2="120" y2="200"/);assert.ok(isCanonicalLabelling(cylinder));
 assert.equal(canonicalLabelling({diagram:'made-up',title:'x',subject:'x'}),null);assert.equal(isCanonicalLabelling({...cylinder,svg:cylinder.svg.replace('y1="50"','y1="58"')}),false);
 const{validateLessonGame}=await import('../../src/lib/server/lesson-games.ts');assert.doesNotThrow(()=>validateLessonGame('labelling',triangle));assert.doesNotThrow(()=>validateLessonGame('labelling',cylinder));
});
