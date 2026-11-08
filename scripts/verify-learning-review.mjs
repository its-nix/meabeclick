#!/usr/bin/env node
/** Explicit audit for historical batches created before durable verification seals existed. */
import { readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { validateManifest, readVerifiedPlan, readVerifiedQualityReport, SOURCE_FILES, PRE_CONTROLS_SOURCE_FILES, PRE_GRAPH_SOURCE_FILES, PRE_QUALITY_SOURCE_FILES, LEGACY_SOURCE_FILES } from './learning-review-validation.mjs';
const args=process.argv.slice(2),option=name=>{const i=args.indexOf('--'+name);return i<0?null:args[i+1];};
const from=option('from');if(!from)throw Error('Specify --from <historical-batch> [--source-ref <commit>]');
const directory=resolve(from),path=join(directory,'manifest.json');
const manifest=JSON.parse(await readFile(path,'utf8'));validateManifest(manifest);
if(manifest.sourceVerification?.status==='failed')throw Error('Source drift was recorded. Generate a new candidate; do not override the failed guard.');
const files=manifest.config.sourceFiles??LEGACY_SOURCE_FILES;
if(![SOURCE_FILES,PRE_CONTROLS_SOURCE_FILES,PRE_GRAPH_SOURCE_FILES,PRE_QUALITY_SOURCE_FILES,LEGACY_SOURCE_FILES].some(allowed=>JSON.stringify(allowed)===JSON.stringify(files)))throw Error('Unknown fingerprint file scope');
const ref=option('source-ref');
const commit=ref?execFileSync('git',['rev-parse','--verify',`${ref}^{commit}`],{encoding:'utf8'}).trim():null;
const hash=createHash('sha256'),currentFallbackFiles=[];
for(const file of files){
  let content;
  if(commit){
    try{content=execFileSync('git',['show',`${commit}:${file}`],{stdio:['ignore','pipe','ignore']});}
    catch{content=await readFile(file);currentFallbackFiles.push(file);}
  }else content=await readFile(file);
  hash.update(file).update(content);
}
if(hash.digest('hex')!==manifest.config.sourceFingerprint)throw Error('Historical source snapshot does not match its recorded fingerprint');
for(const item of manifest.cases.filter(c=>c.status==='ready')) {
  const plan=await readVerifiedPlan(directory,item);
  await readVerifiedQualityReport(directory,item,plan,manifest.config.qualityReportsRequired===true);
}
manifest.sourceVerification={status:'verified',fingerprint:manifest.config.sourceFingerprint,method:'audited-source-snapshot',sourceRef:commit,currentFallbackFiles,verifiedAt:new Date().toISOString()};
await writeFile(path+'.audit.tmp',JSON.stringify(manifest,null,2));await rename(path+'.audit.tmp',path);
console.log(`Verified historical source and artifact checksums: ${manifest.batch}. Teaching validation/approval is separate.`);
