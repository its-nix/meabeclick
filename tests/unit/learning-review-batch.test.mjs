import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { PARABOLAS } from '../../src/lib/learning/parabolas.ts';

// Inert CLI: exercises real runner/validation without network, credentials or model calls.
function setup() {
  const dir=mkdtempSync(join(tmpdir(),'review-batch-test-'));
  const plan={title:'בדיקה',gradeContext:'כיתה ט',learning:PARABOLAS,
    slides:Array.from({length:4},()=>({heading:'שלב',bullets:['הסבר']})),examples:[{problem:'1+1',steps:['חיבור'],answer:'2'}],
    homework:[{task:'1+1',why:'תרגול',answer:'2'},{task:'2+2',why:'תרגול',answer:'4'}],
    games:{memory:{title:'זיכרון',subject:'מתמטיקה',pairs:Array.from({length:6},(_,i)=>({a:`${i}+1`,b:String(i+1)}))},quiz:{title:'חידון',subject:'מתמטיקה',questions:[{q:'1+1',options:['2','3'],answer:0,why:'חיבור',hint:'ספרו'},{q:'2+2',options:['3','4'],answer:1,why:'חיבור',hint:'ספרו'},{q:'3+3',options:['6','7'],answer:0,why:'חיבור',hint:'ספרו'},{q:'4+4',options:['7','8'],answer:1,why:'חיבור',hint:'ספרו'}]}}};
  const fixture=join(dir,'plan.json');writeFileSync(fixture,JSON.stringify(plan));
  const cli=join(dir,'codex-stub');
  writeFileSync(cli,`#!/usr/bin/env node
const fs=require('node:fs');const args=process.argv.slice(2);
if(args.includes('--version')){console.log('codex-stub 1');process.exit(0);}
fs.appendFileSync(process.env.REVIEW_CALLS,'call\\n');
if(process.env.REVIEW_FAIL){console.error('test engine failure');process.exit(1);}
fs.copyFileSync(process.env.REVIEW_FIXTURE,args[args.indexOf('-o')+1]);
`,{mode:0o755});
  const out=join(dir,'output'),calls=join(dir,'calls');
  const run=(extra=[],env={})=>spawnSync(process.execPath,['scripts/generate-learning-review.mjs','--out',out,'--model','test-model',...extra],{encoding:'utf8',timeout:60000,env:{...process.env,CODEX_BIN:cli,REVIEW_FIXTURE:fixture,REVIEW_CALLS:calls,...env}});
  return {dir,out,calls,run,cli,fixture,cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}
test('real runner resumes without regenerating, verifies artifacts and rejects mixed configuration',()=>{
  const s=setup();try{
    const first=s.run();assert.equal(first.status,0,first.stdout+first.stderr);
    assert.equal(readFileSync(s.calls,'utf8').trim().split('\n').length,10);
    assert.equal(s.run().status,0);
    assert.equal(readFileSync(s.calls,'utf8').trim().split('\n').length,10,'resume must not make calls');
    assert.notEqual(s.run(['--effort','medium']).status,0,'configuration change rejected');
    const replacement=join(s.dir,'replacement');mkdirSync(replacement);
    const replacementManifest=JSON.parse(readFileSync(join(s.out,'manifest.json'),'utf8'));
    replacementManifest.batch='replacement-test';replacementManifest.config.model='replacement-model';
    replacementManifest.cases.forEach(c=>{c.status=c.brief.id==='06-linear'?'ready':'pending';});
    const content=JSON.parse(readFileSync(join(s.out,'06-linear.json'),'utf8'));content.title='Replacement';
    const bytes=JSON.stringify(content);writeFileSync(join(replacement,'06-linear.json'),bytes);
    replacementManifest.cases[5].planSha256=createHash('sha256').update(bytes).digest('hex');
    writeFileSync(join(replacement,'manifest.json'),JSON.stringify(replacementManifest));
    const packaged=join(s.dir,'corpus.json');
    const assembled=spawnSync(process.execPath,['scripts/package-learning-review.mjs','--replace',replacement,'--from',s.out,'--out',packaged],{encoding:'utf8',timeout:30000});
    assert.equal(assembled.status,0,assembled.stdout+assembled.stderr);
    const corpus=JSON.parse(readFileSync(packaged,'utf8'));
    assert.equal(corpus.cases.length,10);assert.equal(corpus.cases[5].plan.title,'Replacement');
    assert.equal(corpus.manifest.cases[5].generationConfig.model,'replacement-model');
    assert.equal(corpus.manifest.cases[0].generationConfig.model,'test-model');
    const duplicate=spawnSync(process.execPath,['scripts/package-learning-review.mjs','--from',s.out,'--from',replacement,'--out',packaged],{encoding:'utf8'});
    assert.notEqual(duplicate.status,0);assert.match(duplicate.stderr,/exactly one/);
    writeFileSync(join(s.out,'01-fractions.json'),'{}');
    const corrupt=s.run();assert.notEqual(corrupt.status,0);assert.match(corrupt.stderr,/checksum mismatch/);
    assert.equal(existsSync(join(s.out,'.generation-lock')),false,'failed resume releases lock');
  }finally{s.cleanup();}
});
test('shared failure stops scheduling, and a live batch lock prevents all generation',()=>{
  const s=setup();try{
    const failed=s.run([],{REVIEW_FAIL:'1'});assert.notEqual(failed.status,0);
    assert.equal(readFileSync(s.calls,'utf8').trim().split('\n').length,1,'do not burn ten engine failures');
    const manifest=JSON.parse(readFileSync(join(s.out,'manifest.json'),'utf8'));
    assert.equal(manifest.cases.filter(c=>c.status==='failed').length,1);
    writeFileSync(join(s.out,'.generation-lock'),JSON.stringify({pid:process.pid}));
    const locked=s.run(['--retry-failed']);assert.notEqual(locked.status,0);assert.match(locked.stderr,/Batch locked/);
    assert.equal(readFileSync(s.calls,'utf8').trim().split('\n').length,1);
  }finally{s.cleanup();}
});
test('a targeted new batch succeeds for its selected case without claiming a full corpus',()=>{
  const s=setup();try{
    const result=s.run(['--case','06-linear']);assert.equal(result.status,0,result.stdout+result.stderr);
    assert.match(result.stdout,/1\/10 complete/);
    const manifest=JSON.parse(readFileSync(join(s.out,'manifest.json'),'utf8'));
    assert.equal(manifest.cases.find(c=>c.brief.id==='06-linear').status,'ready');
    assert.equal(manifest.cases.filter(c=>c.status==='pending').length,9);
  }finally{s.cleanup();}
});

test('source drift persists a failed seal that assembly, audit and resume cannot override',()=>{
  const s=setup();try{
    const loader=join(s.dir,'fingerprint-loader.mjs');
    const loaderSource=`export async function load(url,context,next){const r=await next(url,context);if(url.endsWith('/scripts/learning-review-validation.mjs')){const source=String(r.source),a=source.indexOf('export async function sourceFingerprint() {'),b=source.indexOf('\\nexport function validateManifest',a);r.source=source.slice(0,a)+"let calls=0;export async function sourceFingerprint(){return (++calls===1?'a':'b').repeat(64);}"+source.slice(b);}return r;}`;
    writeFileSync(loader,loaderSource);
    const env={...process.env,CODEX_BIN:s.cli,REVIEW_FIXTURE:s.fixture,REVIEW_CALLS:s.calls};
    const run=()=>spawnSync(process.execPath,['--loader',loader,'scripts/generate-learning-review.mjs','--out',s.out,'--model','test-model'],{env,encoding:'utf8',timeout:60000});
    const drift=run();assert.notEqual(drift.status,0);assert.match(drift.stderr,/Generator changed during batch/);
    const manifest=JSON.parse(readFileSync(join(s.out,'manifest.json'),'utf8'));
    assert.equal(manifest.cases.filter(c=>c.status==='ready').length,10);
    assert.equal(manifest.sourceVerification.status,'failed');
    const packaged=join(s.dir,'rejected-corpus.json');
    const assemble=spawnSync(process.execPath,['scripts/package-learning-review.mjs','--from',s.out,'--out',packaged],{encoding:'utf8'});
    assert.notEqual(assemble.status,0);assert.match(assemble.stderr,/integrity has not been verified/);assert.equal(existsSync(packaged),false);
    const audit=spawnSync(process.execPath,['scripts/verify-learning-review.mjs','--from',s.out],{encoding:'utf8'});
    assert.notEqual(audit.status,0);assert.match(audit.stderr,/Source drift was recorded/);
    writeFileSync(loader,loaderSource.replace("(++calls===1?'a':'b')", "'a'"));
    const resumed=run();assert.notEqual(resumed.status,0);assert.match(resumed.stderr,/integrity previously failed/);
  }finally{s.cleanup();}
});

test('unknown, missing and repeated flags fail before any generation',()=>{
  const s=setup();try{
    for(const extra of [['--cases','06-linear'],['--case'],['--model','other']]){
      const result=s.run(extra);assert.notEqual(result.status,0);assert.equal(existsSync(s.calls),false);
    }
  }finally{s.cleanup();}
});
