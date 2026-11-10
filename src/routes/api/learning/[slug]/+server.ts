import { json } from '@sveltejs/kit';
import { learningAccess, assignedExperience,presentationExperience, learningProgress, recordLearning,homeworkReleased } from '$server/learning-store.ts';
import { readJson } from '$server/http.ts';
import type { RequestHandler } from './$types';

const headers = { 'Cache-Control': 'no-store' };
export const GET: RequestHandler = ({ params, locals,url }) => {
  const access = learningAccess(params.slug, locals);
  if (!access) return json({ error: 'אין גישה לשיעור' }, { status: 401, headers });
  if(url.searchParams.get('view')==='homework'&&!locals.authenticated&&!homeworkReleased(params.slug))return json({error:'התרגול עדיין לא זמין'},{status:404,headers});
  const lesson = url.searchParams.get('view')==='homework'?assignedExperience(params.slug,'homework'):presentationExperience(params.slug);
  if (!lesson) return json({ error: 'השיעור לא נמצא' }, { status: 404, headers });
  return json({ scope: access.code, fingerprint: lesson.fingerprint, progress: learningProgress(access.studentId, params.slug, lesson.fingerprint) }, { headers });
};

export const POST: RequestHandler = async ({ params, locals, request,url }) => {
  const access = learningAccess(params.slug, locals);
  if (!access) return json({ error: 'אין גישה לשיעור' }, { status: 401, headers });
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const b = body as Record<string, unknown>;
  if(url.searchParams.get('view')==='homework'&&!locals.authenticated&&!homeworkReleased(params.slug))return json({error:'התרגול עדיין לא זמין'},{status:404,headers});
  if (typeof b?.id !== 'string' || !/^[a-f0-9-]{36}$/.test(b.id) || typeof b.sceneId !== 'string' || !['answer', 'hint', 'visit','solution'].includes(String(b.action))) {
    return json({ error: 'פעולה לא תקינה' }, { status: 400, headers });
  }
  const lesson = url.searchParams.get('view')==='homework'?assignedExperience(params.slug,'homework'):presentationExperience(params.slug);
  if (!lesson) return json({ error: 'השיעור לא נמצא' }, { status: 404, headers });
  if (b.fingerprint !== lesson.fingerprint) return json({ error: 'גרסת השיעור השתנתה' }, { status: 409, headers });
  if (!lesson.experience.scenes.some(s => s.id === b.sceneId)) return json({ error: 'השלב לא נמצא' }, { status: 400, headers });
  try {
    // Tutor previews must never file evidence in a student's record.
    if (locals.authenticated) return json({ error: 'לבדיקת תשובות יש לפתוח את דף התלמיד/ה' }, { status: 403, headers });
    const result = recordLearning({ id: b.id, studentId: access.studentId, slug: params.slug, fingerprint: lesson.fingerprint,
      sceneId: b.sceneId, action: b.action as 'answer' | 'hint' | 'visit'|'solution', value: b.value, experience: lesson.experience });
    return json(result, { headers });
  } catch {
    return json({ error: 'לא ניתן לשמור את הפעולה' }, { status: 400, headers });
  }
};
