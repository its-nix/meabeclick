import { error } from '@sveltejs/kit';
import { requireAuth } from '$server/auth.ts';
import { documentHeaders } from '$server/document-policy.ts';
import { reviewCase, reviewCorpus, reviewUrl, renderReviewIndex, renderReviewHomework, renderReviewQuality } from '$server/learning-review.ts';
import { renderLearningDocument } from '$server/learning-render.ts';
import { renderPresenterNotes } from '$server/presenter-notes.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = event => {
  requireAuth(event);
  const id = event.url.searchParams.get('case');
  let html: string;
  if (!id) html = renderReviewIndex();
  else {
    const item = reviewCase(id);
    if (!item?.plan.learning) error(404, 'הדוגמה לא נמצאה');
    const backUrl = `/app/learning-review#${id}`;
    switch(event.url.searchParams.get('view') ?? 'lesson') {
      case 'lesson': html = renderLearningDocument(item.plan.learning, { demo: true, preview: true, storageScope: `review:${reviewCorpus.manifest.batch}:${id}`, backUrl, presenterUrl: reviewUrl(id,'presenter') }); break;
      case 'presenter': html = renderPresenterNotes(item.plan.learning,id,{presentationUrl:reviewUrl(id),editUrl:backUrl}); break;
      case 'homework': html = renderReviewHomework(item); break;
      case 'quality': html = renderReviewQuality(item); break;
      default: error(404,'התצוגה לא נמצאה');
    }
  }
  return new Response(html, { headers: { ...documentHeaders(), 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
};
