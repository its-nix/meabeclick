import {test} from 'node:test';
import assert from 'node:assert/strict';

const state={mean:65,sd:10,lowerZ:null,upperZ:null,pointZ:null,hideZ:null};
function scene(model={mode:'spread',interactive:'spread',showProbability:false,states:[{...state}]}){
 return {id:'motion-demo',title:'דוגמה',kicker:'',prompt:'',objectiveId:'o1',layout:'visual',taskId:null,blocks:[{type:'model',text:'',model,sourceId:null,reveal:0}],presenterNotes:{}};
}

test('motion accepts only single worked explanatory models without mutating the scene',async()=>{
 const {nativeMotionPlan}=await import('../../src/lib/server/native-learning/motion.ts');
 const original=scene(),before=structuredClone(original),plan=nativeMotionPlan(original);
 assert.equal(plan.kind,'spread');assert.deepEqual(original,before);
 plan.frames[0].sd=999;plan.model.states[0].sd=888;assert.deepEqual(original,before);
 for(const layout of ['cover','compare','source','challenge','recap'])assert.equal(nativeMotionPlan({...scene(),layout}),null,layout);
 assert.equal(nativeMotionPlan({...scene(),taskId:'independent-1'}),null);
 for(const layout of ['visual','split','working'])assert.ok(nativeMotionPlan({...scene(),layout}));
 const source=scene();source.blocks.push({type:'source',model:null,text:'',sourceId:'official',reveal:0});assert.equal(nativeMotionPlan(source),null);
 const two=scene();two.blocks.push(structuredClone(two.blocks[0]));assert.equal(nativeMotionPlan(two),null);
 for(const patch of [{states:[state,state]},{interactive:'none'},{showProbability:true},{mode:'curve'},{states:[{...state,pointZ:1}]},{states:[{...state,hideZ:0}]},{states:[{...state,sd:0}]},{states:[{...state,sd:.01}]},{states:[{...state,sd:101}]},{states:[{...state,mean:10001}]},{states:[{...state,mean:NaN}]}]){
  const s=scene();Object.assign(s.blocks[0].model,patch);assert.equal(nativeMotionPlan(s),null,JSON.stringify(patch));
 }
});

const areaScene=(upper=1)=>scene({mode:'bands',interactive:'region',showProbability:true,states:[{...state,lowerZ:-upper,upperZ:upper}]});
const ticks=svg=>[...svg.matchAll(/data-z-tick="([^"]+)"[\s\S]*?<text[^>]*>([^<]*)<\/text>/g)].map(m=>m[0]);

test('spread has 32 smooth frames starting at the authored state with fixed mean and axis',async()=>{
 const {nativeMotionPlan,nativeMotionFrameSvg}=await import('../../src/lib/server/native-learning/motion.ts');
 const plan=nativeMotionPlan(scene());assert.equal(plan.frames.length,32);assert.equal(plan.delayMs,180);
 assert.deepEqual(plan.frames[0],state);
 assert.ok(Math.abs(Math.min(...plan.frames.map(f=>f.sd))-6.5)<.02);
 assert.ok(Math.abs(Math.max(...plan.frames.map(f=>f.sd))-17.5)<.02);
 const axis=ticks(nativeMotionFrameSvg(plan,0));assert.ok(axis.length>5);
 for(const [i,frame]of plan.frames.entries()){
  assert.equal(frame.mean,65);assert.ok(frame.sd>=6.5&&frame.sd<=17.5);
  const svg=nativeMotionFrameSvg(plan,i);assert.deepEqual(ticks(svg),axis);
  assert.match(svg,/x̄ = 65/);assert.ok(svg.includes(`s = ${Number(frame.sd.toFixed(2))}`));
  assert.match(svg,/data-motion-parameters[^>]+y="36"/);
 }
 assert.notEqual(nativeMotionFrameSvg(plan,0),nativeMotionFrameSvg(plan,16));
 assert.doesNotMatch(plan.prompt+plan.caption,/\d/);
});

test('area motion holds only supported school bounds with the exact shared school percentages',async()=>{
 const {nativeMotionPlan,nativeMotionFrameSvg}=await import('../../src/lib/server/native-learning/motion.ts');
 const {normalVisual}=await import('../../src/lib/learning/deck/normal.ts');
 for(const upper of [.5,1,1.5,2]){
  const plan=nativeMotionPlan(areaScene(upper));assert.equal(plan.kind,'area');assert.equal(plan.frames.length,32);assert.equal(plan.delayMs,240);
  assert.equal(plan.frames[0].upperZ,upper);assert.equal(plan.frames.at(-1).upperZ,upper);
  assert.equal(Math.max(...plan.frames.map(f=>f.upperZ)),2.5);
  const axis=ticks(nativeMotionFrameSvg(plan,0));
  for(const [i,f]of plan.frames.entries()){
   assert.equal(f.lowerZ,-f.upperZ);assert.ok([.5,1,1.5,2,2.5].includes(f.upperZ));assert.equal(f.mean,65);assert.equal(f.sd,10);
   const expected=new Map([[.5,38],[1,68],[1.5,86],[2,96],[2.5,99]]).get(f.upperZ);
   assert.equal(normalVisual(plan.model,0,'check',f).percent,expected);
   const svg=nativeMotionFrameSvg(plan,i);assert.deepEqual(ticks(svg),axis);
   assert.ok(svg.includes(`P(${65-10*f.upperZ} &lt; X &lt; ${65+10*f.upperZ}) ≈ ${expected}%`));
   assert.match(svg,/data-motion-probability[^>]+y="70"/);
  }
 }
 for(const upper of [0,.75,2.5,3])assert.equal(nativeMotionPlan(areaScene(upper)),null);
 const asymmetric=areaScene();asymmetric.blocks[0].model.states[0].lowerZ=-.5;assert.equal(nativeMotionPlan(asymmetric),null);
 const unsupported=areaScene();unsupported.blocks[0].model.interactive='none';assert.equal(nativeMotionPlan(unsupported),null);
});

test('rendered GIFs retain 32 timed looping pages and a meaningful authored first frame',async()=>{
 const {nativeMotionPlan,renderNativeMotion}=await import('../../src/lib/server/native-learning/motion.ts');
 const {default:sharp}=await import('sharp');
 const envBefore={...process.env};
 for(const source of [scene(),areaScene()]){
  const plan=nativeMotionPlan(source),gif=await renderNativeMotion(plan);
  assert.match(gif.subarray(0,6).toString(),/^GIF8[79]a$/);
  const meta=await sharp(gif,{animated:true}).metadata();
  assert.equal(meta.pages,32);assert.equal(meta.pageHeight,400);assert.equal(meta.width,900);assert.equal(meta.loop,0);
  assert.deepEqual(meta.delay,Array(32).fill(plan.delayMs));
  const first=await sharp(gif,{page:0}).raw().toBuffer();
  const later=await sharp(gif,{page:16}).raw().toBuffer();assert.notDeepEqual(first,later);
  const stats=await sharp(gif,{page:0}).extract({left:60,top:90,width:780,height:270}).stats();
  assert.ok(stats.channels.some(c=>c.stdev>15),'first frame includes the authored curve and axes');
  assert.deepEqual({...process.env},envBefore);
 }
});

