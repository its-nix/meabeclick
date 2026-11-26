"""Independent grid geometry and actual seeked GSAP correspondence checks."""
from pathlib import Path
from html.parser import HTMLParser
import itertools
import os
import subprocess
import unittest

HERE=Path(__file__).parent.resolve()

class GridParser(HTMLParser):
    def __init__(self):
        super().__init__();self.rectangles=[]
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='rect' and a.get('class')=='counted':
            self.rectangles.append(tuple(int(a[k]) for k in ('x','y','width','height')))

class TemplateMotionTests(unittest.TestCase):
    def test_grid_exhaustive_geometry(self):
        p=GridParser();p.feed((HERE/'posts/riddle-rectangles-v2/compositions/lesson.html').read_text())
        expected={(x,y,r-x,b-y) for x,r in itertools.combinations(range(0,661,220),2) for y,b in itertools.combinations(range(0,441,220),2)}
        self.assertEqual(len(p.rectangles),18);self.assertEqual(set(p.rectangles),expected)
        self.assertEqual(sum(w==h for _,_,w,h in p.rectangles),8)
        self.assertEqual(sum(h>w for _,_,w,h in p.rectangles),3)
        self.assertEqual([sum((w,h)==size for _,_,w,h in p.rectangles) for size in [(220,220),(440,220),(660,220),(220,440),(440,440),(660,440)]],[6,4,2,3,2,1])

    def test_framewise_timeline_correspondence(self):
        chrome=os.environ.get('CHROME_PATH','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
        if not Path(chrome).exists():self.skipTest('Set CHROME_PATH for runtime timeline verification')
        script=r'''
const fs=require('fs'),assert=require('assert');
(async()=>{
const {default:puppeteer}=await import('puppeteer-core');
const browser=await puppeteer.launch({executablePath:process.env.TEST_CHROME,headless:true,args:['--no-sandbox']});
try{
const page=await browser.newPage();
async function load(name){
 await page.goto('about:blank');
 const base=process.env.TEMPLATE_ROOT+'/posts/'+name;
 const source=fs.readFileSync(base+'/compositions/lesson.html','utf8').replace(/^<template>/,'').replace(/<\/template>$/,'');
 const gsap=fs.readFileSync(base+'/assets/gsap.min.js','utf8');
 await page.setContent('<html><head><script>'+gsap+'</script></head><body>'+source+'</body></html>');
}
await load('tip-add18-v2');
const result=await page.evaluate(()=>{
 const tl=window.__timelines.lesson,errors=[],ends=[];
 for(const [id,start,duration] of [['plus',3.02,1.46],['minus',7.28,.76]]){
  const path=document.getElementById(id),L=path.getTotalLength();let last=null;
  for(let n=Math.ceil(start*30);n<=Math.floor((start+duration)*30);n++){
   tl.seek(n/30,false);
   const tip=path.getPointAtLength(L-parseFloat(gsap.getProperty(path,'strokeDashoffset')));
   const x=80+Number(gsap.getProperty('#traveler','x')),y=232+Number(gsap.getProperty('#traveler','y'));
   const shadow=80+Number(gsap.getProperty('#shadow','x'));
   if(Math.hypot(tip.x-x,tip.y-y)>.1 || Math.abs(shadow-x)>.01)errors.push({id,n,tip:{x:tip.x,y:tip.y},x,y,shadow});
   if(last!==null && (id==='plus'?x<last:x>last))errors.push({id,n,direction:true});
   last=x;
  }
  tl.seek(start+duration,false);ends.push(Number(gsap.getProperty('#traveler','x')));
 }
 return {errors,ends};
});
if(result.errors.length)console.log(JSON.stringify(result));
assert.deepEqual(result.errors,[],'Every original-frame jump sample: dot, arc tip, shadow must agree');
assert(Math.abs(result.ends[0]/(result.ends[0]-result.ends[1])-10)<.001,'20 forward / 2 back proportional scale');
await load('riddle-rectangles-v2');
const errors=await page.evaluate(()=>{
 const tl=window.__timelines.lesson,errors=[];
 for(let n=165;n<=541;n++){
  tl.seek(n/30,false);
  const rects=[...document.querySelectorAll('.counted')].filter(e=>Number(gsap.getProperty(e,'opacity'))>.99);
  const counts=[...document.querySelectorAll('.count')].filter(e=>Number(gsap.getProperty(e,'opacity'))>.99);
  if(rects.length!==1 || counts.length!==1 || rects[0].id.slice(5)!==counts[0].id.slice(6))errors.push(n);
 }
 return errors;
});
assert.deepEqual(errors,[],'Every counting frame must show exactly one full highlight matching count');
console.log('Runtime framewise geometry passed');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
'''
        result=subprocess.run(['node','-e',script],cwd=HERE.parent.parent,env={**os.environ,'TEST_CHROME':chrome,'TEMPLATE_ROOT':str(HERE)},capture_output=True,text=True,timeout=60)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)

if __name__=='__main__':unittest.main()
