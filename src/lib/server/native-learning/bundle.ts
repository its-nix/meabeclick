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
export interface NativeBundleReceipt {version:1;state:'draft';sourceHash:string;reviewFolderId:string;slides:{id:string;url:string;mimeType:string};tutorNotes:{id:string;url:string;mimeType:string};homework:{id:string;url:string;mimeType:string};activities:NativeActivity[];slideCount:number}

async function png(svg:string){return sharp(Buffer.from(svg.replace(/(\sdata-[\w-]+)(?=[\s>])/g,'$1=""'))).resize({width:1800,withoutEnlargement:false}).png().toBuffer();}
async function formula(tex:string){
 const node=maths.convert(tex,{display:true});const svg=adaptor.innerHTML(node);
 if(svg.includes('data-mjx-error'))throw Error('native_math');
 return png(svg);
}
const data=(b:Buffer)=>`data:image/png;base64,${b.toString('base64')}`;
const chunks=(text:string)=>text.split(/(\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$)/g).filter(Boolean).map(s=>{const math=/^\\[([]|^\$\$/.test(s);return {math,value:math?s.slice(2,-2):s};});

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
  // Keep narrative editable. Mathematical islands are the only text rasterized.
  const parts=chunks(text);if(parts.length===1&&!parts[0].math){slide.addText(text,{x,y,w,h,fontFace:'Heebo',fontSize:size,color:colour('text'),rtlMode:true,align:'right',breakLine:false,margin:0,fit:'shrink'});return;}
  let at=y;for(const part of parts){if(!part.value.trim())continue;const ph=Math.min(h/Math.max(1,parts.length),.55);if(part.math){const bytes=await formula(part.value);slide.addImage({data:data(bytes),...pptxgenImageContain(bytes,x,at,w,ph)});}else slide.addText(part.value,{x,y:at,w,h:ph,fontSize:size,fontFace:'Heebo',rtlMode:true,align:'right',margin:0,fit:'shrink',color:colour('text')});at+=ph;}
 }
 function pptxgenImageContain(bytes:Buffer,x:number,y:number,w:number,h:number){const iw=bytes.readUInt32BE(16),ih=bytes.readUInt32BE(20),scale=Math.min(w/iw,h/ih);return {x:x+(w-iw*scale)/2,y:y+(h-ih*scale)/2,w:iw*scale,h:ih*scale};}
 async function model(slide:PptxGenJS.Slide,m:NormalModel,stage:number,x:number,y:number,w:number,h:number,comparison:NormalModel[]=[]){const v=normalVisual(m,stage,'native',{},comparison);slide.addImage({data:data(await png(v.svg)),x,y,w,h:h-.65});await addText(slide,v.caption,x,y+h-.6,w,.25,13);if(v.formula){const bytes=await formula(v.formula);slide.addImage({data:data(bytes),...pptxgenImageContain(bytes,x,y+h-.3,w,.3)});}}
 const slideMap:Array<{sceneId:string;title:string;firstSlide:number;lastSlide:number}>=[];let slideCount=0;
 for(const [sceneIndex,original]of publicVisualLesson(bundle).slides.entries()){
  const firstSlide=slideCount+1;
  const maxReveal=Math.max(0,...original.blocks.map(b=>b.reveal));const states=Math.max(1,...original.blocks.map(b=>b.model?.states.length??1));
  // Each authored build is a separate editable slide, preserving learner-paced progressive disclosure.
  for(let stage=0;stage<=maxReveal+states-1;stage++){
   const reveal=Math.min(stage,maxReveal),modelStage=Math.max(0,stage-maxReveal);const slide=pptx.addSlide();slideCount++;slide.background={color:colour('bg')};
   slide.addText(original.kicker,{x:.6,y:.3,w:12.1,h:.25,fontSize:13,color:colour('brand'),rtlMode:true,align:'right'});
   await addText(slide,original.title,.6,.75,12.1,.65,30);await addText(slide,original.prompt,.6,1.5,12.1,.7,20);
   for(const [i,a]of activities.entries())slide.addText(a.title+' ↗',{x:1+i*3.8,y:6.85,w:3.5,h:.2,fontFace:'Heebo',fontSize:10,color:colour('brand'),rtlMode:true,align:'right',hyperlink:{url:a.url}});
   slide.addImage({data:data(logo),...pptxgenImageContain(logo,.6,7.02,.4,.3)});slide.addText(`${slideCount} · נושא ${sceneIndex+1}/${bundle.slides.length} · צעד ${stage+1}/${maxReveal+states} · ${title}`,{x:1,y:7,w:11.7,h:.3,fontSize:10,color:colour('muted'),rtlMode:true,align:'right'});
   if(original.taskId){const t=publicVisualLesson(bundle).tasks.find(t=>t.id===original.taskId)!;await addText(slide,t.givens,.7,2.4,11.9,.65,21);await addText(slide,t.prompt,.7,3.1,11.9,.7,24);if(t.model)await model(slide,t.model,0,.8,4,8,2.7);if(t.check?.options.length)await addText(slide,t.check.options.join('\n'),9,4,3,2.4,21);continue;}
   const blocks=original.blocks.filter(b=>b.reveal<=reveal);const models=blocks.filter(b=>b.model),hasVisual=models.length>0||blocks.some(b=>b.type==='source');
   const texts=blocks.filter(b=>b.type!=='model'&&b.type!=='source');
   const two=models.length>1;const split=hasVisual&&texts.length>0;
   let visualAt=0,textAt=0;
   for(const b of blocks){
    if(b.model){const w=two?5.9:split?7.4:11.9,x=two?.7+visualAt*6.1:.7;await model(slide,b.model,modelStage,x,two&&split?3.65:2.4,w,two&&split?2.95:4.2,original.layout==='compare'?models.flatMap(b=>b.model?[b.model]:[]):[]);if(b.text)await addText(slide,b.text,x,two&&split?3.35:2.12,w,.3,15);visualAt++;}
    else if(b.type==='source'&&b.sourceId){const asset=officialQuestionAsset(b.sourceId),caption=sourceCaption(b.sourceId);if(!asset||!caption)throw Error('native_source');slide.addImage({data:asset.image,...pptxgenImageContain(Buffer.from(asset.image.split(',')[1],'base64'),.7,2.35,split?7.4:11.9,4.05)});slide.addText(caption.label,{x:.7,y:6.55,w:11.9,h:.27,fontSize:11,color:colour('muted'),rtlMode:true,align:'right',hyperlink:{url:caption.url}});}
    else{const x=two?.9:split?8.5:.9,w=two?11.5:split?3.8:11.5,h=two?.45:Math.min(1.1,4.15/Math.max(1,texts.length)),y=(two?2.3:2.45)+textAt*(h+.15);if(b.type==='equation'){const bytes=await formula(b.text);slide.addImage({data:data(bytes),...pptxgenImageContain(bytes,x,y,w,h)});}else await addText(slide,b.text,x,y,w,h,split?22:26);textAt++;}
   }
  }
  slideMap.push({sceneId:original.id,title:original.title,firstSlide,lastSlide:slideCount});
 }
 const publicBundle=publicVisualLesson(bundle);const tutorText=[title,'הערות פרטיות למורה',...bundle.agenda.map(a=>`${a.title} · ${a.minutes} דקות`),...bundle.slides.flatMap((s,i)=>[`${i+1}. ${s.title} · שקפים \u2066${slideMap[i].firstSlide}–${slideMap[i].lastSlide}\u2069`,...Object.entries(s.presenterNotes).filter(([k])=>k!=='sources').map(([k,v])=>`${({minutes:'דקות',explanation:'מה אומרים',ask:'עוצרים ושואלים',expectedAnswer:'למה מקשיבים',ifStuck:'אם נתקעים',misconception:'טעות שכדאי לזהות',transition:'המעבר הבא'} as Record<string,string>)[k]??k}: ${v}`)]),...bundle.slides.flatMap(s=>(s.presenterNotes.sources??[]).flatMap(id=>{const c=sourceCaption(id);return c?[`${c.label}: ${c.url}`]:[];})),'פתרונות',...[...bundle.tasks,...bundle.homework,...bundle.games.flatMap(g=>g.rounds)].flatMap(t=>[t.title,t.givens,t.prompt,t.solution]),...bundle.sourceSolutions.map(s=>`${s.questionId} ${s.part}: ${s.answer}`)].join('\n');
 const homeworkText=[title,`תרגול לבית · ${bundle.homeworkMinutes} דקות`,...publicBundle.homework.flatMap((t,i)=>[`${i+1}. ${t.title}`,t.givens,t.prompt,...(t.check?.options??[])])].join('\n');
 async function document(text:string,homework=false){const paragraphs:Paragraph[]=[new Paragraph({children:[new ImageRun({data:logo,type:'png',transformation:{width:32,height:24}})],bidirectional:true})];
  const content:Array<string|NormalModel>=homework?[title,`תרגול לבית · ${bundle.homeworkMinutes} דקות`,...publicBundle.homework.flatMap((t,i)=>[`${i+1}. ${t.title}`,t.givens,t.prompt,...(t.check?.options??[]),...(t.model?[t.model]:[]),'מקום לדרך הפתרון:','________________________________________','________________________________________'])]:text.split('\n');
  for(const [i,line]of content.entries()){if(typeof line!=='string'){const bytes=await png(normalVisual(line,0,'homework').svg);paragraphs.push(new Paragraph({children:[new ImageRun({data:bytes,type:'png',transformation:{width:540,height:240}})],bidirectional:true,keepNext:true}));continue;}const runs:Array<TextRun|ImageRun>=[];for(const part of chunks(line)){if(part.math){const bytes=await formula(part.value),meta=await sharp(bytes).metadata();runs.push(new ImageRun({data:bytes,type:'png',transformation:{width:Math.min(500,28*(meta.width??1200)/(meta.height??180)),height:28},altText:{title:part.value,description:'נוסחה מתמטית',name:'math'}}));}else runs.push(new TextRun({text:part.value,font:'Heebo',size:24,rightToLeft:true}));}paragraphs.push(new Paragraph({children:runs,bidirectional:true,heading:i===0?HeadingLevel.TITLE:/^\d+\./.test(line)?HeadingLevel.HEADING_2:undefined,keepNext:i===0||/^\d+\./.test(line)||homework&&!line.startsWith('____'),spacing:{after:120}}));}
  for(const a of activities)paragraphs.push(new Paragraph({children:[new ExternalHyperlink({link:a.url,children:[new TextRun({text:a.title,style:'Hyperlink',rightToLeft:true})]})],bidirectional:true}));
  return Packer.toBuffer(new Document({sections:[{properties:{},children:paragraphs}]}));
 }
 return {sourceHash,rendererHash:rendererManifest.rendererHash,slideCount,slideMap,slides:Buffer.from(await pptx.write({outputType:'nodebuffer'}) as Buffer),tutorNotes:await document(tutorText),homework:await document(homeworkText,true),tutorText,homeworkText,activities};
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
  const notes=await api.nativeImport(`${key}:notes`,`${title} — פרטי למורה ופתרונות`,DOC,folder.id,output.tutorNotes,DOCX);
  const homework=await api.nativeImport(`${key}:homework`,`${title} — תרגול לבית ללא פתרונות`,DOC,folder.id,output.homework,DOCX);
  return {version:1 as const,state:'draft' as const,sourceHash:output.sourceHash,reviewFolderId:folder.id,slides:file(slides.file),tutorNotes:file(notes.file),homework:file(homework.file),activities:output.activities,slideCount:output.slideCount};
 })();running.set(gate,task);try{return await task;}finally{running.delete(gate);}
}
