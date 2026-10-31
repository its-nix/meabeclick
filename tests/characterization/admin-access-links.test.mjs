import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login, redeemFamilyLink } from './harness.mjs';

const book = (baseUrl) => fetch(`${baseUrl}/api/book`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'תלמיד בדיקה', subject: 'מתמטיקה', level: 'כיתה ט',
    phone: '0501234567', email: 'scope@example.test', durationMin: 90,
    start: '2027-12-10T10:00:00+02:00', end: '2027-12-10T11:30:00+02:00',
  }),
});

const issue = (baseUrl, admin, code, scope) => fetch(`${baseUrl}/api/students/${code}/link`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: admin },
  body: JSON.stringify({ scope }),
});

const addStudent = (baseUrl, admin, body) => fetch(`${baseUrl}/api/students`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: admin },
  body: JSON.stringify(body),
});

test('admin account and student issuance are distinct and do not revoke the other scope', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const booked = await (await book(baseUrl)).json();
    const admin = await login(baseUrl);

    const accountResponse = await issue(baseUrl, admin, booked.portal.code, 'account');
    assert.equal(accountResponse.status, 200);
    const account = await accountResponse.json();
    assert.deepEqual(Object.keys(account).sort(), ['accountName', 'link', 'scope']);
    assert.equal(account.scope, 'account');

    const studentResponse = await issue(baseUrl, admin, booked.portal.code, 'student');
    assert.equal(studentResponse.status, 200);
    const student = await studentResponse.json();
    assert.deepEqual(Object.keys(student).sort(), ['joinCode', 'link', 'name', 'scope']);
    assert.equal(student.scope, 'student');

    const accountRedemption = await redeemFamilyLink(account.link);
    assert.equal(accountRedemption.status, 200, 'student issuance does not revoke the account link');
    assert.equal((await accountRedemption.json()).destination, '/app/parent');

    const studentRedemption = await redeemFamilyLink(student.link);
    assert.equal(studentRedemption.status, 200, 'account issuance does not revoke the student link');
    assert.equal((await studentRedemption.json()).destination, `/app/student?s=${booked.portal.code}`);
  } finally {
    await stop();
  }
});

test('dashboard renders one account action and one student action per sibling', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const admin = await login(baseUrl);
    const shared = {
      subject: 'מתמטיקה', level: 'כיתה ט', phone: '0501234567',
      email: 'siblings@example.test',
    };
    assert.equal((await addStudent(baseUrl, admin, { ...shared, name: 'תלמיד ראשון' })).status, 200);
    assert.equal((await addStudent(baseUrl, admin, { ...shared, name: 'תלמיד שני' })).status, 200);

    const dashboard = await fetch(`${baseUrl}/app/dashboard`, { headers: { Cookie: admin } });
    assert.equal(dashboard.status, 200);
    const html = await dashboard.text();
    assert.equal((html.match(/>כניסה למשפחה<\/button>/g) ?? []).length, 1);
    assert.equal((html.match(/>כניסה לתלמיד\/ה בלבד<\/button>/g) ?? []).length, 2);
  } finally {
    await stop();
  }
});
