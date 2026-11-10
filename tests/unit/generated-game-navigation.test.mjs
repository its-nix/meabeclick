import '../isolate-lesson-data.mjs';import{test}from'node:test';import assert from'node:assert/strict';import{teachingFixture}from'../teaching-fixture.mjs';
test('automatic publication supplies student game links and score-free tutor previews',async()=>{
 const{createLesson,finishLesson}=await import('../../src/lib/server/db.ts'),{publish}=await import('../../src/lib/server/lesson/queue.ts'),{assignedTeachingDisplay}=await import('../../src/lib/server/assigned-teaching.ts');
 const p=teachingFixture(),slug='automatic-game-navigation';createLesson({slug,student:'דוגמה סינתטית',subject:'מתמטיקה',level:'כיתה ח',topic:p.title});
 const published=await publish(slug,p,{name:'דוגמה סינתטית',subject:'מתמטיקה',level:'כיתה ח'});finishLesson(slug,{status:'ready',title:p.title,homework:p.homework.map(h=>h.task),games:published.games});
 const student=assignedTeachingDisplay(p,slug,slug,{student:'synthetic'});assert.ok(student.gameLinks.quiz);const query=new URL(student.gameLinks.quiz,'https://example.test').searchParams;assert.equal(query.get('d'),slug+'-quiz');assert.equal(query.get('s'),'synthetic');assert.ok(query.get('t'));
 const tutor=assignedTeachingDisplay(p,slug,slug,{preview:true});assert.match(tutor.gameLinks.quiz,/lesson=automatic-game-navigation/);assert.ok(!tutor.gameLinks.quiz.includes('&s='));
});
