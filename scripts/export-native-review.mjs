#!/usr/bin/env node
/** Synthetic native review export. No Drive writes unless --publish is explicitly supplied. */
import {parseArgs} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {getPilot} from '../src/lib/server/visual-pilot.ts';
import {exportNativeBundle,publishNativeReviewBundle} from '../src/lib/server/native-learning/bundle.ts';
const {values}=parseArgs({options:{out:{type:'string'},'activity-base-url':{type:'string'},publish:{type:'boolean',default:false}}});
if(!values.out||!values['activity-base-url'])throw Error('Usage: node scripts/export-native-review.mjs --out <new-directory> --activity-base-url https://<site>/app/native-review-activities [--publish]');
const pilot=getPilot();if(!pilot)throw Error('checked calibration corpus unavailable');
const input={bundle:pilot.bundle,key:'synthetic-normal-35372-native-v1',activityBaseUrl:values['activity-base-url']};
const result=await exportNativeBundle(input);const out=path.resolve(values.out);await mkdir(out,{recursive:false});
for(const [name,bytes]of [['lesson.pptx',result.slides],['homework.docx',result.homework]])await writeFile(path.join(out,name),bytes,{flag:'wx'});
const manifest={version:1,state:'draft',sourceHash:result.sourceHash,rendererHash:result.rendererHash,pilotVersion:pilot.version,slideCount:result.slideCount,slideMap:result.slideMap,notesLocation:result.notesLocation,activities:result.activities,...(values.publish?{receipt:await publishNativeReviewBundle(input)}:{})};
await writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({out,slideCount:result.slideCount,sourceHash:result.sourceHash,...(manifest.receipt?{receipt:manifest.receipt}:{})}));
