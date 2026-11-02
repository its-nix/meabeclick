import { safeNext } from './safe-next.ts';

const tutorPage = /^\/app\/(?:dashboard|library|games|students\/[^/]+|plan\/[^/]+|report\/[^/]+|lessons\/[^/]+\/edit)$/;

/** Preserve tutor page context, never authentication or action endpoints. */
export function safeTutorReturn(raw: string | null, origin: string, fallback = '/app/dashboard'): string {
  function page(value: string | null): string | null {
    if (!value?.startsWith('/')) return null;
    try {
      const url = new URL(value, origin);
      if (url.origin !== origin || !tutorPage.test(url.pathname)) return null;
      url.searchParams.delete('returnTo');
      return safeNext(url.pathname + url.search, origin);
    } catch { return null; }
  }
  return page(raw) ?? page(fallback) ?? '/app/dashboard';
}
