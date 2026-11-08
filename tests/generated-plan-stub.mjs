/** Drive the actual fresh-generation path using an inert CLI, including its optional retry. */
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { passingCritique } from './helpers/generation-plan.mjs';
import { generateLesson } from '../src/lib/server/lesson/prep.ts';

export async function generatedPlanStub(plan,{invalidFirst=false,repairOutput}={}) {
  const dir=await mkdtemp(join(tmpdir(),'generated-plan-stub-'));
  const saved={CODEX_BIN:process.env.CODEX_BIN,LESSON_ENGINE:process.env.LESSON_ENGINE};
  try {
    const fixture=join(dir,'plan.json'),calls=join(dir,'calls'),cli=join(dir,'codex');
    await writeFile(fixture,JSON.stringify(plan));
    const repair=join(dir,'repair.json');if(repairOutput!==undefined)await writeFile(repair,JSON.stringify(repairOutput));
    const critique=join(dir,'critique.json'),critiqueCalls=join(dir,'critique-calls');
    await writeFile(critique,JSON.stringify(passingCritique(plan)));
    await writeFile(cli,`#!/usr/bin/env node
const fs=require('node:fs'),args=process.argv.slice(2),calls=${JSON.stringify(calls)};
let prompt='';process.stdin.on('data',chunk=>prompt+=chunk);process.stdin.on('end',()=>{
const output=args[args.indexOf('-o')+1];
if(prompt.startsWith('GENERATION_QUALITY_CRITIQUE')){fs.appendFileSync(${JSON.stringify(critiqueCalls)},'call\\n');fs.copyFileSync(${JSON.stringify(critique)},output);return;}
const first=!fs.existsSync(calls);fs.appendFileSync(calls,'call\\n');
if(prompt.includes('TARGETED_ARTIFACT_REPAIR')&&fs.existsSync(${JSON.stringify(repair)})){fs.copyFileSync(${JSON.stringify(repair)},output);return;}
if(first&&${invalidFirst})fs.writeFileSync(output,'{"truncated":');else fs.copyFileSync(${JSON.stringify(fixture)},output);
});
`,{mode:0o755});
    process.env.CODEX_BIN=cli;process.env.LESSON_ENGINE='codex';
    const result=await generateLesson({subject:'מתמטיקה',level:'כיתה ח',request:'בדיקה מדומה'});
    return {result,critiques:(await readFile(critiqueCalls,'utf8')).trim().split('\n').length,runs:(await readFile(calls,'utf8')).trim().split('\n').length};
  } finally {
    for(const [key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    await rm(dir,{recursive:true,force:true});
  }
}
