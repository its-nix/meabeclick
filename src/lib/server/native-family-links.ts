import { STUDENT_GAMES_PATH } from '../native-links.ts';

type Entry = Record<string, unknown>;

/**
 * Game and practice links in a family page payload. Students all go to the
 * native games page; parents do not play, so they get no link (their status
 * facts stay). Every old per-game URL is dropped, never passed through.
 */
export function nativeFamilyLinks<T extends Record<string, unknown>>(data: T, kind: 'student' | 'parent'): T {
  const fix = (list: unknown, linkless?: boolean) => Array.isArray(list)
    ? list.map((raw): unknown => {
        if (!raw || typeof raw !== 'object') return raw;
        const e = { ...(raw as Entry) };
        const had = typeof e.url === 'string' || typeof e.template === 'string' || linkless;
        delete e.url;
        if (kind === 'student' && had) e.url = STUDENT_GAMES_PATH;
        return e;
      })
    : list;
  const out: Record<string, unknown> = { ...data };
  for (const key of ['games', 'homework']) if (key in out) out[key] = fix(out[key]);
  for (const key of ['learning', 'learningPreparation']) if (key in out) out[key] = fix(out[key], true);
  return out as T;
}
