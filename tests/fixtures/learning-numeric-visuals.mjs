/** Synthetic teaching examples only; no saved lesson or customer material. */
export function numericLesson(kind='fraction-bar', override) {
  const examples={
    'fraction-bar': {title:'חלקים שווים מתוך שלם',prompt:'סופרים את החלקים הצבועים ואת כל החלקים.',values:[1,2],question:'איזה חלק מהשלם צבוע? כתבו שבר או מספר עשרוני.',questionTex:'p=?',practice:[1,4],challenge:[3,4],answers:[.25,.75]},
    'right-triangle': {title:'מוצאים את היתר',prompt:'שני הניצבים נפגשים בזווית ישרה. מחשבים את הצלע שמולם.',values:[3,4],question:'מהו אורך היתר במשולש?',questionTex:'c=?',practice:[3,4],challenge:[5,12],answers:[5,13]},
    'function-tangent': {title:'פונקציה והמשיק שלה',prompt:'הקו המקווקו נוגע בפונקציה בנקודה המסומנת. השיפוע תלוי במיקום שלה.',values:[1,0,0,1],question:'מהו שיפוע המשיק בנקודה המסומנת?',questionTex:'f(x)=x^2,\\quad m=?',practice:[1,0,0,1],challenge:[1,0,0,2],answers:[2,4]},
  };
  const example=examples[kind];
  const workedTex=values=>{
    if(kind==='fraction-bar') return `\\frac{${values[0]}}{${values[1]}}`;
    if(kind==='right-triangle') return `c^2=${values[0]}^2+${values[1]}^2=${values[0]**2+values[1]**2},\\quad c=${Math.hypot(...values)}`;
    const [a,b,c,t]=values;
    return `f(x)=${a}x^2+${b}x+${c},\\quad f'(${t})=2\\cdot${a}\\cdot${t}+${b}=${2*a*t+b}`;
  };
  const scenes=['discover','practice','challenge','reflect'].map((phase,index)=>({
    id:`numeric-${index}`,phase,title:example.title,prompt:example.prompt,takeaway:'הנתונים וההמחשה מתארים את אותו רעיון.',visual:kind,xDomain:[-5,5],yDomain:[-5,30],
    frames:[{values:(override??(phase==='practice'?example.practice:phase==='challenge'?example.challenge:example.values)).slice(),tex:workedTex(override??(phase==='practice'?example.practice:phase==='challenge'?example.challenge:example.values)),caption:'מחשבים לפי הנתונים שבדוגמה.'}],
    ...(['practice','challenge'].includes(phase)?{
      check:{kind:'number',question:example.question,options:[],answer:example.answers[phase==='practice'?0:1],hints:['התחילו מהנתונים המסומנים.'],success:'החישוב מתאים לנתונים.',retry:'בדקו את דרך החישוב לפי הנתונים.'},
      questionVisual:{tex:example.questionTex,caption:'השתמשו בנתונים המסומנים'},
    }:{}),
    presenterNotes:{explanation:'זוהי דוגמה סינתטית לבדיקת המחשה.',ask:'מה אפשר ללמוד מהנתונים?',expectedAnswer:'התייחסות לחלקים או לאורכים המסומנים.',ifStuck:'עברו יחד על הנתונים המסומנים.'},
  }));
  return {version:1,title:example.title,subtitle:'דוגמה סינתטית לבדיקת המחשה',objective:'מקשרים בין הנתונים לבין ההמחשה.',minutes:8,scenes};
}
