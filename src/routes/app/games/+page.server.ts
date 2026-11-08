/**
 * Port of pages/app/games.html — the games CATALOG (a tool for picking a
 * template), not a game. Requires a tutor session (spec §6): this is one of
 * the two /app/* pages that does, unlike /app/parent and /app/student.
 *
 * The old page fetched /games/registry.json client-side with no auth at
 * all — the catalog is now gated the same way /app/dashboard is, per spec.
 *
 * registry.json is checked-in config, not runtime-written content (it does
 * not live under DATA_DIR — see spec §7), so it is imported directly rather
 * than served through a content route.
 *
 * Catalog examples use authenticated tutor previews, without student
 * signatures or score writes. Their return link preserves the lesson picker.
 *
 * Reads the registry through src/lib/server/lesson/registry.ts — the same
 * typed access the lesson-generation pipeline uses — rather than a second,
 * independent read of games/registry.json.
 */
import { requireAuth } from '$server/auth.ts';
import { tutorGameUrl } from '$server/urls.ts';
import { getRegistry } from '$server/lesson/registry.ts';
import { getStudentByCode } from '$server/entities.ts';
import { lessonForStudent, lessonGameSkillsForStudent } from '$server/lesson-games.ts';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export interface CatalogEntry {
  key: string;
  title: string;
  ready: boolean;
  bestFor: string;
  ageRange: [number, number];
  itemRange: [number, number];
  exampleUrl: string | null;
}

export const load: PageServerLoad = async (event) => {
  requireAuth(event);

  const lessonSlug = event.url.searchParams.get('lesson');
  const studentCode = event.url.searchParams.get('student');
  let selection: {
    lessonSlug: string; lessonTitle: string; lessonAt: string | null;
    studentId: number; studentCode: string; studentName: string; nodeId: number | null;
  } | null = null;
  if (lessonSlug || studentCode) {
    if (!lessonSlug || !studentCode) error(400, 'חסר הקשר לשיעור');
    const student = getStudentByCode(studentCode);
    const lesson = student ? lessonForStudent(lessonSlug, student.id) : null;
    if (!student || !lesson) error(404, 'השיעור לא נמצא עבור התלמיד/ה');
    const requestedNodeId = event.url.searchParams.get('node');
    const nodeId = requestedNodeId == null ? null : Number(requestedNodeId);
    if (nodeId != null && !lessonGameSkillsForStudent(student.id).some(skill => skill.id === nodeId)) {
      error(404, 'המיומנות לא נמצאה עבור התלמיד/ה');
    }
    selection = {
      lessonSlug, lessonTitle: lesson.title ?? lesson.topic ?? lesson.slug,
      lessonAt: lesson.lesson_at, studentId: student.id,
      studentCode: student.code, studentName: student.name, nodeId,
    };
  }

  const entries: CatalogEntry[] = Object.entries(getRegistry().templates).map(([key, t]) => {
    const ready = t.status === 'ready';
    let exampleUrl: string | null = null;
    if (ready && t.example) {
      try {
        exampleUrl = tutorGameUrl({ template: key, dataId: t.example, returnTo: event.url.pathname + event.url.search });
      } catch {
        exampleUrl = null;
      }
    }
    return {
      key,
      title: t.title,
      ready,
      bestFor: t.bestFor ?? '',
      ageRange: t.ageRange ?? [0, 0],
      itemRange: t.itemRange ?? [0, 0],
      exampleUrl,
    };
  });

  return {
    ready: entries.filter(e => e.ready),
    soon: entries.filter(e => !e.ready),
    selection,
  };
};
