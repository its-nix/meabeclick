/**
 * The link the tutor hands a family, replacing "regenerate their password".
 *
 * What this replaces: `POST /api/students/:code/regenerate` minted a new
 * 4-digit password and showed it to the tutor so she could read it back
 * over WhatsApp. Every recovery was a manual step in her week, and the
 * thing she read out was a secret the family then had to keep.
 *
 * She now copies a link instead. Two of them, because they are for
 * different people: the account link opens the parent view of the whole
 * family, and the student link opens one child's own board.
 *
 * Issuance supersedes older unused credentials for the same account or
 * student scope. Established sessions remain active, so helping a family
 * does not sign out a device that is already using the portal.
 */
import { json } from '@sveltejs/kit';
import { apiAuthDenied } from '$server/auth.ts';
import { getStudentByCode, accountForStudent } from '$server/entities.ts';
import { issueAccountCredential, issueStudentCredentials } from '$server/access-credentials.ts';
import { readJson } from '$server/http.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;

  const student = getStudentByCode(event.params.code);
  if (!student) return json({ error: 'student not found' }, { status: 404 });

  const account = accountForStudent(student.id);
  if (!account) return json({ error: 'student has no account' }, { status: 500 });

  const parsed = await readJson(event.request);
  if (parsed instanceof Response) return parsed;
  const scope = (parsed as Record<string, unknown>)?.scope;

  if (scope === 'account') {
    const credential = issueAccountCredential(account.id, { type: 'admin' });
    return json({
      scope,
      accountName: account.name,
      link: credential.link,
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (scope !== 'student') {
    return json({ error: 'invalid access scope' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  const credential = issueStudentCredentials(student.id, { type: 'admin' });

  return json({
    scope,
    name: student.name,
    link: credential.link,
    joinCode: credential.joinCode,
  }, { headers: { 'Cache-Control': 'no-store' } });
};
