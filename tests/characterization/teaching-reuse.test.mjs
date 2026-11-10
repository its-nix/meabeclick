import '../isolate-lesson-data.mjs';import {test} from 'node:test';import assert from 'node:assert/strict';import {teachingFixture} from '../teaching-fixture.mjs';import {mkdtemp,mkdir} from 'node:fs/promises';import {join} from 'node:path';import{tmpdir}from'node:os';
const E=await import('../../src/lib/server/entities.ts'),S=await import('../../src/lib/server/plans/store.ts');
const {templateById}=await import('../../src/lib/server/plans/templates.ts');const {targetSkillFor}=await import('../../src/lib/server/lesson/targeting.ts');
const {prepareSkill}=await import('../../src/lib/server/library/prepare.ts');const{triggerForBooking}=await import('../../src/lib/server/lesson/queue.ts');
test('a ready old master cannot swallow a candidate booking request',async()=>{
 const saved={version:process.env.LESSON_GENERATION_VERSION,key:process.env.OPENAI_API_KEY,home:process.env.CODEX_HOME};
 try{
 delete process.env.LESSON_GENERATION_VERSION;delete process.env.OPENAI_API_KEY;process.env.CODEX_HOME=await mkdtemp(join(tmpdir(),'no-engine-'));
 const a=E.createAccount({name:'בדיקה',phone:null,credential:'x'}),student=E.createStudent({code:'candidate-reuse',name:'דוגמה',accountId:a.id,credential:'x'});
 E.upsertEnrollment({studentId:student.id,subject:'מתמטיקה',level:'כיתה ח',teacherId:null});const enrollment=E.enrollmentsForStudent(student.id)[0];
 S.createPlan({studentId:student.id,enrollmentId:enrollment.id,template:templateById('math-8'),goal:'אלגברה'});
 const target=targetSkillFor(student.code,'מתמטיקה');const p=teachingFixture();delete p.teaching;
 const master=await prepareSkill(target.templateId,target.key,{generate:async()=>p});assert.equal(master.status,'ready');
 process.env.LESSON_GENERATION_VERSION='2';
 const result=triggerForBooking({name:'דוגמה',subject:'מתמטיקה',level:'כיתה ח',durationMin:45,request:'בקשה חדשה על שברים'},{enrolledCode:student.code,notify:()=>{}});
 assert.equal(result.skipped,'no credentials','fresh content is required; the old master must not bypass preflight');
 }finally{for(const [env,v]of Object.entries({LESSON_GENERATION_VERSION:saved.version,OPENAI_API_KEY:saved.key,CODEX_HOME:saved.home})){if(v===undefined)delete process.env[env];else process.env[env]=v;}}
});
