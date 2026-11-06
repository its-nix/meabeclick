/** Drive the actual fresh-generation path using an inert CLI, including its optional retry. */
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateLesson } from '../src/lib/server/lesson/prep.ts';

export async function generatedPlanStub(plan,{invalidFirst=false}={}) {
  const dir=await mkdtemp(join(tmpdir(),'generated-plan-stub-'));
  const saved={CODEX_BIN:process.env.CODEX_BIN,LESSON_ENGINE:process.env.LESSON_ENGINE};
  try {
    const fixture=join(dir,'plan.json'),calls=join(dir,'calls'),cli=join(dir,'codex');
    await writeFile(fixture,JSON.stringify(plan));
    await writeFile(cli,`#!/usr/bin/env node
const fs=require('node:fs'),args=process.argv.slice(2),calls=${JSON.stringify(calls)};
process.stdin.resume();process.stdin.on('end',()=>{
const first=!fs.existsSync(calls);fs.appendFileSync(calls,'call\\n');
const output=args[args.indexOf('-o')+1];
if(first&&${invalidFirst})fs.writeFileSync(output,'{"truncated":');else fs.copyFileSync(${JSON.stringify(fixture)},output);
});
`,{mode:0o755});
    process.env.CODEX_BIN=cli;process.env.LESSON_ENGINE='codex';
    const result=await generateLesson({subject:'מתמטיקה',level:'כיתה ח',request:'בדיקה מדומה'});
    return {result,runs:(await readFile(calls,'utf8')).trim().split('\n').length};
  } finally {
    for(const [key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    await rm(dir,{recursive:true,force:true});
  }
}
