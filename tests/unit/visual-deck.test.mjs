import {test} from 'node:test';import assert from 'node:assert/strict';
import {visualDeckFixture} from '../visual-deck-fixture.mjs';
test('a real slide bundle supports more than twelve meaningful slides with coherent timing',async()=>{
 const m=await import('../../src/lib/learning/deck/model.ts').catch(()=>null);assert.ok(m,'visual slide contract exists');
 assert.deepEqual(m.visualLessonProblems(visualDeckFixture()),[]);
 const bad=visualDeckFixture();bad.agenda[0].minutes=89;assert.ok(m.visualLessonProblems(bad).some(x=>x.includes('זמן')));
});
test('the complete official question has verified imagery and cannot enter the old single-answer generator',async()=>{
 const m=await import('../../src/lib/server/lesson/official-questions.ts');
 const q=m.officialQuestion('moe-2025a-35372-3');assert.ok(q,'verified full question is catalogued');
 assert.equal(q.questionnaire,'35372');assert.equal(q.answers.a1,'72');assert.equal(q.answers.c,'200');
 const asset=await m.officialQuestionAsset(q.id);assert.match(asset.image,/^data:image\/png;base64,/);
 const {createHash}=await import('node:crypto');assert.equal(createHash('sha256').update(Buffer.from(asset.image.split(',')[1],'base64')).digest('hex'),asset.imageSha256);
 assert.equal(m.resolveOfficialQuestions({grade:'כיתה יב',track:'3',questionnaire:'35372',request:'התפלגות נורמלית',skill:'התפלגות נורמלית',durationMin:90,history:[]},{requiredQuestionId:q.id}).status,'unresolved');
});
test('task checks and public projections preserve answer and note boundaries',async()=>{
 const {gradeDeckTask,publicVisualLesson,visualLessonProblems}=await import('../../src/lib/learning/deck/model.ts');const p=visualDeckFixture();
 p.slides[0].presenterNotes.explanation='PRIVATE-NOTE';p.tasks[0].solution='PRIVATE-SOLUTION';p.tasks[0].check.extra='PRIVATE-EXTRA';p.tasks[0].model.states[0].extra='PRIVATE-MODEL';
 assert.equal(gradeDeckTask(p.tasks[0],'38'),true);assert.equal(gradeDeckTask(p.tasks[0],'38x'),false);
 assert.equal(gradeDeckTask(p.games[0].rounds[0],[-.5,.5]),true);assert.equal(gradeDeckTask(p.games[0].rounds[0],['-.5','.5']),false);
 const pub=JSON.stringify(publicVisualLesson(p));assert.ok(!pub.includes('PRIVATE-'));assert.ok(!pub.includes('"answer"'));assert.ok(!pub.includes('"hints"'));assert.ok(!pub.includes('sourceSolutions'));
 for(const key of ['slides','tasks','homework','games','agenda','objectives','sourceSolutions']){const bad=visualDeckFixture();bad[key]=[null];assert.doesNotThrow(()=>visualLessonProblems(bad));assert.ok(visualLessonProblems(bad).length);}
 const bad=visualDeckFixture();bad.tasks[0].model.showProbability=true;assert.ok(visualLessonProblems(bad).some(x=>x.includes('לחשוף')));
 const wrongRef=visualDeckFixture();wrongRef.slides[0].taskId=wrongRef.homework[0].id;assert.ok(visualLessonProblems(wrongRef).some(x=>x.includes('כיתה')));
 const staleExplore=visualDeckFixture();staleExplore.slides[0].blocks[0].model.states.push({...staleExplore.slides[0].blocks[0].model.states[0],sd:15});assert.ok(visualLessonProblems(staleExplore).some(x=>x.includes('חקירה')));
});
test('the visual wire contract supports explicit composition and private checking',async()=>{
 const m=await import('../../src/lib/learning/deck/schema.ts').catch(()=>null);assert.ok(m,'visual wire schema exists');
 assert.ok(m.VISUAL_LESSON_SCHEMA.properties.slides.items.properties.blocks);
 assert.ok(m.VISUAL_LESSON_SCHEMA.properties.tasks.items.properties.check);
});
test('school bands, changed spread and non-half standard scores remain mathematically honest',async()=>{
 const m=await import('../../src/lib/learning/deck/normal.ts').catch(()=>null);assert.ok(m,'live mathematical recipe exists');
 const model=visualDeckFixture().slides[0].blocks[0].model;
 assert.equal(m.normalVisual(model).percent,38);
 model.states[0].lowerZ=1;model.states[0].upperZ=4;assert.equal(m.normalVisual(model).percent,16);
 model.states[0].lowerZ=-4;model.states[0].upperZ=1.5;assert.equal(m.normalVisual(model).percent,93);
 model.states[0].upperZ=1.75;assert.equal(m.normalVisual(model).percent,null);
 const base=m.normalVisual(model);const spread=m.normalVisual(model,0,'spread',{sd:15});
 assert.notEqual(base.svg,spread.svg);assert.match(spread.formula,/15/);
 model.mode='position';model.showProbability=false;model.states[0]={mean:72,sd:8,lowerZ:null,upperZ:null,pointZ:1.75,hideZ:1.75};
 const hidden=m.normalVisual(model);assert.ok(!hidden.formula.includes('86'));assert.ok(!hidden.svg.includes('>86<'));
 assert.match(hidden.svg,/data-standard-distance/);
 model.mode='axis';assert.match(m.normalVisual(model).caption,/חצי/);
});
