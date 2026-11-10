#!/usr/bin/env node
/** Assemble validated synthetic candidates, retaining each original generation version. Never imports into the library. */
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { validateManifest, readVerifiedPlan, validatePlan, sourceFingerprint, LEGACY_SOURCE_FILES } from './learning-review-validation.mjs';
const args=process.argv.slice(2),replacements=[],gameReplacements=[];
let baselineDirectory,destination='src/lib/server/learning-review-corpus.json',hasDestination=false;
for(let i=0;i<args.length;i++){
  const name=args[i],value=args[++i];
  if(!['--from','--replace','--replace-game','--out'].includes(name)||!value||value.startsWith('--'))throw Error('Usage: --from <baseline-directory> [--replace <candidate-directory>] [--replace-game <case-id:game-key=directory>] [--out <corpus-file>]');
  if(name==='--from'){
    if(baselineDirectory)throw Error('Specify exactly one --from baseline');
    baselineDirectory=resolve(value);
  }else if(name==='--replace')replacements.push(resolve(value));
  else if(name==='--replace-game'){const match=value.match(/^([a-z0-9-]+):([a-zA-Z]+)=(.+)$/);if(!match)throw Error('Invalid --replace-game selection');if(gameReplacements.some(p=>p.id===match[1]&&p.key===match[2]))throw Error('Repeated game replacement');gameReplacements.push({id:match[1],key:match[2],out:resolve(match[3])});}
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
  const selectionVersions=[...versions];
  const baseline=versions[0].manifest;
  if(gameReplacements.length&&baseline.config.generationVersion!==2)throw Error('Game assembly requires v2');
  for(const patch of gameReplacements){
    if(!baseline.cases.some(c=>c.brief.id===patch.id))throw Error('Unknown case for game assembly');
    if(versions.some(v=>v.out===patch.out))continue;
    const manifest=JSON.parse(await readFile(join(patch.out,'manifest.json'),'utf8'));validateManifest(manifest);
    if(manifest.sourceVerification?.status!=='verified'||manifest.sourceVerification.fingerprint!==manifest.config.sourceFingerprint)throw Error('Game source integrity has not been verified');
    versions.push({out:patch.out,manifest});
  }
  if(versions.some(v=>(v.manifest.config.generationVersion??1)!==(baseline.config.generationVersion??1)))throw Error('Cannot mix generator versions');
  if(baseline.config.generationVersion===2){if(!hasDestination)destination=resolve('src/lib/server/learning-review-v2-corpus.json');else if(destination===resolve('src/lib/server/learning-review-corpus.json'))throw Error('Candidate version must not replace baseline corpus');}
  const cases=[],metadata=[];
  for(const initial of baseline.cases){
    // Only an explicitly supplied replacement directory may supersede a case, never silently mix folders.
    const chosen=selectionVersions.toReversed().find(v=>v.manifest.cases.some(c=>c.brief.id===initial.brief.id&&c.status==='ready'));
    if(!chosen)throw Error(`No validated generation available: ${initial.brief.id}`);
    const item=chosen.manifest.cases.find(c=>c.brief.id===initial.brief.id);
    const plan=structuredClone(await readVerifiedPlan(chosen.out,item)),assetReplacements=[];
    for(const patch of gameReplacements.filter(p=>p.id===item.brief.id)){
      const source=versions.find(v=>v.out===patch.out),donorItem=source.manifest.cases.find(c=>c.brief.id===patch.id&&c.status==='ready');
      if(!donorItem)throw Error('Game source is not ready');
      const donor=await readVerifiedPlan(source.out,donorItem);
      if(!isDeepStrictEqual(plan.teaching?.context,donor.teaching?.context))throw Error('Game source teaching context differs');
      const {TEMPLATE_FILES,toTemplateShape}=await import('../src/lib/server/lesson/prep.ts');
      const {validateLessonGame}=await import('../src/lib/server/lesson-games.ts');
      if(!Object.hasOwn(TEMPLATE_FILES,patch.key)||!Object.hasOwn(plan.games,patch.key)||!plan.games[patch.key]||!donor.games?.[patch.key])throw Error('Game replacement must select an existing activity');
      validateLessonGame(TEMPLATE_FILES[patch.key],toTemplateShape(patch.key,donor.games[patch.key]));
      plan.games[patch.key]=structuredClone(donor.games[patch.key]);
      assetReplacements.push({asset:`games.${patch.key}`,sourceBatch:source.manifest.batch,generationConfig:source.manifest.config,sourcePlanSha256:donorItem.planSha256,sourceFinishedAt:donorItem.finishedAt,sourceSeconds:donorItem.seconds,assetSha256:createHash('sha256').update(JSON.stringify(plan.games[patch.key])).digest('hex')});
    }
    await validatePlan(plan,chosen.manifest.config.generationVersion??1);
    cases.push({brief:item.brief,plan});
    metadata.push({...item,...(assetReplacements.length?{basePlanSha256:item.planSha256,planSha256:createHash('sha256').update(JSON.stringify(plan,null,2)+'\n').digest('hex'),assetReplacements}:{}),generationConfig:chosen.manifest.config,sourceBatch:chosen.manifest.batch});
  }
  const manifest={...baseline,cases:metadata,assembledAt:new Date().toISOString(),assemblyScriptSha256:createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),validatedWithSource:await sourceFingerprint(),generationVersions:versions.map(v=>({batch:v.manifest.batch,config:v.manifest.config,sourceVerification:v.manifest.sourceVerification,failedCases:v.manifest.cases.filter(c=>c.status==='failed').map(c=>({id:c.brief.id,error:c.error}))})),mixedSourceVersions:new Set(metadata.flatMap(c=>[c.generationConfig.sourceFingerprint,...(c.assetReplacements??[]).map(a=>a.generationConfig.sourceFingerprint)])).size>1};
  const temporary=destination+`.tmp-${process.pid}`;
  await writeFile(temporary,JSON.stringify({manifest,cases},null,2)+'\n');await rename(temporary,destination);
  console.log(`Packaged ${cases.length} synthetic bundles from ${versions.length} explicit candidates. Teaching review remains pending.`);
} finally {await rm(isolated,{recursive:true,force:true});}
