import {test} from 'node:test';import assert from 'node:assert/strict';
import {visualDeckFixture} from '../visual-deck-fixture.mjs';
test('a real slide bundle supports more than twelve meaningful slides with coherent timing',async()=>{
 const m=await import('../../src/lib/learning/deck/model.ts').catch(()=>null);assert.ok(m,'visual slide contract exists');
 assert.deepEqual(m.visualLessonProblems(visualDeckFixture()),[]);
 const bad=visualDeckFixture();bad.agenda[0].minutes=89;assert.ok(m.visualLessonProblems(bad).some(x=>x.includes('זמן')));
});
test('the complete official question has verified imagery',async()=>{
 const m=await import('../../src/lib/server/lesson/official-questions.ts');
 const q=m.officialQuestion('moe-2025a-35372-3');assert.ok(q,'verified full question is catalogued');
 assert.equal(q.questionnaire,'35372');assert.equal(q.answers.a1,'72');assert.equal(q.answers.c,'200');
 const asset=await m.officialQuestionAsset(q.id);assert.match(asset.image,/^data:image\/png;base64,/);
 const {createHash}=await import('node:crypto');assert.equal(createHash('sha256').update(Buffer.from(asset.image.split(',')[1],'base64')).digest('hex'),asset.imageSha256);
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
 model.states[0].lowerZ=-4;model.states[0].upperZ=4;assert.equal(m.normalVisual(model).percent,100);assert.match(m.normalVisual(model).formula,/infty/,'the whole population has infinite tail bounds');
 model.states[0].upperZ=1.75;const base=m.normalVisual(model);const spread=m.normalVisual(model,0,'spread',{sd:15});
 assert.notEqual(base.svg,spread.svg);assert.match(spread.formula,/15/);
 model.mode='position';model.showProbability=false;model.states[0]={mean:72,sd:8,lowerZ:null,upperZ:null,pointZ:1.75,hideZ:1.75};
 const hidden=m.normalVisual(model);assert.ok(!hidden.formula.includes('86'));assert.ok(!hidden.svg.includes('>86<'));
 assert.match(hidden.svg,/data-standard-distance/);
 model.mode='axis';assert.match(m.normalVisual(model).caption,/חצי/);
});
test('side-by-side spreads share axes so their visible widths actually differ',async()=>{
 const {normalVisual}=await import('../../src/lib/learning/deck/normal.ts');const small={mode:'spread',interactive:'none',showProbability:false,states:[{mean:70,sd:4,lowerZ:null,upperZ:null,pointZ:null,hideZ:null}]},large=structuredClone(small);large.states[0].sd=12;
 const peers=[small,large],a=normalVisual(small,0,'one',{},peers),b=normalVisual(large,0,'two',{},peers);
 const path=s=>s.match(/<polyline[^>]*points="([^"]*)"/)[1];assert.notEqual(path(a.svg),path(b.svg));
 const ticks=s=>[...s.matchAll(/data-z-tick="[^"]*"[^]*?<text x="([^"]*)"[^]*?>([^<]*)<\/text>/g)].map(m=>m[1]+':'+m[2]);assert.deepEqual(ticks(a.svg),ticks(b.svg));
});
test('questions reject mean disclosure, mismatched missing labels and solution-shaded regions',async()=>{
 const {visualLessonProblems}=await import('../../src/lib/learning/deck/model.ts');
 const leak=visualDeckFixture();const t=leak.homework[0];t.model.mode='axis';t.model.states[0].hideZ=0;t.check.answer=t.model.states[0].mean;assert.ok(visualLessonProblems(leak).some(x=>x.includes('ממוצע')));
 const region=visualDeckFixture();region.games[0].rounds[0].model.states[0].lowerZ=-.5;assert.ok(visualLessonProblems(region).some(x=>x.includes('צביעה')));
 const wrong=visualDeckFixture();const a=wrong.homework[0];a.model.mode='axis';a.model.states[0].hideZ=1;a.check.answer=999;assert.ok(visualLessonProblems(wrong).some(x=>x.includes('תווית')));
 const dollar=visualDeckFixture();dollar.slides[0].prompt='מהו $s=10$?';assert.ok(visualLessonProblems(dollar).length,'unsupported inline delimiters cannot silently render as prose');
});
test('graded region bounds and missing ticks must be selectable by the actual controls',async()=>{
 const {visualLessonProblems}=await import('../../src/lib/learning/deck/model.ts');
 const region=visualDeckFixture();region.games[0].rounds[0].check.answer=[-1.75,.5];assert.ok(visualLessonProblems(region).length,'quarter-step region cannot be selected');
 const axis=visualDeckFixture();const t=axis.homework[0];t.model.mode='axis';t.model.states[0].hideZ=1.75;t.check.answer=87.5;assert.ok(visualLessonProblems(axis).length,'axis has no quarter-step tick to hide');
});
test('prose rejects bare TeX commands while delimited prose and raw equation blocks remain valid',async()=>{
 const {visualLessonProblems}=await import('../../src/lib/learning/deck/model.ts');const p=visualDeckFixture();p.tasks[0].solution='משתמשים ב־x=\\mu+zs';assert.ok(visualLessonProblems(p).some(s=>s.includes('tasks.0.solution')),'diagnostic identifies the malformed solution field');
 p.tasks[0].solution='משתמשים ב־\\(x=\\mu+zs\\)';p.slides[0].blocks.push({type:'equation',text:'\\frac{1}{2}',model:null,sourceId:null,reveal:1});assert.deepEqual(visualLessonProblems(p),[]);
});

test('prose rejects keyboard math such as e^{4x} outside delimiters; delimited prose, plain parentheses and equation blocks stay valid',async()=>{
 const {visualLessonProblems}=await import('../../src/lib/learning/deck/model.ts');
 for(const bad of['פתרו e^{4x}=11','חברו את ln(e^x) להגדרה','הבעה x^2+1','משתנה a_1']){
  const p=visualDeckFixture();p.tasks[0].solution=bad;
  assert.ok(visualLessonProblems(p).some(s=>s.includes('tasks.0.solution')),'rejects: '+bad);
 }
 const ok=visualDeckFixture();ok.tasks[0].solution='פתרו \\(e^{4x}=11\\) וחברו את ln(ab) להגדרה';ok.homework[0].solution='PRIVATE_SOLUTION_9 ו־x=____ בסוף';ok.slides[0].blocks.push({type:'equation',text:'e^{4x}=11',model:null,sourceId:null,reveal:1});
 assert.deepEqual(visualLessonProblems(ok),[]);
});

test('a quiz game may use multiple choice, numeric and tutor-reviewed open rounds; unknown game kinds stay rejected',async()=>{
 const {visualLessonProblems,gradeDeckTask}=await import('../../src/lib/learning/deck/model.ts');
 const quiz=()=>{
  const base=visualDeckFixture().homework[0],round=(id,patch)=>({...structuredClone(base),id,model:null,...patch});
  return {id:'quiz-game',title:'חידון קצר',intro:'שלוש שאלות על מה שלמדנו.',kind:'quiz',rounds:[
   round('quiz-1',{check:{kind:'choice',answer:1,options:['תשובה א','תשובה ב','תשובה ג']}}),
   round('quiz-2',{check:{kind:'number',answer:7,options:[]}}),
   round('quiz-3',{grading:'tutor-review',check:null})]};
 };
 const p=visualDeckFixture();p.games[1]=quiz();
 assert.deepEqual(visualLessonProblems(p),[]);
 const q=quiz();
 assert.equal(gradeDeckTask(q.rounds[0],1),true);assert.equal(gradeDeckTask(q.rounds[0],0),false);
 assert.equal(gradeDeckTask(q.rounds[1],7),true);assert.equal(gradeDeckTask(q.rounds[2],'כל טקסט'),false,'open rounds are never auto-graded');
 const bad=visualDeckFixture();bad.games[1]={...quiz(),kind:'memory'};
 assert.ok(visualLessonProblems(bad).some(s=>s.includes('משחק')),'unknown kind rejected');
});
