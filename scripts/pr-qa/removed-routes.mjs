/**
 * Routes deleted on purpose. A deletion cannot be exercised positively, so
 * each one is mapped to a concrete URL that the permissions journey requests
 * and requires to answer 404; the gate accepts a removed route only if listed.
 */
export const REMOVED_ROUTES = {
  '/api/game-result': '/api/game-result', '/api/join': '/api/join', '/api/request-link': '/api/request-link', '/api/results': '/api/results',
  '/api/learning/[slug]': '/api/learning/x', '/api/lessons': '/api/lessons', '/api/lessons/[slug]/experience': '/api/lessons/x/experience',
  '/api/lessons/[slug]/games': '/api/lessons/x/games', '/api/lessons/[slug]/materials': '/api/lessons/x/materials',
  '/app/games': '/app/games', '/app/learn/[slug]': '/app/learn/x', '/app/learn/[slug]/homework': '/app/learn/x/homework',
  '/app/lessons/[slug]/edit': '/app/lessons/x/edit', '/app/lessons/[slug]/experience': '/app/lessons/x/experience',
  '/app/lessons/[slug]/presenter': '/app/lessons/x/presenter', '/app/lessons/[slug]/preview': '/app/lessons/x/preview',
  '/app/lessons/[slug]/source/[questionId]': '/app/lessons/x/source/q1', '/app/play/[template]': '/app/play/quiz',
  '/app/review-game/[caseId]/[template]': '/app/review-game/c1/quiz', '/drafts/[slug]/[...file]': '/drafts/x/y.html',
  '/learn/parabolas': '/learn/parabolas', '/lessons/[slug]': '/lessons/x',
};
