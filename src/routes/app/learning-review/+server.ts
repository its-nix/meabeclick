import { error } from '@sveltejs/kit';
import { requireAuth } from '$server/auth.ts';
import { documentHeaders } from '$server/document-policy.ts';
import { reviewCase, reviewCorpusFor, reviewGames, reviewUrl, renderReviewIndex, renderReviewHomework } from '$server/learning-review.ts';
import { renderLearningDocument } from '$server/learning-render.ts';
import { renderPresenterNotes } from '$server/presenter-notes.ts';
import{teachingDisplay,homeworkExperience,homeworkSourceIds,homeworkIndependentIds}from'$server/teaching-display.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = event => {
  requireAuth(event);
  const version=event.url.searchParams.get('version')==='v2'?'v2':'baseline';const reviewCorpus=reviewCorpusFor(version);
  const id = event.url.searchParams.get('case');
  let html: string;
  if (!id) html = renderReviewIndex(version);
  else {
    const item = reviewCase(id,version);
    if (!item?.plan.learning) error(404, 'הדוגמה לא נמצאה');
    const backUrl = `/app/learning-review${version==='v2'?'?version=v2':''}#${id}`;
    const gameUrls=Object.fromEntries(reviewGames(item,version).map(g=>[g.key,g.url]));
    const teaching=teachingDisplay(item.plan,id,{gameUrls,homeworkUrl:reviewUrl(id,'homework',version)});
    switch(event.url.searchParams.get('view') ?? 'lesson') {
      case 'lesson': html = renderLearningDocument(item.plan.learning, { demo: true, preview: true, storageScope: `review:${reviewCorpus.manifest.batch}:${id}`,teaching, backUrl, presenterUrl: reviewUrl(id,'presenter',version) }); break;
      case 'presenter': html = renderPresenterNotes(item.plan.learning,id,{presentationUrl:reviewUrl(id,'lesson',version),editUrl:backUrl,plan:item.plan,teaching,homeworkUrl:reviewUrl(id,'homework',version)+'&solutions=1'}); break;
      case 'homework': html = version==='v2'?renderLearningDocument(homeworkExperience(item.plan),{demo:true,preview:true,variant:'homework',solutions:event.url.searchParams.get('solutions')==='1',sourceIds:homeworkSourceIds(item.plan),independentSceneIds:homeworkIndependentIds(item.plan),storageScope:`review:${reviewCorpus.manifest.batch}:${id}:homework`,backUrl}):renderReviewHomework(item); break;
      default: error(404,'התצוגה לא נמצאה');
    }
  }
  return new Response(html, { headers: { ...documentHeaders(), 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
};
