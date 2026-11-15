import{readFile,writeFile}from'node:fs/promises';import{createHash}from'node:crypto';
const sources=['src/lib/learning/deck/model.ts','src/lib/learning/deck/schema.ts','src/lib/learning/deck/rules.ts','src/lib/server/lesson/visual-generation.ts','src/lib/server/lesson/prompt.ts','src/lib/server/lesson/structured-output.ts','src/lib/server/native-learning/authoring.ts','src/lib/server/native-learning/preparation-brief.ts','src/lib/server/native-learning/context.ts'].sort();
const files={};for(const p of sources)files[p]=createHash('sha256').update(await readFile(p)).digest('hex');
const value={version:1,files,fingerprint:createHash('sha256').update(JSON.stringify(files)).digest('hex')};
const p='src/lib/server/native-learning/authoring-manifest.json';
if(process.argv.includes('--check')){if(JSON.stringify(JSON.parse(await readFile(p,'utf8')))!==JSON.stringify(value))throw Error('Native authoring fingerprint is stale');}else await writeFile(p,JSON.stringify(value,null,2)+'\n');
