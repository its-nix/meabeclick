import { fail, redirect } from '@sveltejs/kit';
import { pendingGoogleProfile, finishPendingProfile, linkGoogleIdentity, linkedGoogleIdentity,
  familyDestination, GOOGLE_PENDING_COOKIE } from '$server/google-login.ts';
import { findAccountByEmail } from '$server/entities.ts';
import { enrollFromBooking } from '$server/enroll.ts';
import { inTransaction } from '$server/db.ts';
import { setFamilySession } from '$server/family-auth.ts';
import { SUBJECT } from '$lib/subjects.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ cookies, setHeaders }) => {
  setHeaders({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'same-origin' });
  const pending = pendingGoogleProfile(cookies.get(GOOGLE_PENDING_COOKIE));
  if (!pending) redirect(303, '/portal?authError=expired');
  return { name: pending.profile.name, email: pending.profile.email };
};
export const actions: Actions = {
  default: async ({ request, cookies }) => {
    const pending = pendingGoogleProfile(cookies.get(GOOGLE_PENDING_COOKIE));
    if (!pending) redirect(303, '/portal?authError=expired');
    const form = await request.formData();
    const role = String(form.get('role') ?? '');
    const name = String(form.get('name') ?? '').trim().replace(/\s+/g, ' ');
    const level = String(form.get('level') ?? '').trim();
    const values = { role, name, level };
    if (!['learner', 'parent'].includes(role) || !name || name.length > 100 || !level || level.length > 60) {
      return fail(400, { ...values, error: 'בחרו מי לומד ומלאו שם וכיתה או רמה.' });
    }
    let identity;
    try {
      identity = inTransaction(() => {
        const already = linkedGoogleIdentity(pending.profile.subject);
        if (already) { finishPendingProfile(pending.flow); return already; }
        // Another tab/booking may have created this email since the callback.
        // Never silently turn a pending signup into a claim on another family.
        if (findAccountByEmail(pending.profile.email)) throw new Error('conflict');
        const enrolled = enrollFromBooking({ name, email: pending.profile.email, subject: SUBJECT, level, isSelf: role === 'learner' });
        const created = { kind: 'account' as const, id: enrolled.account.id };
        linkGoogleIdentity(pending.profile, created);
        finishPendingProfile(pending.flow);
        return created;
      });
    } catch {
      return fail(409, { ...values, error: 'לא ניתן להשלים את ההרשמה כרגע. אם כבר נרשמתם, חזרו לכניסה כדי לפתוח את הדף הקיים.' });
    }
    cookies.delete(GOOGLE_PENDING_COOKIE, { path: '/onboarding' });
    setFamilySession(cookies, identity);
    redirect(303, familyDestination(identity, pending.flow.next_path));
  },
};
