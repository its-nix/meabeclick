import sharp from 'sharp';
import {normalVisual} from '../../learning/deck/normal.ts';
import {DECK_PALETTE} from '../../brand.ts';
import type {DeckSlide,NormalModel,NormalState} from '../../learning/deck/model.ts';

export interface NativeMotionPlan {
 kind:'spread'|'area';model:NormalModel;frames:NormalState[];delayMs:number;width:number;height:number;
 prompt:string;caption:string;notes:string;
}

export function nativeMotionPlan(scene:Pick<DeckSlide,'layout'|'taskId'|'blocks'>):NativeMotionPlan|null {
 if(scene.taskId||!['visual','split','working'].includes(scene.layout)||scene.blocks.some(b=>b.type==='source'))return null;
 const models=scene.blocks.filter(b=>b.model);
 if(models.length!==1||models[0].type!=='model')return null;
 const model=structuredClone(models[0].model!),base=model.states[0];
 if(model.states.length!==1||!base||!Number.isFinite(base.mean)||Math.abs(base.mean)>10000||!Number.isFinite(base.sd)||base.sd<.1||base.sd>100||base.pointZ!==null||base.hideZ!==null)return null;
 const spread=model.mode==='spread'&&model.interactive==='spread'&&!model.showProbability&&base.lowerZ===null&&base.upperZ===null;
 const area=model.mode==='bands'&&model.interactive==='region'&&model.showProbability&&base.upperZ!==null&&[.5,1,1.5,2].includes(base.upperZ)&&base.lowerZ===-base.upperZ;
 if(!spread&&!area)return null;
 const smooth=(from:number,to:number,t:number)=>from+(to-from)*(1-Math.cos(Math.PI*t))/2;
 const frames=Array.from({length:32},(_,i)=>{
  if(spread){
   const factor=i<=8?smooth(1,.65,i/8):i<=20?smooth(.65,1.75,(i-8)/12):smooth(1.75,1,(i-20)/12);
   return {...base,sd:base.sd*factor};
  }
  const start=base.upperZ!,steps=(2.5-start)*2,upperZ=start+Math.round(steps*(1-Math.abs(2*i/31-1)))/2;
  return {...base,lowerZ:-upperZ,upperZ};
 });
 return {kind:spread?'spread':'area',model,frames,delayMs:spread?180:240,width:900,height:400,
  prompt:spread?'עקבו אחר השינוי בפיזור. מה נשאר קבוע ומה משתנה?':'עקבו אחר גבולות התחום. כיצד משתנה החלק של הקבוצה שנמצא ביניהם?',
  caption:spread?'הממוצע קבוע; סטיית התקן, רוחב העקומה וגובהה משתנים יחד.':'המרכז והפיזור קבועים; גבולות התחום והאחוז שבתוכו משתנים יחד.',
  notes:'אחרי תחזית התלמיד, עברו לשקופית זו כדי להתחיל את התנועה. האנימציה חוזרת במחזוריות. כדי לעצור להתבוננות חזרו לשקופית הסטטית הקודמת; כדי להתקדם עברו לשלב הבא. שאלו מה נשאר קבוע ומה משתנה.'};
}

const fmt=(n:number)=>Number(n.toFixed(2)).toString();
const escapeXml=(text:string)=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

/** Uses the same base model on every frame so normalVisual retains its fixed axis. */
export function nativeMotionFrameSvg(plan:NativeMotionPlan,index:number):string {
 const frame=plan.frames[index];
 if(!frame)throw new RangeError('Native motion frame is out of range');
 const visual=normalVisual(plan.model,0,'native-motion',frame);
 const label=`x̄ = ${fmt(frame.mean)}   ·   s = ${fmt(frame.sd)}`;
 const text=(attribute:string,y:number,value:string)=>`<text ${attribute} x="450" y="${y}" text-anchor="middle" font-family="Heebo" font-size="28" fill="${DECK_PALETTE.text}">${escapeXml(value)}</text>`;
 let labels=text('data-motion-parameters=""',36,label);
 if(plan.kind==='area'){
  if(frame.lowerZ===null||frame.upperZ===null||visual.percent===null)throw new Error('Unsupported native motion probability');
  labels+=text('data-motion-probability=""',70,`P(${fmt(frame.mean+frame.lowerZ*frame.sd)} < X < ${fmt(frame.mean+frame.upperZ*frame.sd)}) ≈ ${fmt(visual.percent)}%`);
 }
 return visual.svg.replace(/(\sdata-[\w-]+)(?=[\s>])/g,'$1=""').replace('</svg>',labels+'</svg>');
}

/** Heebo is installed in the native export runtime, shared with the static SVG renderer. */
export async function renderNativeMotion(plan:NativeMotionPlan):Promise<Buffer> {
 const frames:Buffer[]=[];
 for(let i=0;i<plan.frames.length;i++){
  frames.push(await sharp(Buffer.from(nativeMotionFrameSvg(plan,i))).resize(plan.width,plan.height).flatten({background:DECK_PALETTE.bg}).ensureAlpha().raw().toBuffer());
 }
 return sharp(Buffer.concat(frames),{raw:{width:plan.width,height:plan.height*frames.length,channels:4,pageHeight:plan.height}})
  .gif({loop:0,delay:Array(frames.length).fill(plan.delayMs),effort:7,interFrameMaxError:0,keepDuplicateFrames:true}).toBuffer();
}
