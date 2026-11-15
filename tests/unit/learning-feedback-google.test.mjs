import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyFeedbackFile,listFeedbackComments,readFeedbackSnapshot,applyFeedbackPatches,syncFeedbackSheet,ackFeedbackCommand,appendReplyOnce,FEEDBACK_SLIDES,FEEDBACK_DOC,FEEDBACK_SHEET} from '../../src/lib/server/learning-feedback/google.ts';
const fileId='feedback-file-12345',parentId='review-parent-12345',indexId='teaching-index-12345';
function slides(){return{presentationId:fileId,revisionId:'revision-1',slides:[{objectId:'slide1',pageElements:[{objectId:'title1',shape:{text:{textElements:[{textRun:{content:'כותרת\n'}}]}}},{objectId:'body11',shape:{text:{textElements:[{textRun:{content:'הסבר מסורבל כאן\n'}}]}}},{objectId:'brand-logo',image:{contentUrl:'https://example.test/logo'}}],slideProperties:{notesPage:{objectId:'notespage1',notesProperties:{speakerNotesObjectId:'notesbody1'},pageElements:[{objectId:'notesbody1',shape:{text:{textElements:[{textRun:{content:'פתרון פרטי למורה\n'}}]}}}]}}}]};}
function slideApi(){let value=slides(),writes=0,lost=false;const requests=[];return{scope:'expected-scope',privateFolder:async()=>{},requests,get writes(){return writes;},set lost(v){lost=v;},get value(){return value;},async json(url,init){if(!init)return structuredClone(value);writes++;const body=JSON.parse(init.body);requests.push(body);assert.equal(body.writeControl.requiredRevisionId,value.revisionId);for(const r of body.requests){const item=r.deleteText??r.insertText;let shape;for(const s of value.slides){shape=[...s.pageElements,...s.slideProperties.notesPage.pageElements].find(e=>e.objectId===item.objectId)??shape;}assert.ok(shape);const run=shape.shape.text.textElements[0].textRun;if(r.deleteText){const range=item.textRange;run.content=run.content.slice(0,range.startIndex)+run.content.slice(range.endIndex);}else run.content=run.content.slice(0,item.insertionIndex)+item.text+run.content.slice(item.insertionIndex);}value.revisionId='revision-'+(writes+1);if(lost){lost=false;throw Error('lost response');}return{};}};}
test('feedback file verification rejects foreign scope, owners, sharing, parents and unsupported files',async()=>{
 let change={};const api={scope:'scope',json:async()=>({id:fileId,name:'מצגת',mimeType:FEEDBACK_SLIDES,parents:[parentId],owners:[{emailAddress:'owner@example.test'}],permissions:[{type:'user'}],appProperties:{meaCentralScope:'scope'},...change})};
 assert.equal((await verifyFeedbackFile(api,fileId,parentId,'OWNER@example.test')).id,fileId);
 for(const [value,error]of [[{trashed:true},'conflict'],[{parents:['elsewhere']},'conflict'],[{owners:[]},'ownership'],[{permissions:[{type:'anyone'}]},'privacy'],[{permissions:undefined},'privacy'],[{appProperties:{meaCentralScope:'other'}},'conflict'],[{mimeType:'image/png'},'conflict']]){change=value;await assert.rejects(verifyFeedbackFile(api,fileId,parentId,'owner@example.test'),new RegExp(error));}
});
test('comment collection paginates threads and replies and marks own acknowledgements',async()=>{
 const calls=[];const api={async json(url){calls.push(url);const u=new URL(url);if(u.pathname.endsWith('/comments'))return u.searchParams.has('pageToken')?{comments:[{id:'c2',deleted:true}]}:{comments:[{id:'c1',content:'לא ברור',quotedFileContent:{value:'הסבר'},author:{displayName:'Tutor'}}],nextPageToken:'page2'};if(u.pathname.includes('/c2/'))return{replies:[]};return u.searchParams.has('pageToken')?{replies:[{id:'r2',content:'[MeaBeclick agent run1:proposal]\nתוקן',author:{me:true}}]}:{replies:[{id:'r1',content:'הערה נוספת',author:{displayName:'Tutor'}}],nextPageToken:'reply2'};}};
 const rows=await listFeedbackComments(api,fileId);assert.equal(rows.length,2);assert.equal(rows[0].quotedText,'הסבר');assert.equal(rows[0].replies.length,2);assert.equal(rows[0].replies[0].agent,false);assert.equal(rows[0].replies[1].agent,true);assert.equal(rows[1].deleted,true);assert.ok(calls.every(u=>u.includes('includeDeleted=true')));
});
test('repeated pagination tokens stop rather than looping forever',async()=>{
 let calls=0;const api={async json(){calls++;return{comments:[],nextPageToken:'again'};}};await assert.rejects(listFeedbackComments(api,fileId),/google_response/);assert.equal(calls,2);
});
test('slide corrections target only the expected shape and keep brand and private notes intact',async()=>{
 const api=slideApi();const before=await readFeedbackSnapshot(api,fileId,FEEDBACK_SLIDES);assert.equal(before.targets.find(t=>t.kind==='notes').editable,true);assert.ok(!before.targets.some(t=>t.id.includes('logo')));
 const after=await applyFeedbackPatches(api,before,[{targetId:'slide:body11',oldText:'מסורבל',newText:'ברור'}]);assert.equal(after.targets.find(t=>t.id==='slide:body11').text,'הסבר ברור כאן\n');assert.equal(after.targets.find(t=>t.kind==='notes').text,'פתרון פרטי למורה\n');assert.equal(api.value.slides[0].pageElements[2].objectId,'brand-logo');assert.equal(api.requests[0].writeControl.requiredRevisionId,'revision-1');assert.ok(api.requests[0].requests.every(r=>(r.deleteText??r.insertText).objectId==='body11'));
});
test('stale human edits and ambiguous or structural replacements never write',async()=>{
 const api=slideApi();const before=await readFeedbackSnapshot(api,fileId,FEEDBACK_SLIDES);api.value.revisionId='human-edit';await assert.rejects(applyFeedbackPatches(api,before,[{targetId:'slide:body11',oldText:'מסורבל',newText:'ברור'}]),/conflict/);assert.equal(api.writes,0);
 const current=await readFeedbackSnapshot(api,fileId,FEEDBACK_SLIDES);for(const patch of [{targetId:'slide:body11',oldText:'הסבר',newText:'עוד\nשורה'},{targetId:'missing',oldText:'הסבר',newText:'עוד'},{targetId:'slide:body11',oldText:'לא קיים',newText:'עוד'}])await assert.rejects(applyFeedbackPatches(api,current,[patch]),/feedback_patch|conflict/);assert.equal(api.writes,0);
});
test('a lost native-edit acknowledgement reuses exact readback rather than applying twice',async()=>{
 const api=slideApi();const before=await readFeedbackSnapshot(api,fileId,FEEDBACK_SLIDES),patches=[{targetId:'slide:body11',oldText:'מסורבל',newText:'ברור'}];api.lost=true;await assert.rejects(applyFeedbackPatches(api,before,patches),/lost response/);const after=await applyFeedbackPatches(api,before,patches);assert.equal(api.writes,1);assert.match(after.targets.find(t=>t.id==='slide:body11').text,/ברור/);
});
test('Docs corrections retain tab targeting and use UTF-16 indices with required revision',async()=>{
 let text='🙂 שלום עולם\n',body;const api={scope:'scope',async json(url,init){if(init){body=JSON.parse(init.body);text='🙂 אהלן עולם\n';return{};}return{documentId:fileId,revisionId:body?'doc2':'doc1',tabs:[{tabProperties:{tabId:'tab-main'},documentTab:{body:{content:[{startIndex:1,endIndex:1+text.length,paragraph:{elements:[{startIndex:1,endIndex:1+text.length,textRun:{content:text}}]}}]}}}]};}};
 const before=await readFeedbackSnapshot(api,fileId,FEEDBACK_DOC);const after=await applyFeedbackPatches(api,before,[{targetId:'doc:tab-main:0',oldText:'שלום',newText:'אהלן'}]);assert.equal(body.writeControl.requiredRevisionId,'doc1');assert.deepEqual(body.requests[0].deleteContentRange.range,{startIndex:4,endIndex:8,tabId:'tab-main'});assert.equal(body.requests[1].insertText.location.tabId,'tab-main');assert.match(after.targets[0].text,/אהלן/);
});
test('Sheets snapshots are read-only proposals, never automatic student-data changes',async()=>{
 let writes=0;const api={scope:'scope',async json(url,init){if(init)writes++;return url.includes('/values/')?{values:[['התקדמות','50%']]}:{spreadsheetId:fileId,sheets:[{properties:{sheetId:1,title:'תלמידים'}}]};}};
 const snapshot=await readFeedbackSnapshot(api,fileId,FEEDBACK_SHEET);assert.ok(snapshot.targets.every(t=>!t.editable));await assert.rejects(applyFeedbackPatches(api,snapshot,[{targetId:snapshot.targets[1].id,oldText:'50%',newText:'100%'}]),/feedback_patch/);assert.equal(writes,0);
});
function sheetApi(){const sheets=[];let lost=false;const requests=[];return{scope:'scope',privateFolder:async()=>{},sheets,requests,set lost(v){lost=v;},async json(url,init){if(init){const body=JSON.parse(init.body);requests.push(...body.requests);for(const r of body.requests){if(r.addSheet)sheets.push({properties:r.addSheet.properties,developerMetadata:[],rows:[]});if(r.createDeveloperMetadata){const d=r.createDeveloperMetadata.developerMetadata;sheets.find(s=>s.properties.sheetId===d.location.sheetId).developerMetadata.push(d);}if(r.updateCells){const u=r.updateCells,s=sheets.find(s=>s.properties.sheetId===u.start.sheetId);u.rows.forEach((row,i)=>{const at=u.start.rowIndex+i;s.rows[at]??=[];row.values.forEach((v,j)=>{s.rows[at][u.start.columnIndex+j]=v.userEnteredValue.stringValue;});});}if(r.findReplace){const u=r.findReplace,s=sheets.find(s=>s.properties.sheetId===u.range.sheetId);const at=u.range.startRowIndex,col=u.range.startColumnIndex;if(s.rows[at]?.[col]===u.find)s.rows[at][col]=u.replacement;} }if(lost){lost=false;throw Error('lost sheet response');}return{};}if(url.includes('/values/')){const title=decodeURIComponent(url.split('/values/')[1].split('?')[0]).match(/^'([^']+)'/)[1];return{values:sheets.find(s=>s.properties.title===title).rows};}return{spreadsheetId:indexId,sheets};}};}
const artifact={fileId,title:'מצגת לדוגמה',kind:'slides',sourceVersion:'v1',state:'collecting'};
const feedback={id:'comment-c1',fileId,content:'הסבר לא ברור',state:'new'};
test('managed tabs preserve human commands and extra columns while exposing existing actions',async()=>{
 const api=sheetApi();await syncFeedbackSheet(api,indexId,[artifact],[feedback]);const review=api.sheets.find(s=>s.properties.title==='Learning Reviews');review.rows[1][8]='מוכן לסוכן';review.rows[1][9]='הערה אנושית';const after=await syncFeedbackSheet(api,indexId,[{...artifact,state:'working'}],[feedback]);assert.equal(review.rows[1][8],'מוכן לסוכן');assert.equal(review.rows[1][9],'הערה אנושית');assert.deepEqual(after.commands.map(c=>[c.fileId,c.command,c.row]),[[fileId,'ready',1]]);assert.equal(review.rows[1][4],'בבדיקה','Ready has no proposal acceptance token, so progress/errors can still refresh');
});
test('lost Sheet append acknowledgement reconciles stable IDs without duplicate rows',async()=>{
 const api=sheetApi();await syncFeedbackSheet(api,indexId,[],[]);api.lost=true;await assert.rejects(syncFeedbackSheet(api,indexId,[artifact],[]),/lost sheet response/);await syncFeedbackSheet(api,indexId,[artifact],[feedback]);const review=api.sheets.find(s=>s.properties.title==='Learning Reviews');assert.equal(review.rows.filter(r=>r?.[0]===fileId).length,1);assert.equal(api.sheets.length,2);
});
test('command acknowledgement compares only the exact observed command cell on the server',async()=>{
 const api=sheetApi();const {sheetId}=await syncFeedbackSheet(api,indexId,[artifact],[]);const review=api.sheets.find(s=>s.properties.sheetId===sheetId);review.rows[1][8]='אישור · בדיקה 1.1';await ackFeedbackCommand(api,indexId,{sheetId,row:1,value:'מוכן לסוכן'});assert.equal(review.rows[1][8],'אישור · בדיקה 1.1');const request=api.requests.at(-1).findReplace;assert.deepEqual(request.range,{sheetId,startRowIndex:1,endRowIndex:2,startColumnIndex:8,endColumnIndex:9});assert.equal(request.matchEntireCell,true);assert.equal(request.matchCase,true);assert.equal(request.searchByRegex,false);assert.equal(request.find,'מוכן לסוכן');
});
test('unowned same-name tabs stop instead of claiming human content',async()=>{
 const api={scope:'scope',json:async()=>({sheets:[{properties:{sheetId:1,title:'Learning Reviews'}}]})};await assert.rejects(syncFeedbackSheet(api,indexId,[artifact],[]),/conflict/);
});
test('thread acknowledgements survive lost responses and resolve only on explicit acceptance',async()=>{
 const replies=[];let writes=0,lost=true;const bodies=[];const api={async json(url,init){if(!init)return{replies};writes++;const body=JSON.parse(init.body);bodies.push(body);const reply={id:'reply'+writes,content:body.content,author:{me:true}};replies.push(reply);if(lost){lost=false;throw Error('lost reply');}return{id:reply.id};}};
 await assert.rejects(appendReplyOnce(api,fileId,'c1','run-1','הצעת תיקון'),/lost reply/);assert.equal(await appendReplyOnce(api,fileId,'c1','run-1','הצעת תיקון'),'reply1');assert.equal(writes,1);assert.equal(bodies[0].action,undefined);lost=true;await assert.rejects(appendReplyOnce(api,fileId,'c1','run-1.accepted-1','התיקון אושר',{resolve:true}),/lost reply/);assert.equal(writes,2);assert.equal(bodies[1].action,'resolve');await appendReplyOnce(api,fileId,'c1','run-1.accepted-1','התיקון אושר',{resolve:false});assert.equal(writes,2);assert.match(bodies[1].content,/^\[MeaBeclick agent run-1\.accepted-1\]/);
});

test('native slide evidence captures selected Google thumbnails with no credential headers',async()=>{
 const {feedbackVisualEvidence}=await import('../../src/lib/server/learning-feedback/google.ts');const {mkdtemp,readFile,stat}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const path=await import('node:path');const sharp=(await import('sharp')).default;const {createHash}=await import('node:crypto');
 const png=await sharp({create:{width:40,height:30,channels:4,background:'#fff'}}).png().toBuffer();const value=slides(),calls=[];
 const api={scope:'scope',async json(url){if(url.includes('/thumbnail?'))return{contentUrl:'https://lh3.googleusercontent.com/signed-image?secret=not-logged'};return structuredClone(value);}};
 const snapshot=await readFeedbackSnapshot(api,fileId,FEEDBACK_SLIDES);const dir=await mkdtemp(path.join(tmpdir(),'native-feedback-evidence-'));const images=await feedbackVisualEvidence(api,snapshot,dir,['notes:notesbody1'],{fetch:async(url,options)=>{calls.push({url,options});return new Response(png);}});
 assert.equal(images.length,1);assert.equal(images[0].name,'slide-001-of-001');assert.equal(images[0].sha256,createHash('sha256').update(await readFile(images[0].path)).digest('hex'));assert.equal((await stat(images[0].path)).mode&0o777,0o600);assert.equal(calls[0].options.headers,undefined);assert.equal(calls[0].options.redirect,'error');
});
test('native evidence refuses unsafe thumbnail hosts and detects edits during capture',async()=>{
 const {feedbackVisualEvidence}=await import('../../src/lib/server/learning-feedback/google.ts');const {mkdtemp}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const path=await import('node:path');const sharp=(await import('sharp')).default;const png=await sharp({create:{width:2,height:2,channels:4,background:'#fff'}}).png().toBuffer();let unsafe=true,fetches=0;const value=slides();
 const api={scope:'scope',async json(url){if(url.includes('/thumbnail?'))return{contentUrl:unsafe?'https://googleusercontent.com.evil.test/image':'https://lh3.googleusercontent.com/image'};return structuredClone(value);}};
 const snapshot=await readFeedbackSnapshot(api,fileId,FEEDBACK_SLIDES),dir=await mkdtemp(path.join(tmpdir(),'native-feedback-refusal-'));const deps={fetch:async()=>{fetches++;value.revisionId='human-changed';return new Response(png);}};
 await assert.rejects(feedbackVisualEvidence(api,snapshot,dir,undefined,deps),/review_evidence/);assert.equal(fetches,0);unsafe=false;await assert.rejects(feedbackVisualEvidence(api,snapshot,dir,undefined,deps),/conflict/);assert.equal(fetches,1);
});
test('native Docs evidence uses bounded actual PDF and rejects incomplete coverage',async()=>{
 const {feedbackVisualEvidence}=await import('../../src/lib/server/learning-feedback/google.ts');const {mkdtemp}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const path=await import('node:path');const sharp=(await import('sharp')).default;const png=await sharp({create:{width:2,height:2,channels:4,background:'#fff'}}).png().toBuffer();const requests=[];
 const api={scope:'scope',async request(url){requests.push(url);return new Response('%PDF synthetic',{headers:{'Content-Type':'application/pdf'}});},async json(){return{documentId:fileId,revisionId:'doc1',body:{content:[{startIndex:1,endIndex:3,paragraph:{elements:[{startIndex:1,endIndex:3,textRun:{content:'א\n'}}]}}]}};}};
 const snapshot=await readFeedbackSnapshot(api,fileId,FEEDBACK_DOC),dir=await mkdtemp(path.join(tmpdir(),'native-doc-evidence-'));
 const images=await feedbackVisualEvidence(api,snapshot,dir,undefined,{renderPdf:async pdf=>{assert.match(pdf.toString(),/^%PDF/);return{pages:2,images:[png,png]};}});assert.equal(images.length,2);assert.match(requests[0],/\/export\?mimeType=application%2Fpdf$/);await assert.rejects(feedbackVisualEvidence(api,snapshot,dir,undefined,{renderPdf:async()=>({pages:13,images:[png]})}),/source_limit/);
});


test('a pending acceptance remains bound to its displayed proposal token until acknowledged',async()=>{
 const api=sheetApi();const old={...artifact,state:'awaiting-review',runId:'12.1',summary:'old checked proposal'};
 await syncFeedbackSheet(api,indexId,[old],[feedback]);const review=api.sheets.find(s=>s.properties.title==='Learning Reviews');review.rows[1][8]='אישור · בדיקה 12.1';review.rows[1][9]='human note';const displayed=review.rows[1].slice(0,8);
 const changed={...artifact,state:'awaiting-review',runId:'12.2',summary:'different proposal'};
 const pending=await syncFeedbackSheet(api,indexId,[changed],[feedback]);assert.deepEqual(review.rows[1].slice(0,8),displayed);assert.equal(review.rows[1][8],'אישור · בדיקה 12.1');assert.equal(review.rows[1][9],'human note');assert.equal(pending.commands[0].reviewToken,'12.1');
 await ackFeedbackCommand(api,indexId,pending.commands[0]);assert.equal(review.rows[1][8],'');const refreshed=await syncFeedbackSheet(api,indexId,[changed],[feedback]);assert.equal(refreshed.commands.length,0);assert.equal(review.rows[1][6],'12.2');assert.equal(review.rows[1][5],'different proposal');assert.equal(review.rows[1][9],'human note');
});

test('pending commands freeze displayed status while empty command rows update normally',async()=>{
 const api=sheetApi();await syncFeedbackSheet(api,indexId,[{...artifact,runId:'1.1'}],[]);const review=api.sheets.find(s=>s.properties.title==='Learning Reviews');review.rows[1][8]='לתקן שוב · בדיקה 1.1';
 const pending=await syncFeedbackSheet(api,indexId,[{...artifact,state:'working',runId:'2.1'}],[]);assert.equal(review.rows[1][4],'איסוף משוב');assert.equal(pending.commands[0].reviewToken,'1.1');assert.equal(pending.commands[0].command,'changes');
 review.rows[1][8]='';await syncFeedbackSheet(api,indexId,[{...artifact,state:'working',runId:'2.1'}],[]);assert.equal(review.rows[1][4],'בבדיקה');assert.equal(review.rows[1][6],'2.1');
});


test('an offline approval carries its own old token even when the displayed row has advanced',async()=>{
 const api=sheetApi();await syncFeedbackSheet(api,indexId,[{...artifact,runId:'12.1'}],[]);const review=api.sheets.find(s=>s.properties.title==='Learning Reviews');
 await syncFeedbackSheet(api,indexId,[{...artifact,runId:'12.2'}],[]);assert.equal(review.rows[1][6],'12.2');review.rows[1][8]='אישור · בדיקה 12.1';
 const observed=await syncFeedbackSheet(api,indexId,[{...artifact,runId:'12.2'}],[]);assert.equal(observed.commands[0].reviewToken,'12.1');assert.equal(observed.commands[0].command,'accept');assert.equal(review.rows[1][6],'12.2');
});

test('plain or malformed approvals cannot borrow the current displayed token',async()=>{
 const api=sheetApi();await syncFeedbackSheet(api,indexId,[{...artifact,runId:'12.1'}],[]);const review=api.sheets.find(s=>s.properties.title==='Learning Reviews');
 for(const action of ['אישור','accept','אישור · בדיקה 0.1','אישור · בדיקה 12.0','אישור · בדיקה 012.1','אישור · בדיקה 12.1.more']){review.rows[1][8]=action;const result=await syncFeedbackSheet(api,indexId,[{...artifact,runId:'12.1'}],[]);assert.equal(result.commands.length,0,action);await assert.rejects(ackFeedbackCommand(api,indexId,{sheetId:review.properties.sheetId,row:1,value:action}),/conflict/);}
});

test('per-row dropdowns include only review-bound actions and no-run rows offer only Ready',async()=>{
 const api=sheetApi();await syncFeedbackSheet(api,indexId,[artifact],[]);let rules=api.requests.filter(r=>r.setDataValidation).map(r=>r.setDataValidation);assert.ok(rules.length);assert.ok(rules.every(r=>r.rule.condition.values.length===1&&r.rule.condition.values[0].userEnteredValue==='מוכן לסוכן'));
 await syncFeedbackSheet(api,indexId,[{...artifact,runId:'12.1'}],[]);const rule=api.requests.filter(r=>r.setDataValidation).at(-1).setDataValidation;assert.equal(rule.range.startRowIndex,1);assert.equal(rule.range.endRowIndex,2);assert.deepEqual(rule.rule.condition.values.map(v=>v.userEnteredValue),['מוכן לסוכן','אישור · בדיקה 12.1','לתקן שוב · בדיקה 12.1','אישור כלל להמשך · בדיקה 12.1','ביטול כלל להמשך · בדיקה 12.1']);
});


test('accepted policy rows link their source and offer only token-bound revocation',async()=>{
 const api=sheetApi();const policy={...artifact,fileId:'policy:12',url:`https://docs.google.com/presentation/d/${fileId}/edit`,kind:'policy',state:'accepted',runId:'12.1',summary:'להציג דוגמה לפני תרגול עצמאי'};
 await syncFeedbackSheet(api,indexId,[policy],[]);const review=api.sheets.find(s=>s.properties.title==='Learning Reviews');const rule=api.requests.filter(r=>r.setDataValidation).at(-1).setDataValidation;assert.deepEqual(rule.rule.condition.values.map(v=>v.userEnteredValue),['ביטול כלל להמשך · בדיקה 12.1']);assert.equal(review.rows[1][0],'policy:12');assert.equal(review.rows[1][4],'אושר');
 review.rows[1][8]='ביטול כלל להמשך · בדיקה 12.1';const result=await syncFeedbackSheet(api,indexId,[policy],[]);assert.equal(result.commands[0].fileId,'policy:12');assert.equal(result.commands[0].command,'revoke-policy');assert.equal(result.commands[0].reviewToken,'12.1');await ackFeedbackCommand(api,indexId,result.commands[0]);await syncFeedbackSheet(api,indexId,[{...policy,state:'revoked'}],[]);assert.equal(review.rows[1][4],'בוטל');
});
