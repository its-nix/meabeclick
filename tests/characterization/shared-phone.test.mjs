// tests/characterization/shared-phone.test.mjs
//
// One phone in the family. The parent signs in, then opens the child's link
// to show them their page — and the child's session used to replace the
// parent's, so the parent was locked out of their own board on their own
// phone (pre-launch review, 2026-09-28, Todoist 6hfCvVxgRmq8h2fq).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, familySession, redeemFamilyLink } from './harness.mjs';

async function family(baseUrl, email, name = 'נוגה', day = '01') {
  const booked = await (await fetch(`${baseUrl}/api/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name, subject: 'מתמטיקה', level: 'כיתה ח', phone: '0501234567', email, durationMin: 90,
      start: `2027-12-${day}T10:00:00+02:00`, end: `2027-12-${day}T11:30:00+02:00`,
    }),
  })).json();
  const parent = await familySession(booked.portal.link);
  const share = await (await fetch(`${baseUrl}/api/student-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: parent },
    body: JSON.stringify({ code: booked.portal.code }),
  })).json();
  return { parent, childLink: share.link, code: booked.portal.code };
}

const familyCookie = (res) => res.headers.getSetCookie().find(c => c.startsWith('maab_family='));

test("a student link replaces a parent's session and removes parent, sibling, and payment scope", async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const f = await family(baseUrl, 'shared@example.com');
    const sibling = await (await fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: f.parent },
      body: JSON.stringify({
        name: 'אחות', subject: 'מתמטיקה', level: 'כיתה ז', phone: '0501234567',
        email: 'shared@example.com', durationMin: 45,
        start: '2027-12-03T10:00:00+02:00', end: '2027-12-03T10:45:00+02:00',
      }),
    })).json();
    const res = await redeemFamilyLink(f.childLink, f.parent);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).destination, `/app/student?s=${f.code}`);
    const child = familyCookie(res)?.split(';')[0];
    assert.ok(child, 'the account cookie is replaced by a student-scoped cookie');

    const parentBoard = await fetch(`${baseUrl}/app/parent`, { headers: { Cookie: child }, redirect: 'manual' });
    assert.equal(parentBoard.status, 303, 'parent route is inaccessible');
    assert.equal((await fetch(`${baseUrl}/api/portal/${sibling.portal.code}`, { headers: { Cookie: child } })).status, 401,
      'sibling route is inaccessible');
    assert.equal((await fetch(`${baseUrl}/api/portal/${f.code}?kind=parent`, { headers: { Cookie: child } })).status, 401,
      'parent payment data is inaccessible');
  } finally { await stop(); }
});

test("the child's own phone still gets the child's session, and only that", async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const f = await family(baseUrl, 'kidphone@example.com');
    const res = await redeemFamilyLink(f.childLink);
    const child = familyCookie(res)?.split(';')[0];
    assert.ok(child, 'a session is set');
    const parentBoard = await fetch(`${baseUrl}/app/parent`, { headers: { Cookie: child }, redirect: 'manual' });
    assert.equal(parentBoard.status, 303, 'a child session does not reach the parent board');
  } finally { await stop(); }
});

test("another family's session on the device does not swallow the link", async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const f = await family(baseUrl, 'first@example.com');
    const other = await family(baseUrl, 'second@example.com', 'אלון', '02');
    const res = await redeemFamilyLink(f.childLink, other.parent);
    assert.ok(familyCookie(res), "the link's own session replaces a session that does not reach this child");
    assert.equal((await res.json()).destination, `/app/student?s=${f.code}`);
  } finally { await stop(); }
});
