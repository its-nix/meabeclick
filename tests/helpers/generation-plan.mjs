import { PARABOLAS } from '../../src/lib/learning/parabolas.ts';
export const generationPlan = () => ({
  title: 'פרבולות', gradeContext: 'כיתה ט', learning: structuredClone(PARABOLAS),
  slides: Array.from({length:4}, (_,i)=>({heading:`שלב ${i+1}`,bullets:['מציבים x=2 ומחשבים 2²=4']})),
  examples:[{problem:'2²',steps:['2 × 2','4'],answer:'4'}],
  homework:[{task:'חשבו 3²',why:'הצבה',answer:'9'},{task:'חשבו 4²',why:'הצבה',answer:'16'}],
  games:{memory:{title:'ריבועים',subject:'מתמטיקה',pairs:Array.from({length:6},(_,i)=>({a:`${i+1}²`,b:String((i+1)**2)}))},matching:{title:'התאמה',subject:'מתמטיקה',pairs:[{left:'2²',right:'4',hint:'כפלו'},{left:'3²',right:'9',hint:'כפלו'},{left:'4²',right:'16',hint:'כפלו'},{left:'5²',right:'25',hint:'כפלו'}]}},
});
export const passingCritique = plan => ({checks: [
  ...plan.slides.map((_,i)=>`slides[${i}]`), ...plan.examples.map((_,i)=>`examples[${i}]`), ...plan.homework.map((_,i)=>`homework[${i}]`),
  ...Object.entries(plan.games).flatMap(([key,body])=>{
    const bankKey=({quiz:'questions',errorHunt:'rounds',twoTruths:'rounds',graphMatch:'rounds',numberLine:'rounds',speedDrill:'items'})[key];
    return bankKey ? body[bankKey].map((_,i)=>`games.${key}.${bankKey}[${i}]`) : [`games.${key}`];
  }), ...plan.learning.scenes.map((_,i)=>`learning.scenes[${i}]`),
].map(path=>({path,math:'pass',answerKey:'pass',context:'pass',teaching:'pass',explanation:'The concrete calculation, key and explanation agree with the assigned skill.'}))});
