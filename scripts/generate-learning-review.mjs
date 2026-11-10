#!/usr/bin/env node
/** Real generation, isolated from customers. Resumable with bounded concurrency and verified artifacts. */
import { readFile, writeFile, mkdir, mkdtemp, rename, rm, open } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { REVIEW_CASES as BASELINE_CASES } from './learning-review-cases.mjs';
import { REVIEW_V2_CASES } from './learning-review-v2-cases.mjs';
import { TEACHING_RULE_VERSION } from '../src/lib/learning/teaching-rules.ts';
import { validateManifest, readVerifiedPlan, validatePlan, sourceFingerprint, SOURCE_FILES } from './learning-review-validation.mjs';

const args=process.argv.slice(2),options=new Map();
const valued=new Set(['--version','--out','--model','--effort','--concurrency','--case','--batch']);
for(let i=0;i<args.length;i++){
  const flag=args[i];
  if(options.has(flag))throw Error(`Repeated option: ${flag}`);
  if(flag==='--retry-failed'){options.set(flag,true);continue;}
  if(!valued.has(flag))throw Error(`Unknown option: ${flag}`);
  const value=args[++i];if(!value||value.startsWith('--'))throw Error(`Missing ${flag} value`);
  options.set(flag,value);
}
const option=(name,fallback)=>options.get(`--${name}`)??fallback;
const generationVersion=Number(option('version','1'));if(![1,2].includes(generationVersion))throw Error('Unsupported generation version');
const REVIEW_CASES=generationVersion===2?REVIEW_V2_CASES:BASELINE_CASES;
const out=resolve(option('out',join(tmpdir(),'meabeclick-learning-review-v1')));
const model=option('model',null),effort=option('effort','high'),concurrency=Number(option('concurrency','2')),selected=option('case',null)?.split(',');
if(!model||!['medium','high'].includes(effort)||![1,2].includes(concurrency))throw Error('Specify --model <verified-account-model>, medium/high effort and concurrency 1 or 2');
if(selected&&selected.some(id=>!REVIEW_CASES.some(c=>c.id===id)))throw Error('Unknown review case');
await mkdir(out,{recursive:true});
// A crashed owner's lock is intentionally not auto-stolen: confirm its process has ended before removing it.
const lockPath=join(out,'.generation-lock');
let lock;
try{lock=await open(lockPath,'wx',0o600);}catch(error){if(error.code==='EEXIST')throw Error(`Batch locked. Check ${lockPath} and its owner before resuming.`);throw error;}
let isolated;
try {
  await lock.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
  isolated=await mkdtemp(join(tmpdir(),'meabeclick-review-db-'));
  process.env.DATA_DIR=isolated;process.env.DB_PATH=join(isolated,'results.db');process.env.LESSON_DIAGNOSTIC_DIR=join(out,'rejected');
  process.env.LESSON_GENERATION_VERSION=String(generationVersion);process.env.LESSON_ENGINE='codex';process.env.LESSON_MODEL=model;process.env.LESSON_EFFORT=effort;
  const fingerprint=await sourceFingerprint();
  const cli=execFileSync(process.env.CODEX_BIN||'codex',['--version'],{encoding:'utf8',timeout:30000}).trim();
  const {generateLesson,lessonTimeoutMs}=await import('../src/lib/server/lesson/prep.ts');
  const config={model,effort,cli,sourceFingerprint:fingerprint,sourceFiles:SOURCE_FILES,timeoutMs:lessonTimeoutMs(),generationVersion,...(generationVersion===2?{ruleVersion:TEACHING_RULE_VERSION,schemaVersion:'teaching-v2'}:{})};
  const manifestPath=join(out,'manifest.json');
  let manifest={version:1,batch:option('batch',basename(out)),syntheticOnly:true,approval:'needs-human-review',createdAt:new Date().toISOString(),config,cases:REVIEW_CASES.map(brief=>({brief,status:'pending'}))};
  if(existsSync(manifestPath)) {
    manifest=JSON.parse(await readFile(manifestPath,'utf8'));validateManifest(manifest);
    if(manifest.sourceVerification?.status==='failed')throw Error('Batch source integrity previously failed. Generate a new candidate directory.');
    if(JSON.stringify(manifest.config)!==JSON.stringify(config))throw Error('Generator/model differs from existing batch. Use a new output directory.');
    for(const item of manifest.cases.filter(c=>c.status==='ready'))await validatePlan(await readVerifiedPlan(out,item),generationVersion);
  }
  let checkpoint=Promise.resolve();
  const save=()=>{const snapshot=JSON.stringify(manifest,null,2);checkpoint=checkpoint.then(async()=>{await writeFile(manifestPath+'.tmp',snapshot);await rename(manifestPath+'.tmp',manifestPath);});return checkpoint;};
  let stop=false;
  const pending=manifest.cases.filter(c=>(!selected||selected.includes(c.brief.id))&&c.status!=='ready'&&(c.status!=='failed'||options.has('--retry-failed')));
  async function run(item) {
    if(stop)return;
    if(item.status==='failed'||item.status==='generating')item.previousAttempts=[...(item.previousAttempts??[]),{status:item.status,startedAt:item.startedAt,error:item.error}];
    item.status='generating';item.startedAt=new Date().toISOString();delete item.error;
    await save();console.log(`START ${item.brief.id}`);
    try {
      const plan=await generateLesson(item.brief);
      try{await validatePlan(plan,generationVersion);}catch(error){await writeFile(join(out,item.brief.id+'.rejected.json'),JSON.stringify(plan,null,2),{mode:0o600});throw error;}
      const content=JSON.stringify(plan,null,2)+'\n';
      await writeFile(join(out,item.brief.id+'.json'),content);
      item.planSha256=createHash('sha256').update(content).digest('hex');
      item.status='ready';item.finishedAt=new Date().toISOString();item.seconds=Math.round((Date.parse(item.finishedAt)-Date.parse(item.startedAt))/1000);
      console.log(`READY ${item.brief.id} ${item.seconds}s ${plan.learning.scenes.length} stages`);
    }catch(error){
      item.status='failed';item.error={kind:error.kind??'validation',message:error.issues?.map(issue=>`${issue.path}: ${issue.message}`).join('; ')||error.message};
      // Diagnostics can contain echoed prompts; local only, private permissions, never included in the corpus.
      if(error.detail)await writeFile(join(out,item.brief.id+'.diagnostic.log'),String(error.detail),{mode:0o600});
      console.log(`FAILED ${item.brief.id}: ${item.error.kind}`);
      if(['engine-quota','engine-auth','engine-missing','engine-failed'].includes(item.error.kind))stop=true;
    }
    await save();
  }
  manifest.sourceVerification={status:'unverified',fingerprint};
  await save();
  if(pending.length)await run(pending.shift());
  await Promise.all(Array.from({length:concurrency},async()=>{while(pending.length&&!stop)await run(pending.shift());}));
  await checkpoint;
  if(await sourceFingerprint()!==fingerprint){manifest.sourceVerification={status:'failed',fingerprint,verifiedAt:new Date().toISOString()};await save();throw Error('Generator changed during batch; do not package mixed provenance.');}
  manifest.sourceVerification={status:'verified',fingerprint,method:'run-completion',verifiedAt:new Date().toISOString()};await save();
  const ready=manifest.cases.filter(c=>c.status==='ready').length;
  console.log(`REVIEW ${ready}/10 complete; human review remains pending. ${manifestPath}`);
  if(manifest.cases.some(c=>(!selected||selected.includes(c.brief.id))&&c.status!=='ready'))process.exitCode=1;
}finally{
  if(isolated)await rm(isolated,{recursive:true,force:true});
  await lock.close();await rm(lockPath,{force:true});
}
