#!/usr/bin/env node
/** Refresh after changing native authoring. CI verifies this receipt; runtime only imports JSON. */
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const sources=[
 'Dockerfile',
 'package-lock.json',
 'src/lib/brand.ts',
 'src/lib/learning/deck/model.ts',
 'src/lib/learning/deck/normal.ts',
 'src/lib/learning/math.ts',
 'src/lib/server/lesson/official-question-assets.json',
 'src/lib/server/lesson/official-questions.ts',
 'src/lib/server/native-learning/bundle.ts',
 'src/lib/server/native-learning/motion.ts',
 'static/images/logos/logo-slate.svg',
 'static/learning-assets/native-fonts/Heebo.ttf',
].sort();
const files={};
for(const name of sources)files[name]=createHash('sha256').update(await readFile(new URL(name,root))).digest('hex');
const manifest={version:1,rendererHash:createHash('sha256').update(JSON.stringify({version:1,files})).digest('hex'),files};
const target=new URL('src/lib/server/native-learning/renderer-manifest.json',root);
if(process.argv.includes('--check')){
 if(JSON.stringify(JSON.parse(await readFile(target,'utf8')))!==JSON.stringify(manifest))throw Error('Native renderer manifest is stale. Run node scripts/native-renderer-manifest.mjs; changed rendering creates a new immutable draft.');
}else await writeFile(target,JSON.stringify(manifest,null,2)+'\n');
console.log(manifest.rendererHash);
