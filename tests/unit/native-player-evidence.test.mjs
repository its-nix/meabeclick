import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {studentEvidencePlan,studentEvidenceAnswer,studentEvidenceAsset,renderStudentEvidence} from '../../src/lib/server/native-learning/player-evidence.ts';
import {gradeDeckTask} from '../../src/lib/learning/deck/model.ts';
import {visualDeckFixture} from '../visual-deck-fixture.mjs';

test('student evidence covers each lesson/homework/game task without claiming open answers are graded',()=>{
 const bundle=visualDeckFixture();bundle.homework[0].grading='tutor-review';bundle.homework[0].check=null;
 const plan=studentEvidencePlan(bundle);assert.equal(plan.length,bundle.tasks.length+bundle.homework.length+bundle.games.reduce((n,g)=>n+g.rounds.length,0));assert.equal(new Set(plan.map(p=>p.task.id)).size,plan.length);assert.deepEqual(plan.find(p=>p.task.id===bundle.homework[0].id).states,['initial','tutor-attempt','hint','solution']);assert.ok(plan.filter(p=>p.task.grading==='checked').every(p=>p.states.join(',')==='initial,incorrect,hint,correct-assisted,solution'));assert.equal(plan.find(p=>p.surface==='lesson').slideId,'slide-19');assert.deepEqual(plan.filter(p=>p.gameId==='region-game').map(p=>p.roundIndex),[0,1,2]);
});
test('test inputs exercise real grading for numeric, choice, axis and region controls',()=>{
 const bundle=visualDeckFixture(),tasks=[...bundle.tasks,...bundle.homework,...bundle.games.flatMap(g=>g.rounds),{...bundle.homework[0],id:'choice',check:{kind:'choice',answer:1,options:['א','ב','ג']}}];
 for(const task of tasks){assert.equal(gradeDeckTask(task,studentEvidenceAnswer(task,true)),true,task.id);assert.equal(gradeDeckTask(task,studentEvidenceAnswer(task,false)),false,task.id);}const all={...bundle.games[0].rounds[0],check:{kind:'region',answer:[-4,4],options:[]}};assert.equal(gradeDeckTask(all,studentEvidenceAnswer(all,false)),false);
});
test('missing lesson frames, duplicate task identity and oversized evidence do not silently skip coverage',()=>{
 const missing=visualDeckFixture();missing.tasks.push({...missing.tasks[0],id:'not-reachable'});assert.throws(()=>studentEvidencePlan(missing),/native_player_missing_task/);
 const duplicate=visualDeckFixture();duplicate.homework[0].id=duplicate.tasks[0].id;assert.throws(()=>studentEvidencePlan(duplicate),/native_player_input/);
 const many=visualDeckFixture();for(let i=0;i<9;i++){const t={...structuredClone(many.tasks[0]),id:'extra-'+i};many.tasks.push(t);many.slides[i].taskId=t.id;}assert.throws(()=>studentEvidencePlan(many),/native_player_evidence_limit/);
});
test('asset serving allows only bounded local player resources and rejects external, encoded and symlink escapes',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'player-assets-'));await mkdir(path.join(root,'learning-assets','fonts'),{recursive:true});await writeFile(path.join(root,'learning-assets','katex.min.js'),'trusted-js');await writeFile(path.join(root,'learning-assets','fonts','test.woff2'),'font');const outside=await mkdtemp(path.join(tmpdir(),'player-private-'));await writeFile(path.join(outside,'private.js'),'private');await symlink(path.join(outside,'private.js'),path.join(root,'learning-assets','escape.js'));
 const allowed=await studentEvidenceAsset('https://render.invalid/learning-assets/katex.min.js',root);assert.equal(allowed.body.toString(),'trusted-js');assert.equal(allowed.contentType,'application/javascript');assert.equal((await studentEvidenceAsset('https://render.invalid/learning-assets/fonts/test.woff2',root)).body.toString(),'font');
 for(const url of ['https://evil.test/learning-assets/katex.min.js','file:///etc/passwd','https://render.invalid/.env','https://render.invalid/learning-assets/%2fetc/passwd','https://render.invalid/learning-assets/escape.js','https://render.invalid/learning-assets/../private.js','https://render.invalid/learning-assets/data.json'])assert.equal(await studentEvidenceAsset(url,root),null,url);
});
test('invalid input or excessive state coverage fails before launching a browser',async()=>{
 let launched=0;await assert.rejects(renderStudentEvidence(visualDeckFixture(),'relative/path',{launch:async()=>{launched++;throw Error('must not launch');}}),/native_player_input/);assert.equal(launched,0);
});

test('automated graders never evict or access human preview sessions',async()=>{const{isolatedPreviewGrader,createPreviewSession,previewAction}=await import('../../src/lib/server/visual-pilot.ts');const{visualDeckFixture}=await import('../visual-deck-fixture.mjs');const task=visualDeckFixture().homework[0],human=createPreviewSession('human-version'),isolated=isolatedPreviewGrader();for(let i=0;i<220;i++)isolated.create('machine-'+i);assert.throws(()=>isolated.action(human,'human-version',task,'attempt','0','isolated'),/stale preview/);assert.ok(previewAction(human,'human-version',task,'attempt',String(task.check.answer),'human-event'));});
