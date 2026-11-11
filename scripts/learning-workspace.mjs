#!/usr/bin/env node
import {readFile}from'node:fs/promises';
import{workspaceClient}from'../src/lib/server/learning-workspace.ts';
import{learningContext}from'../src/lib/learning/workspace.ts';
const args=process.argv.slice(2),opts={};let includeDemo=false,command;
try{
 for(let i=0;i<args.length;i++){const a=args[i];if(a==='--include-demo'){if(includeDemo)throw Error('duplicate flag');includeDemo=true;}else if(a==='--config'||a==='--student'){if(opts[a]||!args[i+1]||args[i+1].startsWith('--'))throw Error('invalid option');opts[a]=args[++i];}else if(['status','context'].includes(a)&&!command)command=a;else throw Error('unknown command or option');}
 if(!opts['--config']||!command||command==='context'&&!opts['--student']||command==='status'&&(opts['--student']||includeDemo))throw Error('Usage: --config <private-workspace.json> status | context --student <id> [--include-demo]');
 const config=JSON.parse(await readFile(opts['--config'],'utf8')),client=workspaceClient({config});
 const result=command==='status'?await client.status():learningContext(await client.readSnapshot(),opts['--student'],{includeDemo});
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
}catch(e){process.stderr.write((e instanceof Error?e.message:'learning workspace command failed')+'\n');process.exitCode=1;}
