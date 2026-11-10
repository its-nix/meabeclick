/** Concrete page families exercised by the existing seeded visual matrix. */
export const MATRIX_ROUTES = ['/', '/booking', '/portal', '/login', '/privacy', '/terms', '/enter', '/confirm-booking', '/learn/parabolas',
  '/app/tutor-setup/[code]', '/app/tutor-setup/done', '/app/dashboard', '/app/library', '/app/marketing', '/app/metrics', '/app/games',
  '/app/students/[code]', '/app/plan/[code]', '/app/report/[booking]', '/app/lessons/[slug]/edit', '/app/lessons/[slug]/experience',
  '/app/lessons/[slug]/presenter', '/app/play/[template]', '/app/parent', '/app/student'];
export function matrixPaths(paths, plan) {
  if (!plan || plan.mode === 'full') return paths;
  if (plan.mode !== 'selected' || !Array.isArray(plan.routes)) throw new Error('Invalid matrix impact plan');
  const patterns = plan.routes.map(route => new RegExp('^' + route.split('/').map(segment => segment.startsWith('[')
    ? segment.includes('...') ? '.+' : '[^/]+'
    : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/') + '$'));
  return paths.filter(path => patterns.some(pattern => pattern.test(path.split('?')[0])));
}
