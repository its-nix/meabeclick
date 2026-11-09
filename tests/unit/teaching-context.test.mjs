import '../isolate-lesson-data.mjs';import {test} from 'node:test';import assert from 'node:assert/strict';import {teachingFixture} from '../teaching-fixture.mjs';
test('grade and unit track remain separate and unknown history stays empty',async()=>{
 const m=await import('../../src/lib/server/lesson/teaching-context.ts').catch(()=>null);assert.ok(m,'context builder exists');
 const a=m.teachingContextFor({name:'דוגמה',subject:'מתמטיקה',level:'כיתה י',durationMin:90},null,{templateId:'math-4u',title:'פונקציות',key:'x'});
 const b=m.teachingContextFor({name:'דוגמה',subject:'מתמטיקה',level:'כיתה י',durationMin:90},null,{templateId:'math-5u',title:'פונקציות',key:'x'});
 assert.equal(a.grade,'כיתה י');assert.match(a.track,/4/);assert.match(b.track,/5/);assert.deepEqual(a.history,[]);assert.equal(a.durationMin,90);
});
test('only context-compatible candidate bundles can bypass generation',async()=>{
 const {canReuseTeachingPlan}=await import('../../src/lib/server/lesson/teaching-context.ts');const p=teachingFixture();
 const request={subject:'מתמטיקה',level:'כיתה י',teachingContext:p.teaching.context};
 assert.equal(canReuseTeachingPlan(p,request),true);
 assert.equal(canReuseTeachingPlan(p,{...request,teachingContext:{...p.teaching.context,request:'בעיה חדשה לגמרי'}}),false);
 const legacy=structuredClone(p);delete legacy.teaching;assert.equal(canReuseTeachingPlan(legacy,request),false);
});
test('stored learning preferences enter private context rather than a manual setup form',async()=>{
 const E=await import('../../src/lib/server/entities.ts'),{handle}=await import('../../src/lib/server/db.ts');
 const {teachingContextFor}=await import('../../src/lib/server/lesson/teaching-context.ts');
 const a=E.createAccount({name:'בדיקה',phone:null,credential:'x'}),s=E.createStudent({code:'context-prefs',name:'דוגמה',accountId:a.id,credential:'x'});
 handle().prepare('UPDATE students_v2 SET goals=?,style=?,notes=? WHERE id=?').run('להבין שברים','המחשות','PrivatePreference',s.id);
 const context=teachingContextFor({name:'דוגמה',subject:'מתמטיקה',level:'כיתה ז',durationMin:45},s.code,null);
 assert.equal(context.preferences.goals,'להבין שברים');assert.equal(context.preferences.notes,'PrivatePreference');
});
