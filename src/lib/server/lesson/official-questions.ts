/** Trusted, versioned source catalogue. Model output can reference IDs; it cannot add records. */
import {createHash} from 'node:crypto';
import type {TeachingContext} from '../../learning/teaching.ts';
import questionAssets from './official-question-assets.json' with {type:'json'};
export interface OfficialQuestion {
 id:string;authority:'moe'|'rama';url:string;year:number;session:string;questionnaire:string;
 programme:string;track:string;grades:string[];topics:string[];page:number;question:string;subparts:string;
 pageSize:[number,number];crop:[number,number,number,number];documentSha256:string;
 transcript:string;accessibleText:string;kind:'official'|'adapted';
 use:'excerpt'|'link-only';verification:{source:string;math:string;verifiedBy:string;date:string};
 /** Private independent verification, never included in source captions. */
 answer:string;
 /** Multi-part visual authoring has its own contract; the legacy numeric generator cannot solve this record. */
 visualOnly?:boolean;answers?:Record<string,string>;
}
// Standalone adaptation of one short subpart; the full paper is linked, not republished.
// Checked against rendered page 3, not its scrambled PDF text layer.
const CATALOGUE:ReadonlyArray<OfficialQuestion>=[{
 id:'moe-2025b-35571-1c2',authority:'moe',url:'https://meyda.education.gov.il/sheeloney_bagrut/2025/8/HEB/35571.pdf',
 year:2025,session:'קיץ, מועד ב',questionnaire:'35571',programme:'math-5u',track:'5',grades:['כיתה יא','כיתה יב'],topics:['אינטגרל','אינטגרלים','שטח פולינום'],
 page:3,question:'1',subparts:'ג(2)',pageSize:[595.276,841.89],crop:[60,82,495,283],
 documentSha256:'e517aa2e2fa17fcc73306e6706c85f5b3196bdf2a5a5b810e0a738bb42a5b784',
 transcript:'נתונה הפונקצייה \\(g(x)=x^4(x+1)\\). חשבו את השטח המוגבל על ידי גרף הפונקצייה ועל ידי ציר ה־\\(x\\).',
 accessibleText:'פולינום ממעלה חמש. נקודות האפס הן מינוס אחת ואפס. אין תרשים מקורי נדרש לסעיף זה.',
 kind:'adapted',use:'excerpt',answer:'1/30',verification:{
  source:'Rendered official page 3: g(x)=x^n(x+1), subpart c(2) sets n=4. Standalone stem substituted; no original diagram needed.',
  math:'g>=0 on [-1,0]; integral(x^5+x^4)=[x^6/6+x^5/5] from -1 to 0 = 1/30. Checked independently of the generator.',
  verifiedBy:'codex-rendered-page-and-symbolic-check',date:'2026-11-09'
 }
},{
 id:'moe-2025a-35372-3',authority:'moe',url:'https://meyda.education.gov.il/sheeloney_bagrut/2025/6/HEB/35372.pdf',year:2025,session:'קיץ',questionnaire:'35372',programme:'math-3u',track:'3',grades:['כיתה יא','כיתה יב'],topics:['התפלגות נורמלית'],page:8,question:'3',subparts:'א–ד',pageSize:[623.6220092773438,870.2360229492188],crop:[78,151,470,417],documentSha256:'11823e215717c0e9f572aace6ca4bb6f9db19bd4ed8ca8995b2541413cab81f8',
 transcript:'בבית ספר מסוים נערך מבחן במתמטיקה. הציונים במבחן מתפלגים נורמלית וסטיית התקן היא 8. נתון כי הציון של 93% מן התלמידים שנבחנו במתמטיקה נמוך מ־84.\nא(1) מצאו את ממוצע הציונים במבחן במתמטיקה. א(2) השלימו במלבנים הריקים בגרף את הציונים במבחן.\nהתלמידים שהציון שלהם גבוה מ־80 התקבלו ללימודי העשרה במתמטיקה. ב. מהו אחוז התלמידים שהתקבלו ללימודי ההעשרה?\nנתון כי הציון של 32 תלמידים גבוה מ־80. ג. על פי גרף ההתפלגות הנורמלית, כמה תלמידים נבחנו במתמטיקה?\nעמית נבחן במתמטיקה. ציון התקן שלו במבחן הוא 1.75. ד. מהו הציון של עמית במבחן?',
 accessibleText:'תרשים התפלגות נורמלית בית־ספרי, עם 11 מלבנים ריקים על הציר. אחוזי הרצועות ממרכז העקומה לכל צד: 19, 15, 9, 5, 1.5, 0.5. התרשים המקורי מופיע בתמונת השאלה.',kind:'official',use:'excerpt',answer:'72',visualOnly:true,answers:{a1:'72',a2:'52,56,60,64,68,72,76,80,84,88,92',b:'16',c:'200',d:'86'},verification:{source:'Official page8 rendered and compared with the reference; complete question and diagram crop excludes blank answer grid.',math:'School diagram: 93%=50+19+15+9 identifies +1.5s; mean84-1.5*8=72. Half-step4 gives axis52..92. Above80 is16%;32/.16=200.72+1.75*8=86.',verifiedBy:'rendered-original-and-independent-exact-arithmetic',date:'2026-11-10'}
}];
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
export function verifyImport(q:OfficialQuestion,pdf:Uint8Array):void{
 const [x,y,w,h]=q.crop??[],[pw,ph]=q.pageSize??[];
 if(![x,y,w,h,pw,ph].every(Number.isFinite)||x<0||y<0||w<=0||h<=0||x+w>pw||y+h>ph)throw new Error('crop outside page');
 const trusted=CATALOGUE.find(c=>c.id===q.id);
 if(!trusted||JSON.stringify(q)!==JSON.stringify(trusted))throw new Error('unapproved verification record');
 if(pdf.byteLength>12_000_000||Buffer.from(pdf.slice(0,5)).toString()!=='%PDF-'||hash(pdf)!==q.documentSha256)throw new Error('document hash mismatch');
}
export function officialQuestion(id:string):OfficialQuestion|null{
 if(!/^[a-z0-9-]{1,80}$/.test(id))return null;
 const q=CATALOGUE.find(c=>c.id===id);return q?structuredClone(q):null;
}
/** A supplied link is not readable evidence. Never let the engine guess its contents. */
export function suppliedSourceIntent(request:string):'required'|'optional'|undefined{
 if(!/https?:\/\/\S+/i.test(request)&&!CATALOGUE.some(q=>request.includes(q.id)))return undefined;
 const clauses=request.split(/\.(?=\s|$)|[;!\n]|(?=\s+ו(?:אם|אפשר|כדאי|הוסיפו|פתרו|השתמשו))|\s+and\s+(?=(?:if|optionally|add|solve|use)\b)/iu);
 const sourceClauses=clauses.filter(c=>/https?:\/\/\S+/i.test(c)||CATALOGUE.some(q=>c.includes(q.id)));
 return sourceClauses.every(c=>/if\s+(?:available|possible)|when\s+available|optional|במידת האפשר|להעשרה|להשראה|לא חובה|אופציונלי|אם[\s\S]{0,30}(?:זמין|אפשר)/iu.test(c))?'optional':'required';
}
export function suppliedQuestionId(request:string,intent=suppliedSourceIntent(request)):string|undefined{
 if(intent==='optional')return undefined;
 return CATALOGUE.find(q=>request.includes(q.id))?.id??(/https?:\/\/\S+/i.test(request)?'unresolved-supplied-question':undefined);
}
export function resolveOfficialQuestions(context:TeachingContext,options:{requiredQuestionId?:string;usedQuestionIds?:string[]}={}):{questions:OfficialQuestion[];status:'verified'|'authored-fallback'|'unresolved';reason?:string}{
 const required=options.requiredQuestionId??context.requiredQuestionId;
 const fit=(q:OfficialQuestion)=>q.grades.includes((context.grade??'').replace(/["״׳']/g,''))&&/5/.test(context.track??'')&&(!context.questionnaire||context.questionnaire.split(/[, ·]+/).includes(q.questionnaire))&&(!context.curriculum||context.curriculum.startsWith(q.programme))&&q.topics.some(t=>(context.skill+' '+context.request).includes(t));
 const found=CATALOGUE.filter(q=>!q.visualOnly&&(required?q.id===required:!options.usedQuestionIds?.includes(q.id))&&fit(q));
 return found.length?{questions:structuredClone(found.slice(0,1)),status:'verified'}:{questions:[],status:required?'unresolved':'authored-fallback',reason:required?'השאלה המבוקשת אינה מאומתת או אינה מתאימה לפרופיל':'אין במאגר שאלה רשמית מתאימה; יש ליצור תרגול מקורי ולסמן זאת'};
}
/** Student-safe provenance allowlist. No transcript solution, verification notes or private context. */
export function sourceCaption(id:string){const q=officialQuestion(id);return q?{id:q.id,url:q.url,label:`${q.kind==='adapted'?'עיבוד של שאלה':'שאלה מקורית'} · משרד החינוך · ${q.year} · ${q.session} · שאלון ${q.questionnaire} · שאלה ${q.question} ${q.subparts}`,page:q.page}:null;}
export function officialQuestionAsset(id:string){
 const q=officialQuestion(id),asset=(questionAssets as Record<string,{documentSha256:string;imageSha256:string;image:string}>)[id];
 if(!q||!asset||asset.documentSha256!==q.documentSha256)return null;
 const bytes=Buffer.from(asset.image.split(',')[1]??'','base64');
 if(hash(bytes)!==asset.imageSha256)throw new Error('official image hash mismatch');
 return {...asset};
}
