import {test} from 'node:test';
import assert from 'node:assert/strict';
import {visualDeckFixture} from '../visual-deck-fixture.mjs';
import {provider,config} from '../central-drive-fixture.mjs';
import {exportNativeBundle,publishNativeReviewBundle} from '../../src/lib/server/native-learning/bundle.ts';

test('native export creates real editable packages with separate private answers and question-only homework',async()=>{
 const bundle=visualDeckFixture();bundle.slides[0].presenterNotes.expectedAnswer='PRIVATE_EXPECTED_9';bundle.homework[0].solution='PRIVATE_SOLUTION_9';
 const out=await exportNativeBundle({bundle,activityBaseUrl:'https://meabeclick.com/app/learning-pilot'});
 assert.equal(out.slides.subarray(0,2).toString(),'PK');assert.equal(out.homework.subarray(0,2).toString(),'PK');
 const {readFile}=await import('node:fs/promises');
 const logo=await readFile(new URL('../../static/images/logos/logo-slate.svg',import.meta.url),'utf8');
 const intrinsic=logo.match(/viewBox="[^"]*?([\d.]+) ([\d.]+)"/);const ratio=Number(intrinsic[1])/Number(intrinsic[2]);
 for(const [key,file,pattern]of [['slides','ppt/slides/slide1.xml',/<p:pic>[\s\S]*?<a:ext cx="(\d+)" cy="(\d+)"/],['homework','word/document.xml',/<wp:extent cx="(\d+)" cy="(\d+)"/],['tutorNotes','word/document.xml',/<wp:extent cx="(\d+)" cy="(\d+)"/]]){
  const match=officeMembers(out[key]).get(file).toString().match(pattern);assert.ok(match,key+' logo missing');assert.ok(Math.abs(Number(match[1])/Number(match[2])-ratio)<.00001,key+' logo must preserve the shared artwork aspect ratio');
 }

 assert.match(out.tutorText,/PRIVATE_EXPECTED_9/);assert.match(out.tutorText,/PRIVATE_SOLUTION_9/);assert.doesNotMatch(out.homeworkText,/PRIVATE_/);
 assert.ok(out.slideCount>bundle.slides.length,'authored model states/reveals become progressive slides');
 assert.equal(out.slideMap[0].firstSlide,1);assert.equal(out.slideMap.at(-1).lastSlide,out.slideCount);assert.match(out.tutorText,/שקפים \u20661–/);
 assert.equal(out.activities.length,3);assert.ok(out.activities.every(a=>a.url.startsWith('https://meabeclick.com/app/learning-pilot')));
 const changed=structuredClone(bundle);changed.homework[0].solution+=' new revision';
 assert.notEqual(out.sourceHash,(await exportNativeBundle({bundle:changed,activityBaseUrl:'https://meabeclick.com/app/learning-pilot'})).sourceHash);
});

test('review publisher creates native MIME documents and replay preserves human edits',async()=>{
 const p=provider();const workspace={workspaceId:'workspace12345',reviewId:'review12345'};
 p.files.set(workspace.workspaceId,{id:workspace.workspaceId,mimeType:'application/vnd.google-apps.folder',parents:[config.learningFolderId],owners:[{emailAddress:config.ownerEmail}],permissions:[{type:'user'}]});
 p.files.set(workspace.reviewId,{id:workspace.reviewId,mimeType:'application/vnd.google-apps.folder',parents:[workspace.workspaceId],owners:[{emailAddress:config.ownerEmail}],permissions:[{type:'user'}]});
 const dependencies={access:p.access,workspace,fetch:p.fetch};const input={bundle:visualDeckFixture(),key:'synthetic-pilot',activityBaseUrl:'https://meabeclick.com/app/learning-pilot'};
 const first=await publishNativeReviewBundle(input,dependencies);p.files.get(first.slides.id).human='edited';const count=p.files.size;
 const second=await publishNativeReviewBundle(input,dependencies);
 assert.equal(first.slides.mimeType,'application/vnd.google-apps.presentation');assert.equal(first.homework.mimeType,'application/vnd.google-apps.document');assert.equal(second.slides.id,first.slides.id);assert.equal(p.files.size,count);assert.equal(p.files.get(first.slides.id).human,'edited');
 assert.ok(p.calls.every(c=>!c.url.includes('/permissions')));assert.equal(first.state,'draft');
 p.files.get(workspace.reviewId).permissions=[{type:'anyone'}];await assert.rejects(publishNativeReviewBundle(input,dependencies),/privacy/);
});

test('lost native import acknowledgement reconciles by immutable source before creating anything else',async()=>{
 const p=provider(),workspace={workspaceId:'workspace12345',reviewId:'review12345'};
 for(const [id,parent]of [[workspace.workspaceId,config.learningFolderId],[workspace.reviewId,workspace.workspaceId]])p.files.set(id,{id,mimeType:'application/vnd.google-apps.folder',parents:[parent],owners:[{emailAddress:config.ownerEmail}],permissions:[{type:'user'}]});
 let lost=false;const fetch=async(input,init)=>{const response=await p.fetch(input,init);if(!lost&&String(input).includes('uploadType=multipart')){lost=true;throw Error('lost acknowledgement');}return response;};
 const dependencies={access:p.access,workspace,fetch};const input={bundle:visualDeckFixture(),key:'lost-import-pilot',activityBaseUrl:'https://meabeclick.com/app/learning-pilot'};
 await assert.rejects(publishNativeReviewBundle(input,dependencies),/google/);
 const slides=[...p.files.values()].find(f=>f.mimeType==='application/vnd.google-apps.presentation');slides.human='survives retry';
 const result=await publishNativeReviewBundle(input,dependencies);
 assert.equal(result.slides.id,slides.id);assert.equal(slides.human,'survives retry');assert.equal([...p.files.values()].filter(f=>f.mimeType==='application/vnd.google-apps.presentation').length,1);
});

test('committed renderer identity matches exporter, shared visuals, brand, fonts and locked dependencies',async()=>{
 const {readFile}=await import('node:fs/promises');const {createHash}=await import('node:crypto');
 const manifest=JSON.parse(await readFile(new URL('../../src/lib/server/native-learning/renderer-manifest.json',import.meta.url),'utf8'));
 const files={};
 for(const name of Object.keys(manifest.files))files[name]=createHash('sha256').update(await readFile(new URL('../../'+name,import.meta.url))).digest('hex');
 assert.deepEqual(manifest.files,files,'Renderer changed: run node scripts/native-renderer-manifest.mjs to create a new immutable native draft identity');
 assert.equal(manifest.rendererHash,createHash('sha256').update(JSON.stringify({version:1,files})).digest('hex'));
});

// Read Office ZIP members with built-in decompression so this regression needs no external CLI.
function officeMembers(bytes){
 const {inflateRawSync}=builtinZlib;const entries=new Map();
 const end=bytes.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));let offset=bytes.readUInt32LE(end+16);
 for(let i=0;i<bytes.readUInt16LE(end+10);i++){
  const method=bytes.readUInt16LE(offset+10),size=bytes.readUInt32LE(offset+20),nameLength=bytes.readUInt16LE(offset+28),extraLength=bytes.readUInt16LE(offset+30),commentLength=bytes.readUInt16LE(offset+32),local=bytes.readUInt32LE(offset+42),name=bytes.subarray(offset+46,offset+46+nameLength).toString();
  const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28),content=bytes.subarray(start,start+size);
  assert.ok(method===0||method===8);entries.set(name,method===8?inflateRawSync(content):content);offset+=46+nameLength+extraLength+commentLength;
 }
 return entries;
}
const builtinZlib=await import('node:zlib');
test('double-dollar math renders as formula assets in public slides, homework and private notes',async()=>{
 const bundle=visualDeckFixture(),activityBaseUrl='https://meabeclick.com/app/learning-pilot';
 const baseline=await exportNativeBundle({bundle,activityBaseUrl});
 const expression='$$\\frac{17}{29}$$';
 bundle.slides[0].prompt='איזה חלק מייצג '+expression+'?';
 bundle.homework[0].prompt='מה משמעות החלק '+expression+'?';
 bundle.slides[0].presenterNotes.explanation='מסבירים את '+expression+' בעזרת חלוקה לחלקים.';
 const rendered=await exportNativeBundle({bundle,activityBaseUrl});
 for(const key of ['slides','homework','tutorNotes']){
  const entries=officeMembers(rendered[key]),before=officeMembers(baseline[key]);
  const xml=[...entries].filter(([name])=>name.endsWith('.xml')).map(([,bytes])=>bytes.toString()).join('\n');
  const textRuns=[...xml.matchAll(/<(?:a|w):t(?:\s[^>]*)?>([\s\S]*?)<\/(?:a|w):t>/g)].map(match=>match[1]).join('\n');
  assert.doesNotMatch(textRuns,/\$\$|\\frac\{17\}\{29\}/,key+' contains raw TeX instead of a formula');
  assert.ok([...entries.keys()].filter(name=>name.includes('/media/')&&!name.endsWith('/')).length>[...before.keys()].filter(name=>name.includes('/media/')&&!name.endsWith('/')).length,key+' must contain the new rendered formula image');
 }
});
