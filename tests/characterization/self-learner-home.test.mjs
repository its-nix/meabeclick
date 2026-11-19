// tests/characterization/self-learner-home.test.mjs
//
// An adult who signs up for themselves is both the student and the payer, and
// their one home is /app/student. What that home renders is fetched after
// mount (see /api/portal/[code]); what these pin is the boundary under it:
// the self-learner's session reaches every figure the parent view carries,
// and nobody else's does. The rendered page is checked in tests/qa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, familySession } from './harness.mjs';

const book = (baseUrl, over = {}, cookie = null) => fetch(`${baseUrl}/api/book`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  body: JSON.stringify({
    name: 'רון אברהם', subject: 'מתמטיקה', level: 'כיתה ט',
    phone: '0501234567', email: 'ron@example.com', durationMin: 90,
    start: '2027-03-15T10:00:00+02:00', end: '2027-03-15T11:30:00+02:00',
    ...over,
  }),
}).then(r => r.json());

const get = (baseUrl, path, cookie) => fetch(`${baseUrl}${path}`, { headers: { Cookie: cookie }, redirect: 'manual' });
const claim = (baseUrl, cookie, id) => fetch(`${baseUrl}/api/payments/claim`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ id }),
});

test('a self-learner session gets the parent figures from their own student endpoint, and can claim "I paid"', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const { portal } = await book(baseUrl, { isSelf: true });
    const cookie = await familySession(portal.link);

    const data = await (await get(baseUrl, `/api/portal/${portal.code}`, cookie)).json();
    assert.equal(data.balance.upcomingAgorot, 21500, 'the booked lesson is planned money');
    assert.equal(data.charges.length, 1);
    assert.deepEqual(
      { kind: data.charges[0].kind, amount: data.charges[0].amount_agorot, status: data.charges[0].status },
      { kind: 'double', amount: 21500, status: 'owed' },
      'the charge carries what the shared payments table prints',
    );
    assert.ok('progress' in data && Array.isArray(data.lessons), 'progress and lessons ride the same response');

    assert.equal((await claim(baseUrl, cookie, data.charges[0].id)).status, 200);
    const after = await (await get(baseUrl, `/api/portal/${portal.code}`, cookie)).json();
    assert.ok(after.charges[0].claimed_at, 'the pending claim survives a reload');
    assert.equal(after.charges[0].status, 'owed', 'a claim never marks anything paid');
  } finally { await stop(); }
});

test('the self-learner has no parent board: /app/parent sends them home, keeping the section', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const { portal } = await book(baseUrl, { isSelf: true });
    const cookie = await familySession(portal.link);
    const home = `/app/student?s=${portal.code}`;

    let r = await get(baseUrl, '/app/parent', cookie);
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), home);
    r = await get(baseUrl, `/app/parent?s=${portal.code}&v=payments`, cookie);
    assert.equal(r.headers.get('location'), `${home}&v=payments`, 'an old payments link lands on payments');
    r = await get(baseUrl, '/app/parent?v=progress', cookie);
    assert.equal(r.headers.get('location'), `${home}&v=progress`);
    r = await get(baseUrl, '/app/parent?v=bogus', cookie);
    assert.equal(r.headers.get('location'), home, 'only known sections are carried');

    assert.equal((await get(baseUrl, home, cookie)).status, 200, 'the unified home renders for the session');
  } finally { await stop(); }
});

test('a child in a family account never receives money, and a parent keeps the parent page', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const first = await book(baseUrl, { name: 'יובל כהן', email: 'orit@example.com' });
    const parent = await familySession(first.portal.link);
    const link = await (await fetch(`${baseUrl}/api/student-link`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: parent }, body: JSON.stringify({ code: first.portal.code }),
    })).json();
    const child = await familySession(link.link);
    const code = first.portal.code;

    // The parent: the parent page renders, and the parent kind carries the money.
    assert.equal((await get(baseUrl, `/app/parent?s=${code}`, parent)).status, 200);
    const asParent = await (await get(baseUrl, `/api/portal/${code}?kind=parent`, parent)).json();
    assert.equal(asParent.charges.length, 1);
    // A parent asking for the student shape of their child's page gets no money either.
    const parentAsStudent = await (await get(baseUrl, `/api/portal/${code}`, parent)).json();
    assert.equal(parentAsStudent.balance, undefined);
    assert.equal(parentAsStudent.charges, undefined);

    // The child: no money in any shape, no parent kind, no claim, and the parent page sends them back.
    for (const path of [`/api/portal/${code}`, `/api/portal/${code}?kind=student`]) {
      const body = await (await get(baseUrl, path, child)).json();
      assert.equal(body.balance, undefined, path);
      assert.equal(body.charges, undefined, path);
    }
    assert.equal((await get(baseUrl, `/api/portal/${code}?kind=parent`, child)).status, 401);
    assert.equal((await claim(baseUrl, child, asParent.charges[0].id)).status, 401);
    const r = await get(baseUrl, '/app/parent', child);
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), `/app/student?s=${code}`);
  } finally { await stop(); }
});

test('another family\'s self-learner cannot read or claim this one\'s charges', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const a = await book(baseUrl, { isSelf: true });
    const b = await book(baseUrl, { isSelf: true, name: 'דנה לוי', email: 'dana@example.com',
      start: '2027-03-17T10:00:00+02:00', end: '2027-03-17T11:30:00+02:00' });
    const cookieA = await familySession(a.portal.link);
    const cookieB = await familySession(b.portal.link);
    assert.equal((await get(baseUrl, `/api/portal/${b.portal.code}`, cookieA)).status, 401);
    const bData = await (await get(baseUrl, `/api/portal/${b.portal.code}`, cookieB)).json();
    assert.equal((await claim(baseUrl, cookieA, bData.charges[0].id)).status, 404);
  } finally { await stop(); }
});
