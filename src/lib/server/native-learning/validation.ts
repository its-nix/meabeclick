import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {isAbsolute,join} from 'node:path';
import {type VisualLesson,visualLessonProblems} from '../../learning/deck/model.ts';
import {nativeReviewRules} from '../../learning/deck/review-rules.ts';
import {engineBin} from '../lesson/engine.ts';
import {spawnAgent} from '../lesson/spawn.ts';
import {newFence} from '../lesson/prompt.ts';
import {officialQuestion} from '../lesson/official-questions.ts';

export interface ReviewImage {name:string;path:string;sha256:string}
export interface NativeValidation {
 version:1;status:'pass'|'revise'|'blocked';model:string;provider:'openai';session:'fresh';contentHash:string;rulesHash:string;evidenceHash:string;
 findings:Array<{severity:'blocker'|'major'|'minor';target:string;issue:string;requestedChange:string}>;
 checks:{mathCorrect:boolean;studentAnswersHidden:boolean;teachingClear:boolean;brandConsistent:boolean;visualEvidenceReviewed:boolean;feedbackAddressed:boolean};reviewedImages:string[];
}
const CHECKS=['mathCorrect','studentAnswersHidden','teachingClear','brandConsistent','visualEvidenceReviewed','feedbackAddressed'] as const;
type Payload=Pick<NativeValidation,'status'|'findings'|'checks'|'reviewedImages'>;
export interface NativeReviewRequest {prompt:string;model:string;images:ReviewImage[];schema:object;timeoutMs:number}
export interface NativeReviewDependencies {run?:(request:NativeReviewRequest)=>Promise<unknown>;timeoutMs?:number}
const hash=(text:string|Buffer)=>createHash('sha256').update(text).digest('hex');
function fail(kind:string):never{throw Object.assign(Error(kind),{kind});}
const schema={type:'object',additionalProperties:false,required:['status','findings','checks','reviewedImages'],properties:{status:{type:'string',enum:['pass','revise','blocked']},findings:{type:'array',maxItems:80,items:{type:'object',additionalProperties:false,required:['severity','target','issue','requestedChange'],properties:{severity:{type:'string',enum:['blocker','major','minor']},target:{type:'string'},issue:{type:'string'},requestedChange:{type:'string'}}}},checks:{type:'object',additionalProperties:false,required:CHECKS,properties:Object.fromEntries(CHECKS.map(k=>[k,{type:'boolean'}]))},reviewedImages:{type:'array',items:{type:'string'}}}};
function keys(value:unknown,names:readonly string[]):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(k=>Object.hasOwn(value,k));}
function checkedPayload(value:unknown,names:string[]):Payload{
 if(!keys(value,['status','findings','checks','reviewedImages']))return fail('native_review_invalid');
 const checks=value.checks;
 if(!['pass','revise','blocked'].includes(String(value.status))||!keys(checks,CHECKS)||CHECKS.some(k=>typeof checks[k]!=='boolean'))return fail('native_review_invalid');
 if(!Array.isArray(value.findings)||value.findings.length>80||value.findings.some(f=>!keys(f,['severity','target','issue','requestedChange'])||!['blocker','major','minor'].includes(String(f.severity))||['target','issue','requestedChange'].some(k=>typeof f[k]!=='string'||!f[k].trim()||f[k].length>(k==='target'?200:2000))))return fail('native_review_invalid');
 if(!Array.isArray(value.reviewedImages)||value.reviewedImages.length>128||value.reviewedImages.some(n=>typeof n!=='string'||!names.includes(n))||new Set(value.reviewedImages).size!==value.reviewedImages.length)return fail('native_review_invalid');
 if(checks.visualEvidenceReviewed===true&&(!names.length||value.reviewedImages.length!==names.length))return fail('native_review_invalid');
 if(value.status==='pass'&&(CHECKS.some(k=>checks[k]!==true)||value.findings.some(f=>f.severity!=='minor')||!names.length||value.reviewedImages.length!==names.length))return fail('native_review_invalid');
 if(value.status!=='pass'&&!value.findings.length)return fail('native_review_invalid');
 return value as unknown as Payload;
}
function imageExtension(bytes:Buffer){if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return'png';if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return'jpg';if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return'webp';return fail('native_review_evidence');}
async function runReview(request:NativeReviewRequest):Promise<unknown>{
 // Every invocation has a new private working directory and no prior conversation.
 const dir=await mkdtemp(join(tmpdir(),'mea-native-review-'));
 try{
  const schemaPath=join(dir,'schema.json'),outputPath=join(dir,'review.json'),images:ReviewImage[]=[];
  for(const [i,image] of request.images.entries()){
   const bytes=await readFile(image.path);if(hash(bytes)!==image.sha256)fail('native_review_evidence');
   const path=join(dir,`${i}.${imageExtension(bytes)}`);await writeFile(path,bytes,{mode:0o600});images.push({...image,path});
  }
  await writeFile(schemaPath,JSON.stringify(request.schema),{mode:0o600});
  const args=['exec','-C',dir,'--skip-git-repo-check','--ephemeral','--ignore-user-config','--sandbox','read-only','--disable','shell_tool','--disable','unified_exec','-c','web_search="disabled"','-c','model_reasoning_effort="high"','--model',request.model,'--output-schema',schemaPath,'-o',outputPath,...images.flatMap(image=>['--image',image.path]),'--','-'];
  await spawnAgent(engineBin(),args,request.prompt,dir,{label:'codex',timeoutMs:request.timeoutMs});
  const info=await lstat(outputPath).catch(()=>null);if(!info?.isFile()||info.isSymbolicLink()||info.size>256*1024)fail('native_review_invalid');
  try{return JSON.parse(await readFile(outputPath,'utf8'));}catch{return fail('native_review_invalid');}
 }finally{await rm(dir,{recursive:true,force:true});}
}
/** The caller owns creation/repair; this boundary makes exactly one fresh independent review. */
export async function reviewNativeCandidate(input:{bundle:VisualLesson;model:string;images:ReviewImage[];feedback?:unknown[];context?:unknown},deps:NativeReviewDependencies={}):Promise<NativeValidation>{
 if(!input||typeof input.model!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(input.model)||!Array.isArray(input.images)||input.images.length>128||input.feedback!==undefined&&!Array.isArray(input.feedback))return fail('native_review_input');
 const timeoutMs=deps.timeoutMs??300000;if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>900000)fail('native_review_input');
 let content:string,context:string;try{content=JSON.stringify(input.bundle);context=JSON.stringify({feedback:input.feedback??[],context:input.context??null});}catch{return fail('native_review_input');}
 if(!content||content.length>2*1024*1024||context.length>256*1024)fail('native_review_input');
 const model=input.model,bundle=JSON.parse(content) as VisualLesson,submittedContext=JSON.parse(context),submittedImages=input.images.map(image=>({...image}));
 const rules=nativeReviewRules(),images:ReviewImage[]=[],seen=new Set<string>();let size=0;
 for(const image of submittedImages){
  if(!image||typeof image.name!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(image.name)||seen.has(image.name)||typeof image.path!=='string'||!isAbsolute(image.path)||/[\x00-\x1f]/.test(image.path)||typeof image.sha256!=='string'||! /^[a-f0-9]{64}$/.test(image.sha256))fail('native_review_evidence');
  const info=await lstat(image.path).catch(()=>null);if(!info?.isFile()||info.isSymbolicLink()||info.size<12||info.size>8*1024*1024||(size+=info.size)>32*1024*1024)fail('native_review_evidence');
  const bytes=await readFile(image.path).catch(()=>null);if(!bytes||bytes.length!==info.size||hash(bytes)!==image.sha256)fail('native_review_evidence');imageExtension(bytes);seen.add(image.name);images.push({...image});
 }
 const trusted={version:1 as const,model,provider:'openai' as const,session:'fresh' as const,contentHash:hash(content),rulesHash:hash(rules),evidenceHash:hash(JSON.stringify({images:images.map(({name,sha256})=>({name,sha256})),context:JSON.parse(context)}))};
 const ids=new Set<string>();
 for(const row of Array.isArray(bundle?.sourceSolutions)?bundle.sourceSolutions:[])if(typeof row?.questionId==='string')ids.add(row.questionId);
 for(const slide of Array.isArray(bundle?.slides)?bundle.slides:[])for(const block of Array.isArray(slide?.blocks)?slide.blocks:[])if(typeof block?.sourceId==='string')ids.add(block.sourceId);
 const sources=[...ids].map(id=>officialQuestion(id));
 const sourceAnswers=Object.fromEntries(sources.filter(source=>source?.answers).map(source=>[source!.id,source!.answers!]));
 const invalid=visualLessonProblems(bundle,{sourceAnswers});
 if(!images.length||invalid.length)return{...trusted,status:'blocked',findings:[{severity:'blocker',target:invalid.length?'lesson':'evidence',issue:invalid.length?'The submitted lesson fails deterministic validation.':'Rendered visual evidence was not supplied.',requestedChange:invalid.length?'Correct the lesson contract before independent review.':'Render the relevant lesson surfaces and submit their verified images.'}],checks:Object.fromEntries(CHECKS.map(k=>[k,false])) as NativeValidation['checks'],reviewedImages:[]};
 if(sources.some(source=>!source))fail('native_review_input');
 const {OPEN,CLOSE}=newFence();const prompt=rules+`\nImages are attached in the manifest order below. The numbered image attachment maps to the corresponding manifest name.\n${OPEN}\n${JSON.stringify({bundle,sources,...submittedContext,evidence:images.map(({name,sha256},i)=>({attachment:i+1,name,sha256}))})}\n${CLOSE}`;
 let raw:unknown;try{raw=await(deps.run??runReview)({prompt,model,images,schema,timeoutMs});}catch(e){const kind=(e as {kind?:unknown})?.kind;return fail(typeof kind==='string'&&['engine-missing','engine-auth','engine-quota','engine-timeout','engine-failed','native_review_evidence','native_review_invalid'].includes(kind)?kind:'native_review_failed');}
 return {...trusted,...checkedPayload(raw,images.map(i=>i.name))};
}
