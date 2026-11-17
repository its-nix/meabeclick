/** Explicit real-Chromium smoke; ordinary unit tests never launch browsers. */
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {visualDeckFixture} from '../visual-deck-fixture.mjs';
import {renderStudentEvidence} from '../../src/lib/server/native-learning/player-evidence.ts';
const root=process.env.EVIDENCE_DIR??await mkdtemp(path.join(tmpdir(),'mea-player-smoke-'));process.env.DB_PATH=path.join(root,'isolated.sqlite');
await mkdir(root,{recursive:true,mode:0o700});const db=new DatabaseSync(process.env.DB_PATH);for(const t of ['sentinel_events','sentinel_progress'])db.exec(`CREATE TABLE ${t}(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO ${t}(value) VALUES('unchanged')`);db.close();
const hash=async()=>createHash('sha256').update(await readFile(process.env.DB_PATH)).digest('hex'),before=await hash();
const images=await renderStudentEvidence(visualDeckFixture(),root);assert.ok(images.length>0&&images.length<=30);assert.equal(await hash(),before);const dir=(await readdir(root)).find(n=>n.startsWith('student-player-'));const report=JSON.parse(await readFile(path.join(root,dir,'report.json'),'utf8'));assert.ok(report.states.some(s=>s.state==='incorrect'));assert.ok(report.states.some(s=>s.state==='correct-assisted'));assert.ok(report.states.some(s=>s.state==='hint'));assert.ok(report.states.some(s=>s.state==='solution'));assert.ok(report.states.some(s=>s.state==='changed'&&s.surface==='exploration'));assert.deepEqual(report.runtimeErrors,[]);assert.equal(report.failure,undefined);await writeFile(path.join(root,'smoke.json'),JSON.stringify({images:images.length,states:report.states.length,dbUnchanged:true,blockedRequests:report.blockedRequests.length},null,2)+'\n',{mode:0o600});console.log(JSON.stringify({root,images:images.length,states:report.states.length,dbUnchanged:true}));
