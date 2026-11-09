/** Trusted, versioned source catalogue. Model output can reference IDs; it cannot add records. */
import {createHash} from 'node:crypto';
import type {TeachingContext} from '../../learning/teaching.ts';
export interface OfficialQuestion {
 id:string;authority:'moe'|'rama';url:string;year:number;session:string;questionnaire:string;
 programme:string;track:string;topics:string[];page:number;question:string;subparts:string;
 pageSize:[number,number];crop:[number,number,number,number];documentSha256:string;
 transcript:string;accessibleText:string;kind:'official'|'adapted';
 use:'excerpt'|'link-only';verification:{source:string;math:string;verifiedBy:string;date:string};
 /** Private independent verification, never included in source captions. */
 answer:string;
}
// Standalone adaptation of one short subpart; the full paper is linked, not republished.
// Checked against rendered page 3, not its scrambled PDF text layer.
const CATALOGUE:ReadonlyArray<OfficialQuestion>=[{
 id:'moe-2025b-35571-1c2',authority:'moe',url:'https://meyda.education.gov.il/sheeloney_bagrut/2025/8/HEB/35571.pdf',
 year:2025,session:'קיץ, מועד ב',questionnaire:'35571',programme:'math-5u',track:'5',topics:['אינטגרל','אינטגרלים','שטח פולינום'],
 page:3,question:'1',subparts:'ג(2)',pageSize:[595.276,841.89],crop:[60,82,495,283],
 documentSha256:'e517aa2e2fa17fcc73306e6706c85f5b3196bdf2a5a5b810e0a738bb42a5b784',
 transcript:'נתונה הפונקצייה \\(g(x)=x^4(x+1)\\). חשבו את השטח המוגבל על ידי גרף הפונקצייה ועל ידי ציר ה־\\(x\\).',
 accessibleText:'פולינום ממעלה חמש. נקודות האפס הן מינוס אחת ואפס. אין תרשים מקורי נדרש לסעיף זה.',
 kind:'adapted',use:'excerpt',answer:'1/30',verification:{
  source:'Rendered official page 3: g(x)=x^n(x+1), subpart c(2) sets n=4. Standalone stem substituted; no original diagram needed.',
  math:'g>=0 on [-1,0]; integral(x^5+x^4)=[x^6/6+x^5/5] from -1 to 0 = 1/30. Checked independently of the generator.',
  verifiedBy:'codex-rendered-page-and-symbolic-check',date:'2026-11-09'
 }
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
export function resolveOfficialQuestions(context:TeachingContext,options:{requiredQuestionId?:string;usedQuestionIds?:string[]}={}):{questions:OfficialQuestion[];status:'verified'|'authored-fallback'|'unresolved';reason?:string}{
 const required=options.requiredQuestionId??context.requiredQuestionId;
 const fit=(q:OfficialQuestion)=>/5/.test(context.track??'')&&(!context.questionnaire||context.questionnaire.split(/[, ·]+/).includes(q.questionnaire))&&(!context.curriculum||context.curriculum.startsWith(q.programme))&&q.topics.some(t=>(context.skill+' '+context.request).includes(t));
 const found=CATALOGUE.filter(q=>(required?q.id===required:!options.usedQuestionIds?.includes(q.id))&&fit(q));
 return found.length?{questions:structuredClone(found.slice(0,1)),status:'verified'}:{questions:[],status:required?'unresolved':'authored-fallback',reason:required?'השאלה המבוקשת אינה מאומתת או אינה מתאימה לפרופיל':'אין במאגר שאלה רשמית מתאימה; יש ליצור תרגול מקורי ולסמן זאת'};
}
/** Student-safe provenance allowlist. No transcript solution, verification notes or private context. */
export function sourceCaption(id:string){const q=officialQuestion(id);return q?{id:q.id,url:q.url,label:`${q.kind==='adapted'?'עיבוד של שאלה':'שאלה מקורית'} · משרד החינוך · ${q.year} · ${q.session} · שאלון ${q.questionnaire} · שאלה ${q.question} ${q.subparts}`,page:q.page}:null;}
