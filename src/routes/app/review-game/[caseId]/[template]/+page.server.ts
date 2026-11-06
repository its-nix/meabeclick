import { error } from '@sveltejs/kit';
import { requireAuth } from '$server/auth.ts';
import { reviewCase, reviewCorpus, reviewGames } from '$server/learning-review.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = event => {
  requireAuth(event);
  event.setHeaders({ 'Cache-Control':'private, no-store', 'X-Robots-Tag':'noindex, nofollow' });
  const item = reviewCase(event.params.caseId);
  if (!item) error(404,'הדוגמה לא נמצאה');
  const game = reviewGames(item).find(g=>g.template===event.params.template);
  if (!game) error(404,'המשחק לא נמצא');
  return { template:game.template, dataId:`review-${reviewCorpus.manifest.batch}-${item.brief.id}-${game.template}`,
    student:'תלמיד/ה לדוגמה',t:null,title:game.title,subject:'דוגמה לבדיקה · ללא רישום תוצאות',best:null,skill:null,
    gameData:game.body,preview:true,backUrl:`/app/learning-review#${item.brief.id}` };
};
