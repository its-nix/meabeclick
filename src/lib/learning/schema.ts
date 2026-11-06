/** Bounded schema the lesson generator can actually render and grade. */
const text = { type: 'string' };
const numbers = { type: 'array', items: { type: 'number' } };
export const LEARNING_SCHEMA = {
  type: 'object',
  required: ['version', 'title', 'subtitle', 'objective', 'minutes', 'scenes'],
  properties: {
    version: { type: 'integer', enum: [1] }, title: text, subtitle: text, objective: text, minutes: { type: 'number' },
    scenes: { type: 'array', items: {
      type: 'object', required: ['id', 'phase', 'title', 'prompt', 'takeaway', 'visual', 'xDomain', 'yDomain', 'frames', 'check', 'presenterNotes'],
      properties: {
        id: text, phase: { type: 'string', enum: ['discover', 'explore', 'practice', 'challenge', 'reflect'] },
        title: text, prompt: text, takeaway: text,
        presenterNotes: {
          type: 'object', required: ['explanation', 'ask', 'expectedAnswer', 'ifStuck'],
          properties: { explanation: text, ask: text, expectedAnswer: text, ifStuck: text },
        },
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
  'מותג: מאה בקליק. העיצוב, הלוגו המקורי, צבעי האתר והגופן Heebo מגיעים מהתבנית הקבועה. אין להמציא מיתוג, סלוגנים, HTML או הוראות עיצוב.',
  'ניסוח לתלמידים: עברית טבעית, חמה וישירה, בלשון רבים. כמו מורה שמסביר/ה בקול, לא כמו ספר לימוד. משפט קצר, רעיון אחד ופעולה אחת בכל שלב.',
  'לתלמידים קוראים ל־frames "שלבי ההסבר", לא "מסגרות". בהדגמה אפשר לומר "לחצו על ההפעלה ועקבו אחרי השינוי"; אין להציג מונחי מערכת כמו scene או phase.',
  'קודם מראים מה רואים בדוגמה מסוימת, אחר כך מסבירים למה, ורק אז נותנים שם לכלל. מגדירים כל מושג חדש במילים יומיומיות לפני שמשתמשים בו.',
  'לדוגמה: במקום "הביטוי הריבועי מתאפס עבור הערך האופקי" כתבו "מציבים \\(x=2\\): בתוך הסוגריים מקבלים \\(2-2=0\\). כאן נמצא הקודקוד." אל תעתיקו את הדוגמה לנושא שאינו מתאים לה.',
  'במקום "בצעו התאמה בין הייצוגים" כתבו פעולה מדויקת כמו "התאימו את הגרף הכחול לקו המקווקו". בלי מטאפורות עמומות, סלוגנים או "זה קל/ברור".',
  'כותרות מציינות מה לומדים. ההנחיה אומרת מה לעשות עכשיו. כל caption מסביר מה השתנה ולמה. משוב מצביע על הצעד הנכון או על בדיקה מסוימת, ולא מסתפק ב"נכון".',
  'לכל סצנה חובה presenterNotes למורה בלבד: explanation הוא הסבר שאפשר להגיד בקול ב־2–4 משפטים; ask היא שאלה אחת לשאול ולעצור; expectedAnswer מתאר תשובה/הבנה רצויה; ifStuck הוא צעד עזרה קונקרטי לטעות סבירה. להתייחס לדוגמה, למספרים ולתשובה של הסצנה, בלי הוראות כלליות כמו "להסביר היטב".',
  'הפרטים הארוכים וההנחיות למורה שייכים רק ל־presenterNotes. אין לשים אותם בהנחיה לתלמידים, ברמזים או בנוסח השאלה. גם לסצנות פתיחה וסיכום יש הערות שימושיות.',
  'חוויית למידה (learning): חובה. זה החומר הראשי שהתלמיד/ה פוגש/ת: הסבר חזותי קצר → חקירה → תרגול → אתגר עצמאי → סיכום.',
  'כתוב/כתבי 4–8 סצנות קוהרנטיות סביב השאלות שנמסרו, עם כותרות קצרות ומשפט הנחיה אחד לכל סצנה. לא רשימות נקודות.',
  'בכל סצנה 1–4 frames: caption קצר, tex תקין ב־KaTeX, ו־values לפי סוג ההמחשה. כל שלב מוסיף רעיון יחיד.',
  'הדגמה עם כמה frames משאירה את הפרמטרים קבועים בזמן הצגת כל שלב. חקירה חופשית עם מחוונים היא phase=explore עם frame יחיד; ההנחיה אומרת מה לנסות ואינה מניחה שהערכים יישארו בערכי ההתחלה.',
  'בחרו מטרה ממוקדת שאפשר להשלים בחוויה, ולא הבטחה ללמד את כל הנושא. objective מסכם רק מה שנלמד ותורגל בפועל. minutes הוא זמן עבודה בחוויה (לרוב 8–15 דקות), לא אורך השיעור הפרטי כולו.',
  'visual=quadratic: values=[a,h,k], כלומר y=a(x-h)^2+k. visual=linear: values=[m,b], כלומר y=mx+b.',
  'בפרבולה השתמשו באותיות a,h,k בכל הטקסטים והערות המורה, לא p או שמות אחרים: המחוונים מסומנים h ו־k. בישר השתמשו ב־m,b. צריך להיות אותו סימון בנוסחה, בהסבר, בשאלה ובמחוונים.',
  'visual=number-line: values=[value]. visual=balance: values=[coefficient,constant,total], כלומר coefficient*x+constant=total; coefficient שלם 1–6, constant בין 0 ל־12, total בין 0 ל־40.',
  'visual=steps: values=[]; הצג/הציגי את התרגיל הפתור בצעדים מתמטיים, לא בבולטים. השתמש/י בזה לכל נושא שאינו מתאים לשאר ההמחשות. אין להמציא גרף לנושא שאינו גרפי.',
  'כאשר מלמדים שינוי בצורת הכתיבה, למשל השלמה לריבוע, חובה visual=steps ולהציג גם את פעולת הביניים שמסבירה את המעבר. quadratic ו־linear מציגים נוסחה שמחושבת מהפרמטרים, ולכן אינם מיועדים להחלפת נוסחאות שקולות באותם values. אל תקפצו מהתרגיל ישר לתוצאה.',
  'גם הצבה וחישוב ערך פונקציה מציגים ב־steps עם התרגיל והחישוב, ולא כגרף שנשאר ללא שינוי. בגרף linear מסומנת נקודת החיתוך עם ציר y בלבד; אין להבטיח שנקודה אחרת תסומן.',
  'xDomain ו־yDomain הם [min,max] בטווח סביר, ורוחב כל טווח עד 100. קודקודים ונקודות חשובות חייבים להיכנס לגרף.',
  'לפחות שתי סצנות עם check, ובהן אחת phase=challenge: שאלה ללא עזרים, שלא משכפלת את הדוגמה הפתורה.',
  'check.kind=choice: options מכיל 2–4 תשובות שונות ו־answer הוא האינדקס הנכון. number: answer הוא מספר, השאלה מבקשת ערך מספרי יחיד, לא ביטוי חופשי. graph-target: רק quadratic/linear, answer הוא מערך הפרמטרים הרצוי, כולם שלמים בין מינוס 5 ל־5, ומקדם הפרבולה שונה מאפס.',
  'ב־graph-target בודקים התאמה של כל הגרף: מיקום, פתיחה וכיוון, לא רק קודקוד. השאלה והמשוב חייבים לומר זאת. בגרף מוצג קו יעד מקווקו; אין להבטיח נקודת יעד מסומנת או עזר שלא קיים בתבנית.',
  'לכל check יש 1–3 hints מדורגים, success שמסביר את ההצלחה, ו־retry שמכוון לטעות סבירה. אין פתרון בתוך נוסח השאלה.',
  'בסצנות שאינן בודקות תשובה check=null. בשדות prose עטוף/עטפי נוסחאות ב־\\( ו־\\); בשדה tex כתוב/כתבי נוסחה בלבד בלי עוטפים.',
  'הסצנה הראשונה היא discover והאחרונה reflect. בסצנת challenge ובכל graph-target יש frame יחיד של שאלה, בלי פתרון נתון; ב־graph-target נקודת ההתחלה שונה מהמטרה.',
  'הנוסחה בכל frame חייבת לתאר בדיוק את values שלו. בשלב challenge התשובה והגרף מוסתרים עד לפתרון.',
];
