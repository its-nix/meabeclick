#!/usr/bin/env node
/** Assemble validated synthetic candidates, retaining each original generation version. Never imports into the library. */
import { readFile, writeFile, mkdtemp, rm, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { validateManifest, readVerifiedPlan, validatePlan, sourceFingerprint, LEGACY_SOURCE_FILES } from './learning-review-validation.mjs';
const args=process.argv.slice(2),replacements=[];
let baselineDirectory,destination='src/lib/server/learning-review-corpus.json',hasDestination=false;
for(let i=0;i<args.length;i++){
  const name=args[i],value=args[++i];
  if(!['--from','--replace','--out'].includes(name)||!value||value.startsWith('--'))throw Error('Usage: --from <baseline-directory> [--replace <candidate-directory>] [--out <corpus-file>]');
  if(name==='--from'){
    if(baselineDirectory)throw Error('Specify exactly one --from baseline');
    baselineDirectory=resolve(value);
  }else if(name==='--replace')replacements.push(resolve(value));
  else {if(hasDestination)throw Error('Specify only one --out');destination=resolve(value);hasDestination=true;}
}
if(!baselineDirectory)throw Error('Specify exactly one --from baseline');
const sources=[baselineDirectory,...replacements];
const isolated=await mkdtemp(join(tmpdir(),'meabeclick-review-package-'));
process.env.DATA_DIR=isolated;process.env.DB_PATH=join(isolated,'results.db');
try {
  const versions=[];
  for(const out of sources){
    const manifest=JSON.parse(await readFile(join(out,'manifest.json'),'utf8'));validateManifest(manifest);
    if(manifest.sourceVerification?.status!=='verified'||manifest.sourceVerification.fingerprint!==manifest.config.sourceFingerprint)throw Error('Batch source integrity has not been verified; refuse assembly');
    if(!manifest.config.sourceFiles)manifest.config.sourceFiles=LEGACY_SOURCE_FILES;
    versions.push({out,manifest});
  }
  const baseline=versions[0].manifest;
  const cases=[],metadata=[];
  for(const initial of baseline.cases){
    // Only an explicitly supplied replacement directory may supersede a case, never silently mix folders.
    const chosen=versions.toReversed().find(v=>v.manifest.cases.some(c=>c.brief.id===initial.brief.id&&c.status==='ready'));
    if(!chosen)throw Error(`No validated generation available: ${initial.brief.id}`);
    const item=chosen.manifest.cases.find(c=>c.brief.id===initial.brief.id);
    const plan=await readVerifiedPlan(chosen.out,item);await validatePlan(plan);
    cases.push({brief:item.brief,plan});
    metadata.push({...item,generationConfig:chosen.manifest.config,sourceBatch:chosen.manifest.batch});
  }
  const manifest={...baseline,cases:metadata,assembledAt:new Date().toISOString(),validatedWithSource:await sourceFingerprint(),generationVersions:versions.map(v=>({batch:v.manifest.batch,config:v.manifest.config,sourceVerification:v.manifest.sourceVerification,failedCases:v.manifest.cases.filter(c=>c.status==='failed').map(c=>({id:c.brief.id,error:c.error}))})),mixedSourceVersions:new Set(metadata.map(c=>c.generationConfig.sourceFingerprint)).size>1};
  const temporary=destination+`.tmp-${process.pid}`;
  await writeFile(temporary,JSON.stringify({manifest,cases},null,2)+'\n');await rename(temporary,destination);
  console.log(`Packaged ${cases.length} synthetic bundles from ${versions.length} explicit candidates. Teaching review remains pending.`);
} finally {await rm(isolated,{recursive:true,force:true});}
