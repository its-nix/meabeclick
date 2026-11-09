import {PARABOLAS} from '../src/lib/learning/parabolas.ts';
export function teachingFixture(durationMin=45){
 const learning=structuredClone(PARABOLAS);
 for(const scene of learning.scenes){Object.assign(scene.presenterNotes,{minutes:4,misconception:'בלבול בין הזזה לפתיחה',transition:'נעבור לבדוק דוגמה חדשה',sources:[]});if(scene.check)scene.check.solution='PrivateSolution: מציבים ובודקים את התוצאה.';}
 const games={quiz:{title:'חידון',subject:'מתמטיקה',questions:[0,1,2,3].map((n)=>({q:`${n}+1`,options:[String(n+1),String(n+2)],answer:0,why:'מחברים אחת',hint:'ספרו צעד אחד'}))},memory:{title:'זיכרון',subject:'מתמטיקה',pairs:[0,1,2,3,4,5].map(n=>({a:`${n}+1`,b:String(n+1)}))}};
 const check={kind:'number',question:'כמה הם שניים ועוד שניים?',options:[],answer:4,hints:['חברו זוג לזוג'],success:'ארבעה איברים',retry:'ספרו שוב',solution:'2+2=4'};
 const plan={title:'פרבולות',gradeContext:'כיתה י',learning,slides:[1,2,3,4].map(n=>({heading:`שלב ${n}`,bullets:['לומדים']})),examples:[{problem:'1+1',steps:['מחברים'],answer:'2'}],homework:[{task:'כמה הם שניים ועוד שניים?',why:'תרגול',answer:'4',check},{task:'הסבירו את ההזזה',why:'הבנה',answer:'ימינה',check:null}],games};
 const context={grade:'כיתה י',track:'5 יח״ל',notation:'standard',request:'פרבולות',skill:'הזזת פרבולה',curriculum:'',questionnaire:'',durationMin,history:[]};
 const refs=[...learning.scenes.map(s=>({kind:'scene',ref:s.id,title:s.title})),...Object.keys(games).map(key=>({kind:'game',ref:key,title:games[key].title})),{kind:'homework',ref:'homework-1',title:'הכנה לבית'}];
 const minute=Math.floor(durationMin/refs.length);
 plan.teaching={version:2,ruleVersion:'mea-teaching-v2.1',durationMin,homeworkMinutes:12,context,objectives:[{id:'o1',title:'הבנת הזזת פרבולה',evidence:'בונים גרף חדש'}],agenda:refs.map((r,i)=>({id:`a${i+1}`,...r,objectiveId:'o1',minutes:i===refs.length-1?durationMin-minute*(refs.length-1):minute})),practice:[...learning.scenes.filter(s=>s.check).map(s=>({asset:'scene',ref:s.id,objectiveId:'o1',problemId:`p-${s.id}`,misconception:'הזזה אינה שינוי פתיחה',support:s.phase==='challenge'?'independent':'guided',grading:'checked'})),...Object.keys(games).map(key=>({asset:'game',ref:key,objectiveId:'o1',problemId:`p-${key}`,misconception:'בלבול',support:'guided',grading:'checked'})),...plan.homework.map((h,i)=>({asset:'homework',ref:`homework-${i+1}`,objectiveId:'o1',problemId:`p-home-${i+1}`,misconception:'בלבול',support:i?'independent':'guided',grading:h.check?'checked':'tutor-review'}))],branches:[],sources:[]};
 return plan;
}
