/**
 * A child claims their own board with the code their parent read to them.
 *
 * The code is single-use and valid for 15 minutes. Redeeming it
 * establishes a *student* session — scoped to that one child, with no
 * parent view and no sibling access — which is the whole reason a child
 * gets a code of their own rather than the parent's link.
 */
import { json } from '@sveltejs/kit';
import { consumeJoinCredential } from '$server/access-credentials.ts';
import { getStudentById } from '$server/entities.ts';
import { setFamilySession } from '$server/family-auth.ts';
import { readJson } from '$server/http.ts';
import { allowAccessAttempt } from '$server/access-rate-limit.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
  if (!allowAccessAttempt(getClientAddress())) {
    return json({ error: 'הקוד לא נכון או שכבר לא תקף. בקשו מההורה להכין קוד צירוף חדש.' }, {
      status: 401,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;

  const identity = consumeJoinCredential((parsed as Record<string, unknown>)?.code);
  const student = identity?.kind === 'student' ? getStudentById(identity.id) : null;

  /* One message for unknown, expired, and already-used. Distinguishing them
     would tell someone walking the codespace when they had found a real
     code that merely needed a fresher one — and the alphabet is short
     enough that the difference matters. */
  if (!student) {
    return json({ error: 'הקוד לא נכון או שכבר לא תקף. בקשו מההורה להכין קוד צירוף חדש.' }, {
      status: 401,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  setFamilySession(cookies, { kind: 'student', id: student.id });

  return json({ ok: true, code: student.code, name: student.name }, {
    headers: { 'Cache-Control': 'no-store' },
  });
};
