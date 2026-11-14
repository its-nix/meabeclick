import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';
import sharp from 'sharp';
import {getPilot} from '../../src/lib/server/visual-pilot.ts';
import {exportNativeBundle} from '../../src/lib/server/native-learning/bundle.ts';

test('the complete native lesson includes staged mathematical motion, aligned notes and answer-safe static practice',async()=>{
 const bundle=structuredClone(getPilot().bundle);bundle.slides[0].presenterNotes.expectedAnswer='MOTION_PRIVATE_MARK';
 const out=await exportNativeBundle({bundle,activityBaseUrl:'https://meabeclick.com/app/native-review-activities'});
 assert.equal(out.motion?.slides.length,2,'the full workflow must include both eligible explanation animations');
 assert.deepEqual(out.motion.slides.map(s=>s.kind),['spread','area']);
 const staticCount=bundle.slides.reduce((n,s)=>n+Math.max(0,...s.blocks.map(b=>b.reveal))+Math.max(1,...s.blocks.map(b=>b.model?.states.length??1)),0);
 assert.equal(out.slideCount,staticCount+2);assert.equal(out.speakerNotes.length,out.slideCount);
 const pptx=await JSZip.loadAsync(out.slides),gifs=Object.values(pptx.files).filter(f=>/^ppt\/media\/.*\.gif$/.test(f.name));assert.equal(gifs.length,2);
 const hashes=new Map();for(const file of gifs){const bytes=await file.async('nodebuffer'),meta=await sharp(bytes,{animated:true}).metadata();assert.ok(meta.pages>1);assert.equal(meta.loop,0);hashes.set(createHash('sha256').update(bytes).digest('hex'),meta);}
 for(const motion of out.motion.slides){
  const map=out.slideMap.find(s=>s.sceneId===motion.sceneId);assert.equal(motion.slideNumber,map.lastSlide);assert.ok(map.firstSlide<motion.slideNumber,'the teacher must reach a static prediction build before motion');
  const meta=hashes.get(motion.gifSha256);assert.ok(meta);assert.equal(meta.pages,motion.frameCount);assert.equal(meta.delay.reduce((a,b)=>a+b,0),motion.durationMs);
  const rels=await pptx.file(`ppt/slides/_rels/slide${motion.slideNumber}.xml.rels`).async('string');assert.match(rels,/\.gif/);
  assert.doesNotMatch(await pptx.file(`ppt/slides/_rels/slide${motion.slideNumber-1}.xml.rels`).async('string'),/\.gif/);
  assert.match(out.speakerNotes[motion.slideNumber-1],/אנימציה/);assert.match(out.speakerNotes[motion.slideNumber-1],/סטטי/);
 }
 for(const scene of bundle.slides.filter(s=>s.taskId||s.layout==='challenge')){const range=out.slideMap.find(s=>s.sceneId===scene.id);assert.ok(!out.motion.slides.some(m=>m.slideNumber>=range.firstSlide&&m.slideNumber<=range.lastSlide),'independent question cannot acquire an answer-revealing movie');}
 for(const file of Object.values(pptx.files).filter(f=>/^ppt\/slides\/slide\d+\.xml$/.test(f.name)))assert.doesNotMatch(await file.async('string'),/MOTION_PRIVATE_MARK/);
 const homework=await JSZip.loadAsync(out.homework);assert.equal(Object.keys(homework.files).filter(f=>f.endsWith('.gif')).length,0);assert.doesNotMatch(await homework.file('word/document.xml').async('string'),/MOTION_PRIVATE_MARK/);
});
