/** Native draft authoring. Office packages are converted atomically; existing native files are never patched. */
import {createHash} from 'node:crypto';
import rendererManifest from './renderer-manifest.json' with {type:'json'};
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import PptxGenJS from 'pptxgenjs';
import sharp from 'sharp';
import {Document,Packer,Paragraph,TextRun,ImageRun,ExternalHyperlink,HeadingLevel} from 'docx';
import {mathjax} from 'mathjax-full/js/mathjax.js';
import {TeX} from 'mathjax-full/js/input/tex.js';
import {SVG} from 'mathjax-full/js/output/svg.js';
import {liteAdaptor} from 'mathjax-full/js/adaptors/liteAdaptor.js';
import {RegisterHTMLHandler} from 'mathjax-full/js/handlers/html.js';
import {AllPackages} from 'mathjax-full/js/input/tex/AllPackages.js';
import {DECK_PALETTE,BRAND_LOGO_SRC} from '../../brand.ts';
import {normalVisual} from '../../learning/deck/normal.ts';
import {publicVisualLesson,visualLessonProblems,type VisualLesson,type NormalModel} from '../../learning/deck/model.ts';
import {officialQuestion,officialQuestionAsset,sourceCaption} from '../lesson/official-questions.ts';
import {centralDriveApi,centralFileUrl,DOC,SLIDES,type CentralAccess,type CentralFile} from '../central-drive/api.ts';

const EXPORT_VERSION='native-review-v1';
const PPTX='application/vnd.openxmlformats-officedocument.presentationml.presentation';
const DOCX='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const adaptor=liteAdaptor();RegisterHTMLHandler(adaptor);
const maths=mathjax.document('',{InputJax:new TeX({packages:AllPackages}),OutputJax:new SVG({fontCache:'none'})});
const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
const colour=(key:string)=>DECK_PALETTE[key].slice(1);
export interface NativeActivity {id:string;title:string;url:string}
export interface NativeBundleInput {bundle:VisualLesson;key?:string;title?:string;activityBaseUrl:string}
export interface NativeBundleReceipt {version:1;state:'draft';sourceHash:string;reviewFolderId:string;slides:{id:string;url:string;mimeType:string};notesLocation:'slides';homework:{id:string;url:string;mimeType:string};activities:NativeActivity[];slideCount:number}

async function png(svg:string){return sharp(Buffer.from(svg.replace(/(\sdata-[\w-]+)(?=[\s>])/g,'$1=""'))).resize({width:1800,withoutEnlargement:false}).png().toBuffer();}
async function formula(tex:string){
 const node=maths.convert(tex,{display:true});const svg=adaptor.innerHTML(node);
 if(svg.includes('data-mjx-error'))throw Error('native_math');
 return png(svg);
}
const data=(b:Buffer)=>`data:image/png;base64,${b.toString('base64')}`;
const chunks=(text:string)=>text.split(/(\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$)/g).filter(Boolean).map(s=>{const math=/^\\[([]|^\$\$/.test(s);return {math,value:math?s.slice(2,-2):s};});

interface NativeTextPart {value:string;math:boolean;x:number;y:number;w:number;h:number;fontSize:number}
const textWidths=new Map<string,number>();
async function measuredTextWidth(value:string,fontSize:number){
 const key=`${fontSize}:${value}`;let width=textWidths.get(key);if(width!==undefined)return width;
 const escaped=value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
 const metrics=await sharp({text:{text:escaped,font:`Heebo ${fontSize}`,fontfile:path.join(process.cwd(),'static/learning-assets/native-fonts/Heebo.ttf'),dpi:72}}).metadata();
 width=(metrics.width??0)*1.10/72+.025;textWidths.set(key,width);return width;
}
/** Measure Heebo glyphs before authoring. Each native run is one line; Slides need not honour Office autofit. */
export async function layoutNativeText(text:string,box:{x:number;y:number;w:number;h:number},preferredSize=25):Promise<NativeTextPart[]>{
 if(!text.trim())return [];
 const tokens=chunks(text).flatMap(part=>part.math?[{value:part.value,math:true}]:part.value.split(/(\n)/).flatMap(value=>value==='\n'?[{value,math:false}]:value.split(/\s+/).filter(Boolean).map(value=>({value,math:false}))));
 const imageRatios=new Map<string,number>();for(const token of tokens)if(token.math){const bytes=await formula(token.value);imageRatios.set(token.value,bytes.readUInt32BE(16)/bytes.readUInt32BE(20));}
 for(let size=preferredSize;size>=11;size--){
  const gap=size*.30/72,lineHeight=size*1.6/72;let row=0,used=0,failed=false;const rows:NativeTextPart[][]=[[]];
  for(const token of tokens){
   if(token.value==='\n'){row++;used=0;rows.push([]);continue;}
   const mathHeight=size*(/\\frac|\\begin/.test(token.value)?1.5:1.05)/72;
   const width=token.math?mathHeight*imageRatios.get(token.value)!:await measuredTextWidth(token.value,size);
   if(width>box.w){failed=true;break;}
   if(used&&used+gap+width>box.w){row++;used=0;rows.push([]);}
   const space=used?gap:0;rows[row].push({value:token.value,math:token.math,x:box.x+box.w-used-space-width,y:box.y+row*lineHeight,w:width,h:lineHeight,fontSize:size});used+=space+width;
  }
  if(failed||rows.length*lineHeight>box.h+.0001)continue;
  const result:NativeTextPart[]=[];
  for(const line of rows)for(const part of line){const last=result.at(-1);if(last&&!last.math&&!part.math&&last.y===part.y){last.value+=' '+part.value;last.w=last.x+last.w-part.x;last.x=part.x;}else result.push({...part});}
  return result;
 }
 throw Error('native_text_overflow');
}

/** Notes are plain text in Presenter View; preserve unknown TeX rather than inventing speech. */
function notesText(text:string){
 return chunks(text).map(part=>{if(!part.math)return part.value;let value=part.value.replace(/\\bar\{x\}/g,'x̄').replace(/\\(?:text|mathrm)\{([^{}]*)\}/g,'$1');
  for(let i=0;i<8&&/\\frac\{([^{}]*)\}\{([^{}]*)\}/.test(value);i++)value=value.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g,'($1)/($2)');
  return value.replace(/\\(?:left|right)\b/g,'').replace(/\\(mu|sigma|cdot|times|leq|geq|pm|%)(?![a-z])/g,(_,name:string)=>({mu:'μ',sigma:'σ',cdot:'·',times:'×',leq:'≤',geq:'≥',pm:'±','%':'%'}[name]!));
 }).join('');
}
function nativeSpeakerNotes(bundle:VisualLesson,sceneIndex:number,stage:number,reveal:number,modelStage:number,total:number){
 const scene=bundle.slides[sceneIndex],n=scene.presenterNotes,last=stage===total-1;
 const visible=scene.blocks.filter(b=>b.reveal<=reveal).flatMap(b=>b.model?[normalVisual(b.model,modelStage,'notes').caption]:b.type==='source'?['השאלה הרשמית המקורית']:b.text?[b.text]:[]);
 const task=bundle.tasks.find(t=>t.id===scene.taskId);
 const sections=[scene.title,`סצנה ${sceneIndex+1} · צעד ${stage+1} מתוך ${total}`,`זמן לסצנה כולה: ${n.minutes} דקות — לא לכל צעד.`,
  `מה רואים כעת: ${task?[task.givens,task.prompt].join(' '):visible.join(' | ')||scene.prompt}`,
  'בהסבר ובשאלות התייחסו רק למה שכבר נחשף. עצרו לחיזוי לפני מעבר לשלב הבא.',
  `מה אומרים: ${n.explanation}`,`עוצרים ושואלים: ${n.ask}`,`למה מקשיבים — תשובה למורה: ${n.expectedAnswer}`,`אם נתקעים: ${n.ifStuck}`,`טעות שכדאי לזהות: ${n.misconception}`,
  last?`המעבר הבא: ${n.transition}`:'הצעד הבא: המשיכו בלחיצה לחשיפה הבאה באותה סצנה; אל תעברו עדיין לנושא הבא.',
  ...(task?[`פתרון הבדיקה — למורה בלבד: ${task.solution}`]:[]),
  ...bundle.sourceSolutions.filter(solution=>solution.slideId===scene.id).map(solution=>`פתרון מקור ${solution.questionId}, סעיף ${solution.part}: ${solution.answer}`),
  ...(n.sources??[]).flatMap(id=>{const caption=sourceCaption(id);return caption?[`${caption.label}: ${caption.url}`]:[]}),
 ];
 if(sceneIndex===0&&stage===0)sections.push('תכנון השיעור',...bundle.agenda.map(a=>`${a.title}: ${a.minutes} דקות`));
 if(sceneIndex===bundle.slides.length-1&&last)sections.push('מפתח פרטי לתרגול הבית ולמשחקים — לא להקריא ולא לשתף לתלמיד',...[...bundle.homework,...bundle.games.flatMap(g=>g.rounds)].flatMap(t=>[t.title,t.givens,t.prompt,`פתרון: ${t.solution}`]));
 return notesText(sections.join('\n\n'));
}

/** Identity pins the checked renderer/dependencies, complete private source and activity destination. */
export async function exportNativeBundle(input:NativeBundleInput){
 const {bundle}=input;const base=new URL(input.activityBaseUrl);
 if(base.protocol!=='https:'||base.username||base.password||!base.pathname.startsWith('/app/'))throw Error('native_activity_url');
 const sourceAnswers:Record<string,Record<string,string>>={};
 for(const id of new Set(bundle.slides.flatMap(s=>s.blocks.flatMap(b=>b.sourceId?[b.sourceId]:[])))){const q=officialQuestion(id);if(!q?.answers)throw Error('native_source');sourceAnswers[id]=q.answers;}
 const problems=visualLessonProblems(bundle,{sourceAnswers});if(problems.length)throw Error('native_bundle_schema: '+problems.join('; '));
 const title=input.title??bundle.title;
 const sourceHash=digest(JSON.stringify({version:EXPORT_VERSION,rendererHash:rendererManifest.rendererHash,bundle,title,activityBaseUrl:base.href}));
 const url=(params:Record<string,string>)=>{const u=new URL(base);for(const [k,v]of Object.entries(params))u.searchParams.set(k,v);return u.href;};
 const activities=[{id:'homework',title:'תרגול אינטראקטיבי לבית',url:url({view:'homework'})},...bundle.games.map(g=>({id:g.id,title:g.title,url:url({view:'game',game:g.id})}))];
 const pptx=new PptxGenJS();pptx.layout='LAYOUT_WIDE';pptx.author='MeaBeclick';pptx.subject='טיוטה לבדיקה — ללא פרסום לתלמיד';pptx.title=title;
 pptx.theme={headFontFace:'Heebo',bodyFontFace:'Heebo'};
 const logo=await png(await readFile(path.join(process.cwd(),'static',BRAND_LOGO_SRC.split('?')[0]),'utf8'));
 async function addText(slide:PptxGenJS.Slide,text:string,x:number,y:number,w:number,h:number,size=25){
  for(const part of await layoutNativeText(text,{x,y,w,h},size)){
   if(part.math){const bytes=await formula(part.value);slide.addImage({data:data(bytes),...pptxgenImageContain(bytes,part.x,part.y,part.w,part.h)});}
   else slide.addText(part.value,{x:part.x,y:part.y,w:part.w,h:part.h,fontFace:'Heebo',fontSize:part.fontSize,color:colour('text'),rtlMode:true,align:'right',valign:'middle',wrap:false,margin:0});
  }
 }
 function pptxgenImageContain(bytes:Buffer,x:number,y:number,w:number,h:number){const iw=bytes.readUInt32BE(16),ih=bytes.readUInt32BE(20),scale=Math.min(w/iw,h/ih);return {x:x+(w-iw*scale)/2,y:y+(h-ih*scale)/2,w:iw*scale,h:ih*scale};}
 async function model(slide:PptxGenJS.Slide,m:NormalModel,stage:number,x:number,y:number,w:number,h:number,comparison:NormalModel[]=[]){const v=normalVisual(m,stage,'native',{},comparison);slide.addImage({data:data(await png(v.svg)),x,y,w,h:h-.65});await addText(slide,v.caption,x,y+h-.6,w,.25,13);if(v.formula){const bytes=await formula(v.formula);slide.addImage({data:data(bytes),...pptxgenImageContain(bytes,x,y+h-.3,w,.3)});}}
 const slideMap:Array<{sceneId:string;title:string;firstSlide:number;lastSlide:number}>=[];const speakerNotes:string[]=[];let slideCount=0;
 for(const [sceneIndex,original]of publicVisualLesson(bundle).slides.entries()){
  const firstSlide=slideCount+1;
  const maxReveal=Math.max(0,...original.blocks.map(b=>b.reveal));const states=Math.max(1,...original.blocks.map(b=>b.model?.states.length??1));
  // Each authored build is a separate editable slide, preserving learner-paced progressive disclosure.
  for(let stage=0;stage<=maxReveal+states-1;stage++){
   const reveal=Math.min(stage,maxReveal),modelStage=Math.max(0,stage-maxReveal);const slide=pptx.addSlide();slideCount++;slide.background={color:colour('bg')};
   const notes=nativeSpeakerNotes(bundle,sceneIndex,stage,reveal,modelStage,maxReveal+states);slide.addNotes(notes);speakerNotes.push(notes);
   slide.addText(original.kicker,{x:.6,y:.3,w:12.1,h:.25,fontSize:13,color:colour('brand'),rtlMode:true,align:'right'});
   await addText(slide,original.title,.6,.75,12.1,.65,30);await addText(slide,original.prompt,.6,1.5,12.1,.7,20);
   for(const [i,a]of activities.entries())slide.addText(a.title+' ↗',{x:1+i*3.8,y:6.85,w:3.5,h:.2,fontFace:'Heebo',fontSize:10,color:colour('brand'),rtlMode:true,align:'right',hyperlink:{url:a.url}});
   slide.addImage({data:data(logo),...pptxgenImageContain(logo,.6,7.02,.4,.3)});slide.addText(`${slideCount} · נושא ${sceneIndex+1}/${bundle.slides.length} · צעד ${stage+1}/${maxReveal+states} · ${title}`,{x:1,y:7,w:11.7,h:.3,fontSize:10,color:colour('muted'),rtlMode:true,align:'right'});
   if(original.taskId){const t=publicVisualLesson(bundle).tasks.find(t=>t.id===original.taskId)!;await addText(slide,t.givens,.7,2.4,11.9,.65,21);await addText(slide,t.prompt,.7,3.1,11.9,.7,24);if(t.model)await model(slide,t.model,0,.8,4,8,2.7);if(t.check?.options.length)await addText(slide,t.check.options.join('\n'),9,4,3,2.4,21);continue;}
   const blocks=original.blocks.filter(b=>b.reveal<=reveal);const models=original.blocks.filter(b=>b.model),hasVisual=models.length>0||original.blocks.some(b=>b.type==='source');
   const texts=original.blocks.filter(b=>b.type!=='model'&&b.type!=='source');
   const two=models.length>1;const split=hasVisual&&texts.length>0;
   let visualAt=0;
   for(const b of blocks){
    if(b.model){const w=two?5.9:split?7.4:11.9,x=two?.7+visualAt*6.1:.7;await model(slide,b.model,modelStage,x,two&&split?3.65:2.4,w,two&&split?2.95:4.2,original.layout==='compare'?models.flatMap(b=>b.model?[b.model]:[]):[]);if(b.text)await addText(slide,b.text,x,two&&split?3.35:2.12,w,.3,15);visualAt++;}
    else if(b.type==='source'&&b.sourceId){const asset=officialQuestionAsset(b.sourceId),caption=sourceCaption(b.sourceId);if(!asset||!caption)throw Error('native_source');slide.addImage({data:asset.image,...pptxgenImageContain(Buffer.from(asset.image.split(',')[1],'base64'),.7,2.35,split?7.4:11.9,4.05)});slide.addText(caption.label,{x:.7,y:6.55,w:11.9,h:.27,fontSize:11,color:colour('muted'),rtlMode:true,align:'right',hyperlink:{url:caption.url}});}
    else{const x=two?.9:split?8.5:.9,w=two?11.5:split?3.8:11.5,h=two?.45:4.15/Math.max(1,texts.length)-.15,y=(two?2.3:2.45)+texts.indexOf(b)*(h+.15);if(b.type==='equation'){const bytes=await formula(b.text);slide.addImage({data:data(bytes),...pptxgenImageContain(bytes,x,y,w,h)});}else await addText(slide,b.text,x,y,w,h,split?22:26);}
   }
  }
  slideMap.push({sceneId:original.id,title:original.title,firstSlide,lastSlide:slideCount});
 }
 const publicBundle=publicVisualLesson(bundle);
 const homeworkText=[title,`תרגול לבית · ${bundle.homeworkMinutes} דקות`,...publicBundle.homework.flatMap((t,i)=>[`${i+1}. ${t.title}`,t.givens,t.prompt,...(t.check?.options??[])])].join('\n');
 async function document(text:string,homework=false){const paragraphs:Paragraph[]=[new Paragraph({children:[new ImageRun({data:logo,type:'png',transformation:{width:32,height:24}})],bidirectional:true})];
  const content:Array<string|NormalModel>=homework?[title,`תרגול לבית · ${bundle.homeworkMinutes} דקות`,...publicBundle.homework.flatMap((t,i)=>[`${i+1}. ${t.title}`,t.givens,t.prompt,...(t.check?.options??[]),...(t.model?[t.model]:[]),'מקום לדרך הפתרון:','________________________________________','________________________________________'])]:text.split('\n');
  for(const [i,line]of content.entries()){if(typeof line!=='string'){const bytes=await png(normalVisual(line,0,'homework').svg);paragraphs.push(new Paragraph({children:[new ImageRun({data:bytes,type:'png',transformation:{width:540,height:240}})],bidirectional:true,keepNext:true}));continue;}const runs:Array<TextRun|ImageRun>=[];for(const part of chunks(line)){if(part.math){const bytes=await formula(part.value),meta=await sharp(bytes).metadata();runs.push(new ImageRun({data:bytes,type:'png',transformation:{width:Math.min(500,28*(meta.width??1200)/(meta.height??180)),height:28},altText:{title:part.value,description:'נוסחה מתמטית',name:'math'}}));}else runs.push(new TextRun({text:part.value,font:'Heebo',size:24,rightToLeft:true}));}paragraphs.push(new Paragraph({children:runs,bidirectional:true,heading:i===0?HeadingLevel.TITLE:/^\d+\./.test(line)?HeadingLevel.HEADING_2:undefined,keepNext:i===0||/^\d+\./.test(line)||homework&&!line.startsWith('____'),spacing:{after:120}}));}
  for(const a of activities)paragraphs.push(new Paragraph({children:[new ExternalHyperlink({link:a.url,children:[new TextRun({text:a.title,style:'Hyperlink',rightToLeft:true})]})],bidirectional:true}));
  return Packer.toBuffer(new Document({sections:[{properties:{},children:paragraphs}]}));
 }
 return {sourceHash,rendererHash:rendererManifest.rendererHash,slideCount,slideMap,slides:Buffer.from(await pptx.write({outputType:'nodebuffer'}) as Buffer),notesLocation:'slides' as const,speakerNotes,homework:await document(homeworkText,true),homeworkText,activities};
}

const running=new Map<string,Promise<NativeBundleReceipt>>();
export async function publishNativeReviewBundle(input:NativeBundleInput&{key:string},dependencies?:{access?:CentralAccess;workspace?:{workspaceId:string;reviewId:string};fetch?:typeof fetch}):Promise<NativeBundleReceipt>{
 const access=dependencies?.access??(await import('../learning-google.ts')).learningService().syncAccess();
 const workspace=dependencies?.workspace??(await import('../learning-archive.ts')).nativeWorkspace();if(!workspace)throw Error('native_workspace_required');
 if(!input.key||input.key.length>240)throw Error('native_key');
 const gate=digest(JSON.stringify([access.epoch,workspace.reviewId,input.key,input.bundle,input.activityBaseUrl,input.title]));const pending=running.get(gate);if(pending)return pending;
 const task=(async()=>{
  const output=await exportNativeBundle(input);access.assertCurrent();
  const api=centralDriveApi({access,fetch:dependencies?.fetch,checkpoint:{read:()=>null,write:()=>{}}});await api.prepare();
  await api.privateFolder(workspace.workspaceId,access.config.learningFolderId);await api.privateFolder(workspace.reviewId,workspace.workspaceId);
  const title=(input.title??input.bundle.title).slice(0,140),key=`native-review:${digest(input.key)}:${output.sourceHash}`;
  const folder=await api.folder(key,`${title} — טיוטה [${output.sourceHash.slice(0,8)}]`,workspace.reviewId);
  const file=(f:CentralFile)=>({id:f.id,url:centralFileUrl(f),mimeType:f.mimeType});
  const slides=await api.nativeImport(`${key}:slides`,`${title} — מצגת`,SLIDES,folder.id,output.slides,PPTX);
  const homework=await api.nativeImport(`${key}:homework`,`${title} — תרגול לבית ללא פתרונות`,DOC,folder.id,output.homework,DOCX);
  return {version:1 as const,state:'draft' as const,sourceHash:output.sourceHash,reviewFolderId:folder.id,slides:file(slides.file),notesLocation:'slides' as const,homework:file(homework.file),activities:output.activities,slideCount:output.slideCount};
 })();running.set(gate,task);try{return await task;}finally{running.delete(gate);}
}
