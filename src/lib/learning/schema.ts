import { learningControlGuidance } from './controls.ts';
import { LEARNING_FRAME_TEXT_LIMITS } from './model.ts';

/** Bounded schema the lesson generator can actually render and grade. */
const text = { type: 'string' };
const numbers = { type: 'array', items: { type: 'number' } };
const frameText = {
  tex: {type:'string',minLength:1,maxLength:LEARNING_FRAME_TEXT_LIMITS.tex,pattern:'\\S'},
  caption: {type:'string',minLength:1,maxLength:LEARNING_FRAME_TEXT_LIMITS.caption,pattern:'\\S'},
};
export const LEARNING_SCHEMA = {
  type: 'object',
  required: ['version', 'title', 'subtitle', 'objective', 'minutes', 'scenes'],
  properties: {
    version: { type: 'integer', enum: [1] }, title: text, subtitle: text, objective: text, minutes: { type: 'number' },
    topics: { anyOf: [{type:'null'}, {type:'array',maxItems:40,items:{type:'object',required:['id','title','sceneIds','skillKeys'],properties:{
      id:{type:'string',minLength:1,maxLength:120,pattern:'\\S'},title:{type:'string',minLength:1,maxLength:200,pattern:'\\S'},
      sceneIds:{type:'array',minItems:1,maxItems:12,uniqueItems:true,items:{type:'string'}},skillKeys:{type:'array',maxItems:20,uniqueItems:true,items:{type:'string'}},
    }}}] },
    scenes: { type: 'array', items: {
      type: 'object', required: ['id', 'phase', 'title', 'prompt', 'takeaway', 'visual', 'xDomain', 'yDomain', 'frames', 'check', 'presenterNotes'],
      properties: {
        id: text, phase: { type: 'string', enum: ['discover', 'explore', 'practice', 'challenge', 'reflect'] },
        title: text, prompt: text, takeaway: text,
        presenterNotes: {
          type: 'object', required: ['explanation', 'ask', 'expectedAnswer', 'ifStuck'],
          properties: { explanation: text, ask: text, expectedAnswer: text, ifStuck: text },
        },
        visual: { type: 'string', enum: ['quadratic', 'linear', 'number-line', 'balance', 'fraction-bar', 'right-triangle', 'function-tangent', 'steps'] },
        xDomain: numbers, yDomain: numbers,
        questionVisual: { description: 'Question-only stimulus for a single-frame check. Must be null whenever frames has more than one item. Required for fraction-bar, right-triangle and function-tangent checks; optional for other single-frame checks.', anyOf: [{type: 'null'}, { type: 'object', required: ['tex', 'caption'], properties: frameText }] },
        frames: { type: 'array', items: { type: 'object', required: ['caption', 'tex', 'values'], properties: { ...frameText, values: numbers } } },
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
  'הדגמה עם כמה frames משאירה את הפרמטרים קבועים בזמן הצגת כל שלב. מחוונים זמינים רק לפי sceneControls והכללים המצורפים להלן, שמגיעים מאותה הגדרה כמו התצוגה בפועל. מותר לבקש לשנות רק פרמטר שמופיע עבור סוג ההמחשה וההקשר המדויקים. פרמטר שנמצא בנוסחה או ב־values אינו בהכרח ניתן לשינוי; אין לבקש להפוך פתיחה אם אין מחוון לכך. בחקירה עם מחוונים ההנחיה אומרת מה לנסות ואינה מניחה שהערכים יישארו בערכי ההתחלה.',
  learningControlGuidance(),
  'כאשר לפי sceneControls אין מחוונים, אין שינוי פרמטרים חופשי: אין לבקש לקבוע חלוקה, לשנות מספר חלקים או אורכים, לגרור נקודה או להזיז משיק. בחקירה מונחית הכינו כמה frames עם נתונים ונוסחה מתאימים לכל שלב, ובקשו להפעיל את ההסבר או לעבור בין השלבים ולהשוות. עם frame יחיד מבקשים רק להתבונן ולענות, בלי להבטיח כפתורי מעבר או הפעלה.',
  'בחרו מטרה ממוקדת שאפשר להשלים בחוויה, ולא הבטחה ללמד את כל הנושא. objective מסכם רק מה שנלמד ותורגל בפועל. minutes הוא זמן עבודה בחוויה (לרוב 8–15 דקות), לא אורך השיעור הפרטי כולו.',
  'visual=quadratic: values=[a,h,k], כלומר y=a(x-h)^2+k. visual=linear: values=[m,b], כלומר y=mx+b.',
  'בפרבולה השתמשו באותיות a,h,k בכל הטקסטים והערות המורה, לא p או שמות אחרים. שמות אלה מתארים את הנוסחה; האפשרות לשנות אותם נקבעת רק לפי sceneControls. בישר השתמשו ב־m,b. צריך להיות אותו סימון בנוסחה, בהסבר, בשאלה ובמחוונים.',
  'visual=number-line: values=[value]. visual=balance: values=[coefficient,constant,total], כלומר coefficient*x+constant=total; coefficient שלם 1–6, constant בין 0 ל־12, total בין 0 ל־40.',
  'visual=fraction-bar: values=[part,whole], שניהם שלמים, 0≤part≤whole≤24 ו־whole לפחות 1. מציג חלקים שווים מתוך שלם, מתאים לשברים, אחוזים ויחסי חלק־שלם. לדוגמה 15 אחוזים אפשר להציג כ־3 מתוך 20 ולהסביר במפורש ב־tex ובכיתוב את השקילות ל־15/100; אחוז שלא ניתן לייצג בחלוקה הנתמכת מציגים ב־steps. כל frame הוא חלוקה שלמה; אין חלקי תאים בזמן מעבר.',
  'visual=right-triangle: values=[legA,legB], אורכי הניצבים חיוביים עד 100. קנה המידה אחיד בשני הכיוונים. רק הניצבים נתונים; היתר מחושב בהדגמה ומסומן ? בשאלה. מתאים לפיתגורס, לא למשולש כללי.',
  'visual=function-tangent: values=[a,b,c,t], עבור f(x)=ax^2+bx+c ומשיק בנקודה x=t. הערך המוחלט של a בין 0.1 ל־10, של b,c עד 100. נקודת ההשקה חייבת להיות בתוך טווחי הצירים. המשיק מחושב עם שיפוע 2at+b. בכל frame מוצגים רק הפונקציה, נקודת ההשקה והמשיק שלה: אין נקודה שנייה, מיתר או ישר חותך. כשמלמדים מנות הפרשים או חישובי גבול, הציגו את החישובים ב־steps; אל תבטיחו שהגרף מדגים מיתרים שאינו מצייר. אין נגזרת כללית או קוד.',
  'בכל check של שלוש ההמחשות החדשות חובה questionVisual={tex,caption}: נוסחת נתונים בלבד וכיתוב שאלה בלבד, בלי התשובה, חישוב ביניים פתור או נוסחת פתרון. frame יחיד מכיל את נתוני השאלה. היתר/שבר כתוב/שיפוע לא מסומנים מספרית בשאלה; ההמחשה עצמה נשארת נתון. פתרון והסבר נשמרים ב־frames ובמשוב ההצלחה. אין להכניס תשובה לכותרת או להנחיה.',
  'בכל סוג המחשה, questionVisual שאינו null מותר רק כשיש check ו־frame יחיד. בהסבר מודרך, תרגול מודרך או סיכום עם כמה frames קובעים questionVisual=null; אין לשלב גירוי שאלה בלבד עם כמה שלבי פתרון. בסצנת challenge ובכל graph-target עדיין חובה frame יחיד, גם בלי questionVisual.',
  'בהמחשות החדשות tex הוא ההסבר המתמטי שכתבתם לפי נתוני frame, למשל שקילות שברים או פיתגורס. הוא מוצג בהדגמה; בשאלה מוצג questionVisual.tex בלבד. אל תסמכו על נוסחה אוטומטית כדי ללמד שלבי חישוב.',
  'visual=steps: values=[]; הצג/הציגי את התרגיל הפתור בצעדים מתמטיים, לא בבולטים. לשברים ולחלק־שלם העדיפו fraction-bar, לפיתגורס right-triangle ולפונקציה ריבועית עם משיק function-tangent. השתמש/י ב־steps כשאין ייצוג מספרי מתאים או כשמלמדים פעולות אלגבריות. אין להמציא גרף לנושא שאינו גרפי.',
  'כאשר מלמדים שינוי בצורת הכתיבה, למשל השלמה לריבוע, חובה visual=steps ולהציג גם את פעולת הביניים שמסבירה את המעבר. quadratic ו־linear מציגים נוסחה שמחושבת מהפרמטרים, ולכן אינם מיועדים להחלפת נוסחאות שקולות באותם values. אל תקפצו מהתרגיל ישר לתוצאה.',
  'גם הצבה וחישוב ערך פונקציה מציגים ב־steps עם התרגיל והחישוב, ולא כגרף שנשאר ללא שינוי. בגרף linear מסומנת נקודת החיתוך עם ציר y בלבד; אין להבטיח שנקודה אחרת תסומן.',
  'xDomain ו־yDomain הם [min,max] בטווח סביר, ורוחב כל טווח עד 100. קודקודים ונקודות חשובות חייבים להיכנס לגרף.',
  'לפחות שתי סצנות עם check, ובהן אחת phase=challenge: שאלה ללא עזרים, שלא משכפלת את הדוגמה הפתורה.',
  'check.kind=choice: options מכיל 2–4 תשובות שונות ו־answer הוא האינדקס הנכון. number: answer הוא מספר, השאלה מבקשת ערך מספרי יחיד, לא ביטוי חופשי. graph-target: רק quadratic/linear, answer הוא מערך הפרמטרים הרצוי, כולם שלמים בין מינוס 5 ל־5, ומקדם הפרבולה שונה מאפס.',
  'ב־graph-target בודקים התאמה של כל הגרף: מיקום, פתיחה וכיוון, לא רק קודקוד. השאלה והמשוב חייבים לומר זאת. בגרף מוצג קו יעד מקווקו; אין להבטיח נקודת יעד מסומנת או עזר שלא קיים בתבנית.',
  'ההנחיה והבדיקה מתמקדות רק בפרמטרים שנלמדו בפועל. בשיעור הזזות y=(x-h)^2+k שבו הפתיחה קבועה והשפעת a לא נלמדה, graph-target מבקש לשנות רק h,k ולשמור על הפתיחה; a=1 גם ב־frame ההתחלתי וגם בתשובת היעד. אין לבקש לשנות a אלא אם השפעתו על הפתיחה נלמדה במפורש קודם.',
  'לכל check יש 1–3 hints מדורגים, success שמסביר את ההצלחה, ו־retry שמכוון לטעות סבירה. אין פתרון בתוך נוסח השאלה.',
  'לאחר תשובה נכונה התלמידים מקבלים את המשוב שב־check.success; שלבי הפתרון המקוריים ב־frames שהוסתרו בשאלה אינם נשלחים מחדש. הסבר פתרון כתוב שמיועד לתלמידים אחרי ההצלחה צריך להיות ב־check.success. הערות המורה יכולות להנחות הסבר בעל פה, אך אין להבטיח שרשרת צעדי פתרון אוטומטית על הלוח.',
  'בסצנות שאינן בודקות תשובה check=null. בשדות prose עטוף/עטפי נוסחאות ב־\\( ו־\\); בשדה tex כתוב/כתבי נוסחה בלבד בלי עוטפים.',
  'KaTeX נבדק במצב strict: בשדה tex ובתוך נוסחאות מותרת מתמטיקה בלבד. עברית וסימן שקל ₪ נשארים ב־caption או בטקסט שמחוץ לנוסחה; גם בתוך \\text{} אין להכניס עברית או ₪. יחידות כתבו במילים מחוץ לנוסחה. אחוז בתוך נוסחה כותבים \\% ולא % חשוף. לדוגמה tex="200 \\times 0.15 = 30", וה־caption מסביר שזו הנחה של 30 שקלים.',
  'הסצנה הראשונה היא discover והאחרונה reflect. בסצנת challenge ובכל graph-target יש frame יחיד של שאלה, בלי פתרון נתון; ב־graph-target נקודת ההתחלה שונה מהמטרה.',
  'הנוסחה בכל frame חייבת לתאר בדיוק את values שלו. בשלב challenge הפתרון מוסתר עד לפתרון; questionVisual מציג רק נתונים, וב־graph-target רק גרף היעד גלוי.',
];
