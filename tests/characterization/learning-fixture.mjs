import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { familySession } from './harness.mjs';

export async function seedLearning(server, suffix = 'one', { sessionForLink = familySession } = {}) {
  const start = suffix === 'one' ? '2027-04-15T10:00:00.000Z' : '2027-04-15T12:00:00.000Z';
  const end = suffix === 'one' ? '2027-04-15T10:45:00.000Z' : '2027-04-15T12:45:00.000Z';
  const response = await fetch(`${server.baseUrl}/api/book`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
    name:`תלמיד בדיקה ${suffix}`, subject:'מתמטיקה', level:'כיתה ט', phone:suffix === 'one' ? '0501234567' : '0509876543',
    email:`learning-${suffix}@example.com`, durationMin:45, start, end,
  }) });
  assert.equal(response.status,200,await response.clone().text());
  const {portal}=await response.json();
  const cookie=await sessionForLink(portal.link);
  const db=new DatabaseSync(server.dbPath);
  const student=db.prepare('SELECT id FROM students_v2 WHERE code=?').get(portal.code);
  db.close();
  return {cookie,code:portal.code,studentId:student.id};
}
