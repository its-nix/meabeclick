/** Pages and API boundaries each real-data journey verifies. Import impact is discovered separately. */
export const JOURNEYS = [
  { id: 'roles-smoke', routes: ['/login', '/portal', '/app/dashboard', '/app/parent', '/app/student', '/api/login', '/api/logout', '/api/me', '/api/family'] },
  { id: 'public-booking', routes: ['/', '/booking', '/confirm-booking', '/privacy', '/terms', '/api/availability', '/api/book', '/api/events'] },
  { id: 'tutor-create', routes: ['/app/dashboard', '/api/students'] },
  { id: 'tutor-profile', routes: ['/app/students/[code]', '/app/dashboard', '/api/students/[code]', '/api/students/[code]/activity'] },
  { id: 'homework-publish', routes: ['/app/students/[code]', '/app/student', '/app/parent', '/app/report/[booking]', '/api/students/[code]/activity', '/api/portal/[code]', '/api/portal/[code]/homework'] },
  { id: 'homework-submit', routes: ['/app/student', '/app/parent', '/app/students/[code]', '/api/students/[code]/activity', '/api/portal/[code]/homework', '/api/portal/[code]'] },
  { id: 'parent-history', routes: ['/app/parent', '/api/portal/[code]', '/api/portal-students'] },
  { id: 'permissions', routes: ['/app/student', '/app/parent', '/app/dashboard', '/app/students/[code]', '/api/portal/[code]', '/api/family', '/api/students/[code]/activity'] },
  { id: 'invitations', routes: ['/enter', '/portal', '/onboarding', '/app/parent', '/auth/google/start', '/auth/google/callback', '/api/student-link', '/api/students/[code]/link', '/api/join', '/api/request-link', '/api/access/redeem', '/api/access/inspect'] },
  { id: 'payments', routes: ['/app/parent', '/app/students/[code]', '/api/payments', '/api/payments/all', '/api/payments/mark'] },
  { id: 'learning', routes: ['/app/student', '/app/learn/[slug]', '/lessons/[slug]', '/learn/parabolas', '/app/lessons/[slug]/edit', '/app/lessons/[slug]/experience', '/app/lessons/[slug]/presenter', '/app/learning-review', '/app/review-game/[caseId]/[template]', '/app/play/[template]', '/app/games', '/app/plan/[code]', '/app/report/[booking]', '/api/learning/[slug]', '/api/plans', '/api/plans/[id]/events', '/api/lessons', '/api/lessons/[slug]/materials', '/api/lessons/[slug]/experience', '/api/lessons/[slug]/games'] },
  { id: 'workspace', routes: ['/app/library', '/app/marketing', '/app/metrics', '/api/library', '/api/library/due', '/api/calendar-failures', '/api/health/ops', '/api/health/generation', '/api/teachers/[id]/setup-link', '/app/tutor-setup/[code]', '/app/tutor-setup/done'] },
];
export const JOURNEY_IDS = JOURNEYS.map(journey => journey.id);
