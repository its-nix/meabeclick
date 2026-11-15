/** Static review previews capture the actual native slide drawing calls, not a second storyboard. */
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type PptxGenJS from 'pptxgenjs';
import {DECK_PALETTE} from '../../brand.ts';
import type {ReviewImage} from './validation.ts';

interface Draw {kind:'text'|'image';value:string;options:Record<string,any>}
export interface NativeCapture {number:number;draws:Draw[]}
const esc=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function captureNativeSlide(slide:PptxGenJS.Slide,number:number):NativeCapture{
 const capture:NativeCapture={number,draws:[]};
 const text=slide.addText.bind(slide),image=slide.addImage.bind(slide);
 slide.addText=((value:any,options:any)=>{capture.draws.push({kind:'text',value:typeof value==='string'?value:value.map((p:any)=>p.text).join(''),options:{...options}});return text(value,options);}) as typeof slide.addText;
 slide.addImage=((options:any)=>{if(typeof options.data!=='string')throw Error('native_review_image');capture.draws.push({kind:'image',value:options.data,options:{...options}});return image(options);}) as typeof slide.addImage;
 return capture;
}
async function preview(capture:NativeCapture){
 const parts=[`<rect width="1280" height="720" fill="${DECK_PALETTE.bg}"/>`];
 for(const draw of capture.draws){
  const o=draw.options,x=Number(o.x)*96,y=Number(o.y)*96,w=Number(o.w)*96,h=Number(o.h)*96;
  if([x,y,w,h].some(v=>!Number.isFinite(v)))throw Error('native_review_layout');
  if(draw.kind==='image'){
   const match=draw.value.match(/^data:image\/(?:png|gif|jpeg);base64,(.+)$/s);if(!match)throw Error('native_review_image');
   // Animated demonstrations are explicitly reviewed as static frames here; the motion manifest is separate evidence.
   const bytes=await sharp(Buffer.from(match[1],'base64'),{animated:false}).png().toBuffer();
   parts.push(`<image x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none" href="data:image/png;base64,${bytes.toString('base64')}"/>`);
  }else{
   const size=Number(o.fontSize??18)*96/72,right=o.align==='right',lines=draw.value.split('\n');
   for(const [i,line]of lines.entries())parts.push(`<text x="${right?x+w:x}" y="${y+(h-size*1.2*lines.length)/2+size*(i*1.2+.95)}" font-family="Heebo" font-size="${size}" fill="#${esc(o.color??'172A3A')}" text-anchor="${o.rtlMode?(right?'start':'end'):(right?'end':'start')}" direction="${o.rtlMode?'rtl':'ltr'}" unicode-bidi="plaintext">${esc(line)}</text>`);
  }
 }
 return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1280" height="720">${parts.join('')}</svg>`)).png().toBuffer();
}
export async function writeNativeEvidence(captures:NativeCapture[],directory:string):Promise<ReviewImage[]>{
 if(!path.isAbsolute(directory)||!captures.length||captures.length>180)throw Error('native_review_evidence');
 await mkdir(directory,{recursive:true,mode:0o700});const images:ReviewImage[]=[];
 for(let offset=0;offset<captures.length;offset+=6){
  const group=captures.slice(offset,offset+6),layers=[];
  for(const [i,capture]of group.entries())layers.push({input:await preview(capture),left:(i%2)*1280,top:Math.floor(i/2)*750+30});
  const label=group.map((c,i)=>`<text x="${(i%2)*1280+20}" y="${Math.floor(i/2)*750+24}" font-size="20">Native slide ${c.number} · static preview</text>`).join('');
  const bytes=await sharp({create:{width:2560,height:Math.ceil(group.length/2)*750,channels:3,background:'#dfe6ec'}}).composite([...layers,{input:Buffer.from(`<svg width="2560" height="${Math.ceil(group.length/2)*750}">${label}</svg>`),left:0,top:0}]).png().toBuffer();
  const name=`native-${String(offset+1).padStart(3,'0')}-${String(offset+group.length).padStart(3,'0')}.png`,file=path.join(directory,name);
  await writeFile(file,bytes,{mode:0o600});images.push({name,path:file,sha256:createHash('sha256').update(bytes).digest('hex')});
 }
 return images;
}
