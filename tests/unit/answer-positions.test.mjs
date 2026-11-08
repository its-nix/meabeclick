/**
 * A key that never moves is fixed by the generator's post-processing, not
 * by holding the lesson. In the library trial (2026-09-28) two of six
 * skills were held for «שתי אמיתות ושקר: המשפט השקרי תמיד באותו מקום» —
 * and the games shuffle at play time, so no child ever saw the fixed
 * position. Held means a new engine run and a broken gate streak.
 * validateLesson keeps the check; balancePositions makes it pass honestly.
 */
import '../isolate-lesson-data.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatedPlanStub } from '../generated-plan-stub.mjs';
import { generationPlan } from '../helpers/generation-plan.mjs';

const P = await import('../../src/lib/server/lesson/prep.ts');

const plan = () => ({
  ...generationPlan(),
  games: {
    quiz: { title: 'חידון', subject:'מתמטיקה', questions: Array.from({length:10}, (_,i) => ({ id:`quiz-${i}`,difficulty:i%3+1,hint:'בדקו את הכלל לפני הבחירה', q: `ש${i}`, options: [`נכון${i}`, `לא${i}a`, `לא${i}b`], answer: 0, why:'הסבר' })) },
    twoTruths: { title: 'שקר', subject:'מתמטיקה', rounds: Array.from({length:10}, (_,i) => ({ id:`truth-${i}`,difficulty:i%3+1,hint:'בדקו כל משפט בנפרד', statements: [`אמת${i}a`, `שקר${i}`, `אמת${i}b`], lieIndex: 1, why: 'הסבר' })) },
  },
});

test('every key in one place is spread out, and each still points at the same text', () => {
  const before = plan();
  const after = P.balancePositions(plan());
  assert.deepEqual(P.validateLesson(before).filter(p => p.includes('אותו מקום')).length, 2, 'the fixture is biased');
  assert.deepEqual(P.validateLesson(after), [], 'and after, clean');
  after.games.quiz.questions.forEach((q, i) => assert.equal(q.options[q.answer], `נכון${i}`));
  after.games.twoTruths.rounds.forEach((r, i) => assert.equal(r.statements[r.lieIndex], `שקר${i}`));
  assert.ok(new Set(after.games.quiz.questions.map(q => q.answer)).size > 1);
});

test('keys that already vary are left exactly as they were', () => {
  const p = plan();
  p.games.quiz.questions.forEach((q, i) => {
    q.answer = i % 3;
    q.options = [...q.options.slice(3 - (i % 3)), ...q.options.slice(0, 3 - (i % 3))];
  });
  const copy = JSON.parse(JSON.stringify(p.games.quiz));
  assert.deepEqual(P.balancePositions(p).games.quiz, copy);
});

test('fresh generation balances answer positions without changing answers on initial and retry paths',async()=>{
  for(const invalidFirst of [false,true]){
    const {result,runs,critiques}=await generatedPlanStub(plan(),{invalidFirst});
    assert.equal(runs,invalidFirst?2:1);
    assert.equal(critiques,1,'only the balanced valid candidate reaches critique');
    assert.ok(new Set(result.games.quiz.questions.map(q=>q.answer)).size>1);
    result.games.quiz.questions.forEach((q,i)=>assert.equal(q.options[q.answer],`נכון${i}`));
    result.games.twoTruths.rounds.forEach((r,i)=>assert.equal(r.statements[r.lieIndex],`שקר${i}`));
    assert.deepEqual(P.validateLesson(result),[]);
  }
});

const longPlan = (count, optionCount) => ({
  ...generationPlan(),
  games: {
    quiz: {title:'חידון ארוך',subject:'מתמטיקה',questions:Array.from({length:count},(_,i)=>({
      id:`long-quiz-${i}`,difficulty:i%3+1,q:`שאלה ${i}`,hint:`רמז ${i}`,why:`הסבר ${i}`,
      options:Array.from({length:optionCount},(_,j)=>`אפשרות ${i}/${j}`),answer:optionCount-1,
    }))},
    twoTruths: {title:'משפטים',subject:'מתמטיקה',rounds:Array.from({length:count},(_,i)=>({
      id:`long-truth-${i}`,difficulty:i%3+1,hint:`בדיקה ${i}`,why:`נימוק ${i}`,
      statements:[`אמת ראשונה ${i}`,`אמת שנייה ${i}`,`שקר ${i}`],lieIndex:2,
    }))},
  },
});

for (const count of [15,40]) {
  for (const optionCount of [2,3,4]) {
    test(`balancing ${count} questions with ${optionCount} options preserves every option, key and metadata`,()=>{
      const input=longPlan(count,optionCount);
      const before=structuredClone(input);
      const after=P.balancePositions(input);
      assert.ok(new Set(after.games.quiz.questions.map(q=>q.answer)).size>1);
      assert.ok(new Set(after.games.twoTruths.rounds.map(r=>r.lieIndex)).size>1);
      after.games.quiz.questions.forEach((question,i)=>{
        const original=before.games.quiz.questions[i];
        assert.ok(question.options.every(option=>typeof option==='string'),`question ${i} must not contain undefined`);
        assert.deepEqual([...question.options].sort(),[...original.options].sort());
        assert.equal(question.options[question.answer],original.options[original.answer]);
        const {options:_options,answer:_answer,...metadata}=question;
        const {options:_originalOptions,answer:_originalAnswer,...originalMetadata}=original;
        assert.deepEqual(metadata,originalMetadata);
      });
      after.games.twoTruths.rounds.forEach((round,i)=>{
        const original=before.games.twoTruths.rounds[i];
        assert.ok(round.statements.every(statement=>typeof statement==='string'),`round ${i} must not contain undefined`);
        assert.deepEqual([...round.statements].sort(),[...original.statements].sort());
        assert.equal(round.statements[round.lieIndex],original.statements[original.lieIndex]);
        const {statements:_statements,lieIndex:_lieIndex,...metadata}=round;
        const {statements:_originalStatements,lieIndex:_originalLieIndex,...originalMetadata}=original;
        assert.deepEqual(metadata,originalMetadata);
      });
    });
  }
  test(`already varied keys in ${count}-question banks remain unchanged`,()=>{
    const input=longPlan(count,3);
    input.games.quiz.questions.forEach((question,i)=>{question.answer=i%3;});
    input.games.twoTruths.rounds.forEach((round,i)=>{round.lieIndex=i%3;});
    const before=structuredClone(input);
    assert.deepEqual(P.balancePositions(input),before);
  });
}
