import '../isolate-lesson-data.mjs';
import{test}from'node:test';import assert from'node:assert/strict';
test('graph options share axes so scale and translation remain distinguishable',async()=>{
 const{sampleBounds,sampleGraph}=await import('../../src/lib/games/graph-plot.ts');
 const a=[1,2,3],b=[2,4,6],bounds=sampleBounds([a,b],[-1,0,1]);
 const first=sampleGraph(a,'primary',bounds),second=sampleGraph(b,'option',bounds),points=s=>s.match(/<polyline points="([^"]+)"/)[1];
 assert.notEqual(points(first),points(second));assert.equal(points(first),points(sampleGraph(a,'option',bounds)));
 assert.match(first,/data-sample-x="-1"/);assert.match(first,/data-sample-x="0"/);assert.equal(bounds.yMin,0);assert.ok(bounds.yMax>=6);
 const shifted=sampleBounds([[1,2,3,4,5]],[-3,-2,-1,0,1]);assert.ok(sampleGraph([1,2,3,4,5],'primary',shifted).includes('data-zero-x="241"'));
 assert.doesNotThrow(()=>sampleGraph([0,0,0],'primary',sampleBounds([[0,0,0]])));
});

test('published graph games reject malformed coordinate metadata',async()=>{
 const{validateLessonGame}=await import('../../src/lib/server/lesson-games.ts');const round={prompt:'התאימו גרף',mainLabel:'קו',main:[1,2,3],xValues:[-1,0,1],options:[[1,2,3],[2,4,6]],answer:0,why:'בדיקה',hint:'השוו נקודות'},game={title:'גרפים',subject:'מתמטיקה',rounds:[round,structuredClone(round),structuredClone(round)]};
 assert.doesNotThrow(()=>validateLessonGame('graph-match',game));
 for(const xs of [null,'bad',{},[0,1],['bad',0,1],[-1,1,0],[-1,0,2],[0,.001,.002]]){const bad=structuredClone(game);bad.rounds[0].xValues=xs;assert.throws(()=>validateLessonGame('graph-match',bad),e=>e.issues.some(i=>i.path.includes('xValues')));}
});
