// Lior 2026-11-16: the personal link in a booking email may be opened on a stranger's computer,
// so signing in with it must not create a persistent connection. Only Google sign-in does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, redeemFamilyLink } from './harness.mjs';

const book = (baseUrl) => fetch(`${baseUrl}/api/book`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'יובל כהן', subject: 'מתמטיקה', level: 'כיתה ט',
    phone: '0501234567', email: 'orit@example.com', durationMin: 90,
    start: '2027-10-11T10:00:00+03:00', end: '2027-10-11T11:30:00+03:00',
  }),
});
const familyCookie = (response) => response.headers.getSetCookie().find(c => c.startsWith('maab_family='));

test('redeeming the emailed link sets a browser-session cookie with a short-lived token', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const booking = await book(baseUrl);
    const bookingCookie = familyCookie(booking);
    assert.ok(bookingCookie, 'booking signs the family in');
    assert.doesNotMatch(bookingCookie, /max-age|expires/i, 'booking sign-in is not persistent either');
    const booked = await booking.json();

    const redeemed = await redeemFamilyLink(booked.portal.link);
    assert.equal(redeemed.status, 200);
    const raw = familyCookie(redeemed);
    assert.ok(raw, 'the link signs the holder in');
    assert.doesNotMatch(raw, /max-age|expires/i, 'no Max-Age/Expires: the browser drops it when it closes');
    const token = decodeURIComponent(raw.split(';')[0].split('=')[1]);
    const expiresMs = Number(token.split('.')[3]);
    assert.ok(expiresMs <= Date.now() + 12 * 3600 * 1000 + 5000, 'a copied cookie value dies within hours');
    assert.ok(expiresMs > Date.now(), 'and is valid now');
  } finally { await stop(); }
});
