import { json } from '@sveltejs/kit';
import { apiAuthDenied } from '$server/auth.ts';
import { getStudentByCode } from '$server/entities.ts';
import { decideTutorReview, tutorNativeResults, TutorResultError } from '$server/native-learning/tutor-results.ts';
import type { RequestHandler } from './$types';

const headers = { 'Cache-Control': 'private, no-store' };

export const GET: RequestHandler = event => {
  const denied = apiAuthDenied(event); if (denied) return denied;
  const student = getStudentByCode(event.params.code);
  if (!student) return json({ error: 'התלמיד/ה לא נמצא/ה' }, { status: 404, headers });
  return json({ games: tutorNativeResults(student.id) }, { headers });
};

export const POST: RequestHandler = async event => {
  const denied = apiAuthDenied(event); if (denied) return denied;
  const student = getStudentByCode(event.params.code);
  if (!student) return json({ error: 'התלמיד/ה לא נמצא/ה' }, { status: 404, headers });
  let body: { resultId?: unknown; outcome?: unknown };
  try { body = JSON.parse(await event.request.text()); } catch { return json({ error: 'בקשה לא תקינה' }, { status: 400, headers }); }
  if (!body || typeof body !== 'object') return json({ error: 'בקשה לא תקינה' }, { status: 400, headers });
  try { decideTutorReview(student.id, body.resultId, body.outcome); return json({ games: tutorNativeResults(student.id) }, { headers }); }
  catch (e) { return e instanceof TutorResultError ? json({ error: e.message }, { status: e.status, headers }) : json({ error: 'שגיאה' }, { status: 500, headers }); }
};
