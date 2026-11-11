import {test} from 'node:test';
import assert from 'node:assert/strict';
const modulePath='../../src/lib/learning/workspace.ts';
import {workspaceFixture as base} from '../learning-workspace-fixture.mjs';
test('workspace schema parses bilingual headers after column reordering and rejects ambiguous keys',async()=>{
 const m=await import(modulePath);const source=base(),grids={};for(const [name,columns]of Object.entries(m.workspaceTables)){const order=[...columns].reverse();grids[name]=[order.map(c=>m.workspaceHeader(c)),...source[name].map(row=>order.map(c=>row[c.key]??''))];}
 assert.deepEqual(m.decodeWorkspace(grids,1),source);
 const dates=structuredClone(grids),dateColumn=dates.Lessons[0].findIndex(h=>h.endsWith('[date]')),timeColumn=dates.Progress[0].findIndex(h=>h.endsWith('[observed_at]'));
 dates.Lessons[1][dateColumn]=46337;dates.Progress[1][timeColumn]=46337+8/24;
 assert.equal(m.decodeWorkspace(dates,1).Lessons[0].date,'2026-11-11');
 assert.equal(m.decodeWorkspace(dates,1).Progress[0].observed_at,'2026-11-11T08:00:00.000Z');
 grids.Students[0][1]=grids.Students[0][0];assert.throws(()=>m.decodeWorkspace(grids,1),/Students.*duplicate|Students.*missing/);
 assert.throws(()=>m.decodeWorkspace({},2),/version/);
});
test('linked demo records are valid, isolated and never counted as real students',async()=>{
 const m=await import(modulePath),s=base();assert.deepEqual(m.workspaceProblems(s),[]);
 assert.throws(()=>m.learningContext(s,'demo-001'),/demo/);
 const c=m.learningContext(s,'demo-001',{includeDemo:true});assert.equal(c.student.student_id,'demo-001');assert.equal(c.observations.length,1);assert.equal(c.publishedMaterials.length,0);
 assert.deepEqual(m.workspaceCounts(s),{Students:0,Materials:0,Lessons:0,Assignments:0,Progress:0});
});
test('foreign keys include student identity, audience and demo ownership',async()=>{
 const m=await import(modulePath);for(const change of [s=>s.Assignments[0].student_id='missing',s=>s.Assignments[0].is_demo=false,s=>s.Materials[0].student_id='missing',s=>s.Progress[0].lesson_id='missing']){const s=base();change(s);assert.ok(m.workspaceProblems(s).length);}
 const s=base();s.Students.push({...s.Students[0],student_id:'demo-002'});s.Lessons.push({...s.Lessons[0],lesson_id:'lesson-002',student_id:'demo-002'});s.Progress[0].lesson_id='lesson-002';assert.match(m.workspaceProblems(s).join(';'),/same student/);
 s.Progress[0].lesson_id='lesson-001';s.Assignments[0].student_id='demo-002';assert.match(m.workspaceProblems(s).join(';'),/same student|belongs/);
});
test('publication, review and learning evidence have distinct prerequisites',async()=>{
 const m=await import(modulePath);let s=base();s.Materials[0].review_status='approved';assert.deepEqual(m.workspaceProblems(s),[]);
 s.Assignments[0].status='assigned';assert.match(m.workspaceProblems(s).join(';'),/demo.*draft|published|audience/);
 s=base();s.Materials[0].publication_status='published';assert.match(m.workspaceProblems(s).join(';'),/release_id|content_sha256/);
 s=base();s.Progress[0].outcome='demonstrated';assert.match(m.workspaceProblems(s).join(';'),/independent|evidence/);
 s.Progress[0].support='independent';s.Progress[0].evidence_type='checked_answer';s.Progress[0].note='ענה נכון באופן עצמאי על משימת ההדגמה';assert.deepEqual(m.workspaceProblems(s),[]);
 s.Progress[0].evidence_type='file_viewed';assert.ok(m.workspaceProblems(s).length);
});
test('validation rejects duplicate IDs, invalid dates, unsafe links and partial rows',async()=>{
 const m=await import(modulePath);for(const change of [s=>s.Students.push({...s.Students[0]}),s=>s.Lessons[0].date='2026-02-30',s=>s.Materials[0].url='javascript:alert(1)',s=>s.Students[0].profile_url='https://docs.google.com.evil.example/document/d/abc',s=>delete s.Progress[0].skill]){const s=base();change(s);assert.ok(m.workspaceProblems(s).length);}
 const s=base();s.Progress[0].is_demo=false;assert.match(m.workspaceProblems(s).join(';'),/demo/);
});
test('context never includes another learner even when demo access is explicit',async()=>{
 const m=await import(modulePath),s=base();s.Students.push({...s.Students[0],student_id:'demo-002'});s.Lessons.push({...s.Lessons[0],lesson_id:'lesson-002',student_id:'demo-002'});const c=m.learningContext(s,'demo-001',{includeDemo:true});assert.equal(c.lessons.length,1);assert.equal(c.lessons[0].lesson_id,'lesson-001');assert.throws(()=>m.learningContext(s,'unknown',{includeDemo:true}),/not found/);
});
