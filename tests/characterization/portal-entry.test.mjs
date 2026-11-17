// The portal page is the Google sign-in page and nothing else.
//
// Owner decision 2026-11-16: the "link or code" section is not part of the
// login flow. A parent or student who holds a personal link opens it (that
// is /enter, not this page); a child no longer types a join code. The page
// must offer Google, a way to book, and a way to reach the tutor - and must
// not render a second door, an email box, or a code box.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './harness.mjs';

test('the portal page offers Google sign-in and no link or code entry', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const html = await (await fetch(`${baseUrl}/portal`)).text();

    assert.match(html, /action="\/auth\/google\/start"/, 'Google sign-in is the login');
    assert.match(html, /href="\/booking"/, 'booking stays reachable');

    for (const gone of [/כניסה עם קישור או קוד/, /כניסה בלי סיסמה/, /כניסה עם קוד/,
      /כניסה דרך המייל/, /קוד הצירוף/, /המייל שאיתו הזמנתם/, /שליחת קישור אישי/, /id="join-code"/, /id="portal-email"/]) {
      assert.doesNotMatch(html, gone, `${gone} must not be on the login page`);
    }
  } finally {
    await stop();
  }
});

test('an expired personal link lands on a page that does not offer to email a new one', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const html = await (await fetch(`${baseUrl}/portal?expired=1`)).text();
    assert.match(html, /הקישור כבר לא תקף/);
    assert.doesNotMatch(html, /לקבל חדש למייל/);
  } finally {
    await stop();
  }
});
