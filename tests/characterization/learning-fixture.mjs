import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { PARABOLAS } from '../../src/lib/learning/parabolas.ts';
import { familySession } from './harness.mjs';

export async function seedLearning(server, suffix = 'one') {
  const start = suffix === 'one' ? '2027-04-15T10:00:00.000Z' : '2027-04-15T12:00:00.000Z';
  const end = suffix === 'one' ? '2027-04-15T10:45:00.000Z' : '2027-04-15T12:45:00.000Z';
  const response = await fetch(`${server.baseUrl}/api/book`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
    name:`תלמיד בדיקה ${suffix}`, subject:'מתמטיקה', level:'כיתה ט', phone:suffix === 'one' ? '0501234567' : '0509876543',
    email:`learning-${suffix}@example.com`, durationMin:45, start, end,
  }) });
  assert.equal(response.status,200,await response.clone().text());
  const {portal}=await response.json();
  const cookie=await familySession(portal.link);
  const db=new DatabaseSync(server.dbPath);
  const student=db.prepare('SELECT id FROM students_v2 WHERE code=?').get(portal.code);
  const slug=`learning-test-${suffix}`;
  const now=new Date().toISOString();
  db.prepare("INSERT INTO lessons (slug,student,subject,level,title,at,status) VALUES (?,?, 'מתמטיקה','כיתה ט',?,?,'ready')").run(slug,`תלמיד בדיקה ${suffix}`,PARABOLAS.title,now);
  db.prepare('INSERT INTO learning_assignments (lesson_slug,student_id) VALUES (?,?)').run(slug,student.id);
  db.prepare("INSERT INTO lesson_materials (lesson_slug,kind,version,content,origin,published_at,created_at) VALUES (?,'plan',1,?,'generated',?,?)").run(slug,JSON.stringify({learning:PARABOLAS}),now,now);
  db.close();
  return {slug,cookie,code:portal.code,studentId:student.id};
}
