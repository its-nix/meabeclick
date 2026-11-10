#!/usr/bin/env node
import {readFile,writeFile,mkdir,mkdtemp,rm,open} from 'node:fs/promises';
import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {spawnSync} from 'node:child_process';
import {newManifest,readCandidate,sealCandidate,validateManifest,sourceFingerprint,normalized,PILOT_CONTEXT,PILOT_SOURCES} from './visual-pilot-validation.mjs';
const args=process.argv.slice(2),opts={};let retry=false;
for(let i=0;i<args.length;i++){const k=args[i];if(k==='--retry-failed'){if(retry)throw Error('duplicate retry');retry=true;continue;}if(!['--out','--model','--timeout-minutes'].includes(k)||opts[k]!==undefined||!args[i+1]||args[i+1].startsWith('--'))throw Error('Usage: --out <new-directory> --model <account-model> [--timeout-minutes 15] [--retry-failed]');opts[k]=args[++i];}
const minutes=Number(opts['--timeout-minutes']??15);if(!opts['--out']||!opts['--model']||!Number.isFinite(minutes)||minutes<1||minutes>30)throw Error('explicit output, model and timeout 1–30 minutes required');
const dir=resolve(opts['--out']);await mkdir(dir,{recursive:true});const lock=await open(join(dir,'.lock'),'wx');const isolated=await mkdtemp(join(tmpdir(),'mea-visual-pilot-'));process.env.DATA_DIR=isolated;process.env.DB_PATH=join(isolated,'review.db');let manifest;
try{
 const bin=process.env.CODEX_BIN||'codex';const cli=spawnSync(bin,['--version'],{encoding:'utf8',timeout:60000});if(cli.status!==0)throw Error('cannot verify Codex CLI version');const cliVersion=cli.stdout.trim();
 try{manifest=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(manifest){validateManifest(manifest);if(manifest.config.model!==opts['--model']||manifest.config.cliVersion!==cliVersion||manifest.config.sourceFingerprint!==await sourceFingerprint())throw Error('candidate configuration/source changed; use a new directory');if(manifest.status==='ready'){await readCandidate(dir);console.log('Existing sealed candidate verified: '+dir);process.exitCode=0;}else if(!retry)throw Error('interrupted/failed generation requires diagnosis and --retry-failed');}
 else manifest=await newManifest({model:opts['--model'],cliVersion});
 if(manifest.status!=='ready'){
  manifest.status='generating';await writeFile(join(dir,'manifest.json'),normalized(manifest));const started=Date.now();
  const {generateVisualLesson}=await import('../src/lib/server/lesson/visual-generation.ts');const bundle=await generateVisualLesson({context:PILOT_CONTEXT,sourceIds:PILOT_SOURCES,model:opts['--model'],timeoutMs:minutes*60000,onRejected:async({attempt,issues,response})=>{const file=`rejected-${attempt}.txt`;await writeFile(join(dir,file),response);(manifest.rejections??=[]).push({attempt,issues,file});await writeFile(join(dir,'manifest.json'),normalized(manifest));console.log('Rejected attempt '+attempt+': '+issues.join('; '));}});
  await sealCandidate(dir,manifest,bundle,(Date.now()-started)/1000);console.log('Sealed visual pilot: '+dir+' ('+manifest.seconds+'s)');
 }
}catch(e){if(manifest&&manifest.status!=='ready'){manifest.status='failed';manifest.failure={kind:e.kind??'candidate-failed',message:e.message};await writeFile(join(dir,'manifest.json'),normalized(manifest));}console.error(e);process.exitCode=1;}
finally{await lock.close();await rm(join(dir,'.lock'),{force:true});await rm(isolated,{recursive:true,force:true});}
