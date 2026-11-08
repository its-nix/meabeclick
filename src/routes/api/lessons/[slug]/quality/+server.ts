/** Tutor-only assessment of a generation snapshot, with explicit edit staleness. */
import { json } from '@sveltejs/kit';
import { apiAuthDenied } from '$server/auth.ts';
import { handle } from '$server/db.ts';
import { latest, latestPublished } from '$server/materials.ts';
import { candidateHash } from '$server/lesson/quality.ts';
import { latestGenerationQualityReport } from '$server/lesson/quality-store.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = event => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;
  const slug = event.params.slug;
  if (!handle().prepare('SELECT 1 FROM lessons WHERE slug = ?').get(slug)) return json({error:'לא נמצא'}, {status:404});
  const report = latestGenerationQualityReport(slug);
  const assessed = report?.status === 'passed' ? report.attempts.at(-1)?.candidateHash : null;
  const matches = (content: string | undefined): boolean => {
    if (!content || !assessed) return false;
    try { return candidateHash(JSON.parse(content)) === assessed; } catch { return false; }
  };
  return json({report, matchesLatestDraft:matches(latest(slug,'plan')?.content), matchesPublished:matches(latestPublished(slug,'plan')?.content)}, {headers:{'Cache-Control':'no-store'}});
};
