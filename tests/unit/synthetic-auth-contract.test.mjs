import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertRedeem, assertReplay, assertStudentScope } from '../../synthetic/auth-client.mjs';

test('success/replay require exact bodies, no-store and no replay cookie', () => {
  const response = (status, extra = {}) => ({ status, headers: new Headers({ 'cache-control': 'no-store', ...extra }) });
  const success = { ok: true, destination: '/app/student?s=synthetic-student-gamma' };
  assert.doesNotThrow(() => assertRedeem(response(200), success));
  assert.throws(() => assertRedeem(response(200), { ...success, destination: '/app/parent' }));
  assert.throws(() => assertRedeem(response(200, {'cache-control':'public'}), success));
  const invalid = { error: 'הקישור כבר לא תקף. אפשר לבקש קישור אישי חדש — בלי לחכות למורה.' };
  assert.doesNotThrow(() => assertReplay(response(401), invalid));
  assert.throws(() => assertReplay(response(401), {...invalid, destination: '/app/parent'}));
  assert.throws(() => assertReplay(response(401, {'set-cookie':'maab_family=unexpected'}), invalid));
});

test('scope check rejects parent capability or sibling list and checks forbidden paths', async () => {
  let count = 0;
  const family = {signedIn:true,kind:'student',isSelf:false,canSeeParentView:false,accountName:'הורה בדיקה אלפא',
    defaultStudent:'synthetic-student-gamma',students:[{code:'synthetic-student-gamma',name:'תלמידת בדיקה גמא',emoji:'🧪'}]};
  const fetch = async url => { count++; return url.endsWith('/api/family')
    ? Response.json(family, { headers: {'cache-control':'no-store'} })
    : Response.json({error:'denied'}, {status:401}); };
  await assertStudentScope('http://127.0.0.1:4173', 'maab_family=fixture', undefined, fetch);
  assert.equal(count, 4);
  family.canSeeParentView = true;
  await assert.rejects(assertStudentScope('http://127.0.0.1:4173', 'maab_family=fixture', undefined, fetch), /scope/);
  family.canSeeParentView = false;
  family.students.push({code:'synthetic-sibling-sentinel'});
  await assert.rejects(assertStudentScope('http://127.0.0.1:4173', 'maab_family=fixture', undefined, fetch), /scope/);
});
