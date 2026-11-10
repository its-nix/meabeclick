import '../isolate-lesson-data.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';import{mkdtemp,writeFile,readFile,rm,mkdir}from'node:fs/promises';import{tmpdir}from'node:os';import{join,dirname}from'node:path';
import{visualDeckFixture}from'../visual-deck-fixture.mjs';
const context={purpose:'review',skill:'התפלגות נורמלית',request:'היכרות חזותית לפני בחינה',track:'3',questionnaire:'35372',durationMin:90,history:[],notation:'school-normal-s'};
async function inert(responses,action){const dir=await mkdtemp(join(tmpdir(),'visual-gen-test-'));const old={};for(const k of ['CODEX_BIN','VISUAL_STUB_DIR'])old[k]=process.env[k];try{
 await writeFile(join(dir,'responses.json'),JSON.stringify(responses));
 const bin=join(dir,'stub.mjs');await writeFile(bin,`#!/usr/bin/env node
import{readFileSync,writeFileSync}from'node:fs';import{join}from'node:path';
const d=process.env.VISUAL_STUB_DIR,a=process.argv.slice(2);if(a.includes('--version')){process.stdout.write('codex-cli test');process.exit(0)}let p='';for await(const c of process.stdin)p+=c;
let n=0;try{n=Number(readFileSync(join(d,'count'),'utf8'))}catch{}writeFileSync(join(d,'count'),String(n+1));writeFileSync(join(d,'prompt-'+n),p);writeFileSync(join(d,'schema.json'),readFileSync(a[a.indexOf('--output-schema')+1]));const r=JSON.parse(readFileSync(join(d,'responses.json'),'utf8'))[n];
if(r?.pause)await new Promise(resolve=>setTimeout(resolve,2000));if(r?.failure){process.stderr.write(r.failure);process.exit(1)}writeFileSync(a[a.indexOf('-o')+1],JSON.stringify(r));
`,{mode:0o755});process.env.CODEX_BIN=bin;process.env.VISUAL_STUB_DIR=dir;return await action(dir);
 }finally{for(const[k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}await rm(dir,{recursive:true,force:true});}}
test('the real visual generation boundary uses compositional authoring rules and strict output',async()=>{
 const m=await import('../../src/lib/server/lesson/visual-generation.ts').catch(()=>null);assert.ok(m,'reusable visual authoring path exists');
 await inert([visualDeckFixture()],async dir=>{const p=await m.generateVisualLesson({context,sourceIds:[],model:'account-model',timeoutMs:3000});assert.equal(p.slides.length,20);const prompt=await readFile(join(dir,'prompt-0'),'utf8');assert.match(prompt,/mea-visual-v1/);assert.match(prompt,/storyboard|סטוריבורד/);assert.match(prompt,/מקורית|מקורי/);assert.match(prompt,/היכרות חזותית/);const schema=JSON.parse(await readFile(join(dir,'schema.json'),'utf8'));assert.equal(schema.additionalProperties,false);assert.ok(schema.properties.slides.items.properties.blocks);const questionModel=schema.properties.tasks.items.properties.model.anyOf.find(s=>s.properties);assert.deepEqual(questionModel.properties.interactive.enum,['none']);assert.deepEqual(questionModel.properties.showProbability.enum,[false]);});
});
test('invalid nested output repairs once; quota and unknown sources never retry',async()=>{
 const {generateVisualLesson}=await import('../../src/lib/server/lesson/visual-generation.ts');
 await inert([{slides:[null]},visualDeckFixture()],async dir=>{const rejected=[];assert.equal((await generateVisualLesson({context,sourceIds:[],timeoutMs:3000,onRejected:e=>rejected.push(e)})).slides.length,20);assert.equal(rejected.length,1);assert.deepEqual(JSON.parse(rejected[0].response),{slides:[null]});assert.equal(await readFile(join(dir,'count'),'utf8'),'2');assert.match(await readFile(join(dir,'prompt-1'),'utf8'),/validation failures/);});
 await inert([{},{}],async dir=>{await assert.rejects(generateVisualLesson({context,sourceIds:[],timeoutMs:3000}),e=>e.kind==='bad-output');assert.equal(await readFile(join(dir,'count'),'utf8'),'2');});
 await inert([{failure:"You've hit your usage limit"}],async dir=>{await assert.rejects(generateVisualLesson({context,sourceIds:[],timeoutMs:3000}),e=>e.kind==='engine-quota');assert.equal(await readFile(join(dir,'count'),'utf8'),'1');await assert.rejects(generateVisualLesson({context,sourceIds:['invented'],timeoutMs:3000}),/source/);assert.equal(await readFile(join(dir,'count'),'utf8'),'1');});
 for(const [response,kind,timeoutMs]of [[{failure:'please run codex login'},'engine-auth',3000],[{pause:true},'engine-timeout',500]])await inert([response],async dir=>{await assert.rejects(generateVisualLesson({context,sourceIds:[],timeoutMs}),e=>e.kind===kind);assert.equal(await readFile(join(dir,'count'),'utf8'),'1');});
});
test('official solution identities and canonical values are constrained in the actual CLI schema',async()=>{
 const {generateVisualLesson}=await import('../../src/lib/server/lesson/visual-generation.ts');const bundle=visualDeckFixture(),id='moe-2025a-35372-3';bundle.slides[2].blocks.push({type:'source',sourceId:id,text:'מקור',model:null,reveal:0});bundle.sourceSolutions=Object.entries({a1:'72',a2:'52,56,60,64,68,72,76,80,84,88,92',b:'16',c:'200',d:'86'}).map(([part,answer])=>({questionId:id,part,answer,slideId:'slide-3'}));
 await inert([bundle],async dir=>{await generateVisualLesson({context,sourceIds:[id],timeoutMs:3000});const schema=JSON.parse(await readFile(join(dir,'schema.json'),'utf8'));const branches=schema.properties.sourceSolutions.items.anyOf;assert.equal(branches.length,5);assert.deepEqual(branches.map(b=>b.properties.part.enum[0]),['a1','a2','b','c','d']);assert.deepEqual(branches.find(b=>b.properties.part.enum[0]==='b').properties.answer.enum,['16']);assert.equal(branches[0].properties.slideId.type,'string');});
});
test('sealed candidates reject artifact/source drift and failed packaging preserves destination',async()=>{
 const m=await import('../../scripts/visual-pilot-validation.mjs').catch(()=>null);assert.ok(m,'shared provenance verification exists');
 const dir=await mkdtemp(join(tmpdir(),'visual-package-'));try{
  const bundle=visualDeckFixture();const source='moe-2025a-35372-3';bundle.slides[2].blocks.push({type:'source',sourceId:source,text:'השאלה המקורית',model:null,reveal:0});
  bundle.sourceSolutions=Object.entries({a1:'72',a2:'52,56,60,64,68,72,76,80,84,88,92',b:'16',c:'200',d:'86'}).map(([part,answer])=>({questionId:source,part,answer,slideId:'slide-3'}));
  const manifest=await m.newManifest({model:'stub-model',cliVersion:'stub'});await m.sealCandidate(dir,manifest,bundle,1);
  assert.equal((await m.readCandidate(dir)).bundle.slides.length,20);
  const {spawnSync:run}=await import('node:child_process');const good=join(dir,'good.json');const packaged=run(process.execPath,['scripts/package-visual-pilot.mjs','--from',dir,'--out',good],{encoding:'utf8'});assert.equal(packaged.status,0,packaged.stderr);assert.equal(JSON.parse(await readFile(good,'utf8')).manifest.bundleSha256,manifest.bundleSha256);
  const sealed=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8'));sealed.sourceVerification.fingerprint='changed';await writeFile(join(dir,'manifest.json'),JSON.stringify(sealed));
  await assert.rejects(m.readCandidate(dir),/integrity/);
  const dest=join(dir,'published.json');await writeFile(dest,'keep existing');
  const {spawnSync}=await import('node:child_process');const failed=spawnSync(process.execPath,['scripts/package-visual-pilot.mjs','--from',dir,'--out',dest],{encoding:'utf8'});assert.notEqual(failed.status,0);assert.equal(await readFile(dest,'utf8'),'keep existing');
  await m.sealCandidate(dir,manifest,bundle,1);await writeFile(join(dir,'bundle.json'),'{}');await assert.rejects(m.readCandidate(dir),/checksum/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('targeted revisions change only explicitly allowed prose fields and retain parent mathematics',async()=>{
 const m=await import('../../src/lib/server/lesson/visual-generation.ts');assert.equal(typeof m.applyVisualRevision,'function','bounded revision boundary exists');const parent=visualDeckFixture(),field='/slides/0/prompt',feedback='הבהירו את השאלה במילים קצרות';
 await inert([{replacements:[{path:field,value:'איפה נמצאים רוב הציונים?'}]},{replacements:[{path:field,value:'איפה נמצאים רוב הציונים?'}]}],async dir=>{const revised=await m.generateVisualLesson({context,sourceIds:[],timeoutMs:3000,revision:{parent,feedback,fields:[field]}});assert.equal(revised.slides[0].prompt,'איפה נמצאים רוב הציונים?');const expected=structuredClone(parent);expected.slides[0].prompt=revised.slides[0].prompt;assert.deepEqual(revised,expected);const prompt=await readFile(join(dir,'prompt-0'),'utf8');assert.match(prompt,/targeted revision/i);assert.ok(prompt.includes(feedback));const schema=JSON.parse(await readFile(join(dir,'schema.json'),'utf8'));assert.deepEqual(schema.properties.replacements.items.properties.path.enum,[field]);});
 await inert([{replacements:[{path:'/tasks/0/check/answer',value:'999'}]},{replacements:[{path:'/tasks/0/check/answer',value:'999'}]}],async()=>{await assert.rejects(m.generateVisualLesson({context,sourceIds:[],timeoutMs:3000,revision:{parent,feedback,fields:[field]}}),e=>e.kind==='bad-output');});
 await assert.rejects(m.generateVisualLesson({context,sourceIds:[],revision:{parent,feedback,fields:['/tasks/0/check/answer']}}),/revision field/);
});
test('historical revision parents require their original source commit and exact artifact bytes',async()=>{
 const m=await import('../../scripts/visual-pilot-validation.mjs');assert.equal(typeof m.readRevisionParent,'function');const {execFileSync}=await import('node:child_process');const dir=await mkdtemp(join(tmpdir(),'visual-revision-parent-')),repo=join(dir,'source'),out=join(dir,'candidate');await mkdir(repo);await mkdir(out);
 try{
  for(const file of m.SOURCE_FILES){await mkdir(dirname(join(repo,file)),{recursive:true});await writeFile(join(repo,file),await readFile(file));}
  const git=args=>execFileSync('git',['-C',repo,'-c','user.name=Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null',...args],{encoding:'utf8'}).trim();git(['init','-q']);git(['add','-A']);git(['commit','-qm','source snapshot']);const ref=git(['rev-parse','HEAD']);
  const bundle=visualDeckFixture(),id='moe-2025a-35372-3';bundle.slides[2].blocks.push({type:'source',sourceId:id,text:'מקור',model:null,reveal:0});bundle.sourceSolutions=Object.entries({a1:'72',a2:'52,56,60,64,68,72,76,80,84,88,92',b:'16',c:'200',d:'86'}).map(([part,answer])=>({questionId:id,part,answer,slideId:'slide-3'}));
  const manifest=await m.newManifest({model:'stub',cliVersion:'stub'});await m.sealCandidate(out,manifest,bundle,1);assert.equal((await m.readRevisionParent(out,ref,repo)).sourceRevision,ref);
  await writeFile(join(repo,m.SOURCE_FILES[0]),'different source');git(['add','-A']);git(['commit','-qm','changed source']);await assert.rejects(m.readRevisionParent(out,git(['rev-parse','HEAD']),repo),/fingerprint/);
  await writeFile(join(out,'bundle.json'),'{}');await assert.rejects(m.readRevisionParent(out,ref,repo),/checksum/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
