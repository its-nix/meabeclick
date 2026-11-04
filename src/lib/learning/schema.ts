/** Bounded schema the lesson generator can actually render and grade. */
const text = { type: 'string' };
const numbers = { type: 'array', items: { type: 'number' } };
export const LEARNING_SCHEMA = {
  type: 'object',
  required: ['version', 'title', 'subtitle', 'objective', 'minutes', 'scenes'],
  properties: {
    version: { type: 'integer', enum: [1] }, title: text, subtitle: text, objective: text, minutes: { type: 'number' },
    scenes: { type: 'array', items: {
      type: 'object', required: ['id', 'phase', 'title', 'prompt', 'takeaway', 'visual', 'xDomain', 'yDomain', 'frames', 'check'],
      properties: {
        id: text, phase: { type: 'string', enum: ['discover', 'explore', 'practice', 'challenge', 'reflect'] },
        title: text, prompt: text, takeaway: text,
        visual: { type: 'string', enum: ['quadratic', 'linear', 'number-line', 'balance', 'steps'] },
        xDomain: numbers, yDomain: numbers,
        frames: { type: 'array', items: { type: 'object', required: ['caption', 'tex', 'values'], properties: { caption: text, tex: text, values: numbers } } },
        check: { anyOf: [{ type: 'null' }, {
          type: 'object', required: ['kind', 'question', 'options', 'answer', 'hints', 'success', 'retry'],
          properties: {
            kind: { type: 'string', enum: ['choice', 'number', 'graph-target'] }, question: text,
            options: { type: 'array', items: text }, answer: { anyOf: [{ type: 'number' }, numbers] },
            hints: { type: 'array', items: text }, success: text, retry: text,
          },
        }] },
      },
    } },
  },
};

export const LEARNING_INSTRUCTIONS = [
  'חוויית למידה (learning): חובה. זה החומר הראשי שהתלמיד/ה פוגש/ת: הסבר חזותי קצר → חקירה → תרגול → אתגר עצמאי → סיכום.',
  'כתוב/כתבי 4–8 סצנות קוהרנטיות סביב השאלות שנמסרו, עם כותרות קצרות ומשפט הנחיה אחד לכל סצנה. לא רשימות נקודות.',
  'בכל סצנה 1–4 frames: caption קצר, tex תקין ב־KaTeX, ו־values לפי סוג ההמחשה. כל שלב מוסיף רעיון יחיד.',
  'visual=quadratic: values=[a,h,k], כלומר y=a(x-h)^2+k. visual=linear: values=[m,b], כלומר y=mx+b.',
  'visual=number-line: values=[value]. visual=balance: values=[coefficient,constant,total], כלומר coefficient*x+constant=total; coefficient שלם 1–6, constant בין 0 ל־12, total בין 0 ל־40.',
  'visual=steps: values=[]; הצג/הציגי את התרגיל הפתור בצעדים מתמטיים, לא בבולטים. השתמש/י בזה לכל נושא שאינו מתאים לשאר ההמחשות. אין להמציא גרף לנושא שאינו גרפי.',
  'xDomain ו־yDomain הם [min,max] בטווח סביר, ורוחב כל טווח עד 100. קודקודים ונקודות חשובות חייבים להיכנס לגרף.',
  'לפחות שתי סצנות עם check, ובהן אחת phase=challenge: שאלה ללא עזרים, שלא משכפלת את הדוגמה הפתורה.',
  'check.kind=choice: options מכיל 2–4 תשובות שונות ו־answer הוא האינדקס הנכון. number: answer הוא מספר, השאלה מבקשת ערך מספרי יחיד, לא ביטוי חופשי. graph-target: רק quadratic/linear, answer הוא מערך הפרמטרים הרצוי, כולם שלמים בין מינוס 5 ל־5, ומקדם הפרבולה שונה מאפס.',
  'לכל check יש 1–3 hints מדורגים, success שמסביר את ההצלחה, ו־retry שמכוון לטעות סבירה. אין פתרון בתוך נוסח השאלה.',
  'בסצנות שאינן בודקות תשובה check=null. בשדות prose עטוף/עטפי נוסחאות ב־\\( ו־\\); בשדה tex כתוב/כתבי נוסחה בלבד בלי עוטפים.',
  'הסצנה הראשונה היא discover והאחרונה reflect. בסצנת challenge ובכל graph-target יש frame יחיד של שאלה, בלי פתרון נתון; ב־graph-target נקודת ההתחלה שונה מהמטרה.',
  'הנוסחה בכל frame חייבת לתאר בדיוק את values שלו. בשלב challenge התשובה והגרף מוסתרים עד לפתרון.',
];
