import { json } from '@sveltejs/kit';
import { apiAuthDenied } from '$server/auth.ts';
import { readJson } from '$server/http.ts';
import {
  archiveLessonGame,
  createLessonGame,
  GameValidationError,
  getLessonGame,
  publishLessonGame,
  saveAndPublishLessonGame,
  saveLessonGameDraft,
  validateLessonGame,
} from '$server/lesson-games.ts';
import type { RequestHandler } from './$types';

function failure(err: unknown): Response {
  const message = err instanceof Error ? err.message : 'invalid game assignment';
  const status = message === 'revision conflict' ? 409
    : message.includes('not found') ? 404
    : message.includes('not available') ? 403
    : 400;
  if (err instanceof GameValidationError) {
    return json({ error: 'פרטי המשחק אינם תקינים.', issues: err.issues }, { status: 400 });
  }
  const error = status === 409 ? 'המשחק השתנה מאז שפתחתם אותו.'
    : status === 404 ? 'המשחק לא נמצא.'
    : status === 403 ? 'אין הרשאה לבצע את הפעולה הזו.'
    : 'לא הצלחנו לשמור את המשחק.';
  return json({ error }, { status });
}

export const GET: RequestHandler = async (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;
  const assignmentId = event.url.searchParams.get('assignmentId') ?? '';
  const assignment = getLessonGame(assignmentId);
  if (!assignment || assignment.lessonSlug !== event.params.slug) {
    return json({ error: 'המשחק לא נמצא.' }, { status: 404 });
  }
  return json({ assignment });
};

export const POST: RequestHandler = async (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;
  const parsed = await readJson(event.request);
  if (parsed instanceof Response) return parsed;
  const body = parsed as Record<string, unknown>;
  try {
    const assignment = createLessonGame({
      lessonSlug: event.params.slug,
      studentId: Number(body.studentId),
      template: String(body.template ?? ''),
      nodeId: body.nodeId == null ? null : Number(body.nodeId),
    });
    return json({ assignment }, { status: 201 });
  } catch (err) {
    return failure(err);
  }
};

export const PATCH: RequestHandler = async (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;
  const parsed = await readJson(event.request);
  if (parsed instanceof Response) return parsed;
  const body = parsed as Record<string, unknown>;
  const assignmentId = String(body.assignmentId ?? '');
  const current = getLessonGame(assignmentId);
  if (!current || current.lessonSlug !== event.params.slug) return json({ error: 'המשחק לא נמצא.' }, { status: 404 });

  try {
    if (body.action === 'archive') {
      archiveLessonGame(assignmentId);
      return json({ ok: true });
    }
    if (body.action === 'copy') {
      validateLessonGame(current.template, body.body);
      if (!String(body.title ?? '').trim()) {
        throw new GameValidationError([{ path: 'title', message: 'יש להזין כותרת לתלמיד/ה.' }]);
      }
      const copy = createLessonGame({
        lessonSlug: current.lessonSlug,
        studentId: current.studentId,
        template: current.template,
        nodeId: body.nodeId == null ? null : Number(body.nodeId),
      });
      return json({ assignment: saveLessonGameDraft({
        assignmentId: copy.id,
        expectedRevision: copy.revision,
        title: String(body.title ?? ''),
        body: body.body,
        nodeId: Object.hasOwn(body, 'nodeId') ? (body.nodeId == null ? null : Number(body.nodeId)) : undefined,
      }) });
    }
    if (body.action === 'publish') {
      return json({ assignment: body.body !== undefined
        ? saveAndPublishLessonGame({
            assignmentId,
            expectedRevision: Number(body.expectedRevision),
            title: String(body.title ?? ''),
            body: body.body,
            nodeId: Object.hasOwn(body, 'nodeId') ? (body.nodeId == null ? null : Number(body.nodeId)) : undefined,
          })
        : publishLessonGame({ assignmentId, expectedRevision: Number(body.expectedRevision) }) });
    }
    if (body.action === 'save') {
      return json({ assignment: saveLessonGameDraft({
        assignmentId,
        expectedRevision: Number(body.expectedRevision),
        title: String(body.title ?? ''),
        body: body.body,
        nodeId: Object.hasOwn(body, 'nodeId') ? (body.nodeId == null ? null : Number(body.nodeId)) : undefined,
      }) });
    }
    return json({ error: 'הפעולה שביקשתם אינה זמינה.' }, { status: 400 });
  } catch (err) {
    return failure(err);
  }
};
