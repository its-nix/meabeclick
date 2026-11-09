#!/usr/bin/env node
// Cache only catalogue-approved documents. This command cannot approve a new question.
import {mkdir,writeFile} from 'node:fs/promises';import{resolve,join}from'node:path';
import{officialQuestion,verifyImport}from'../src/lib/server/lesson/official-questions.ts';
const [id,dir,...extra]=process.argv.slice(2);const q=officialQuestion(id??'');
if(!q||!dir||extra.length)throw new Error('Usage: node scripts/cache-official-question.mjs <catalogue-id> <private-cache-dir>');
const response=await fetch(q.url,{redirect:'error',signal:AbortSignal.timeout(20000)});
if(!response.ok||Number(response.headers.get('content-length'))>12_000_000)throw new Error('Official PDF unavailable');
const reader=response.body.getReader(),chunks=[];let size=0;
for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>12_000_000){await reader.cancel();throw new Error('PDF too large');}chunks.push(value);}
const pdf=Buffer.concat(chunks);verifyImport(q,pdf);await mkdir(resolve(dir),{recursive:true,mode:0o700});await writeFile(join(resolve(dir),id+'.pdf'),pdf,{mode:0o600});
console.log(JSON.stringify({id,bytes:pdf.length,sha256:q.documentSha256}));
