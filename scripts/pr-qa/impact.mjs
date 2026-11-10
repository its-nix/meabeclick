import { posix } from 'node:path';
import ts from 'typescript';
import { JOURNEYS, JOURNEY_IDS } from './catalog.mjs';

const SOURCE = /\.(?:[cm]?[jt]s|svelte|css)$/;
const GLOBAL = /^(?:package(?:-lock)?\.json|Dockerfile|\.dockerignore$|(?:ts|js)config\.json$|docker-compose\.yml|svelte\.config\.|vite\.config\.|src\/(?:hooks\.|app\.)|static\/|server\/Caddyfile|\.github\/workflows\/|scripts\/pr-qa\/|tests\/(?:qa\/|characterization\/(?:harness|learning-fixture|fake-google)\.mjs)|playwright\.qa\.config\.)/;
const RUNTIME = /^(?:src\/|static\/|server\/|scripts\/|games\/|templates\/|seed\/|tests\/browser\/|tests\/qa\/|\.github\/|package(?:-lock)?\.json$|Dockerfile$|docker-compose\.yml$|(?:svelte|vite)\.config\.|playwright\.qa\.config\.)/;

function routeOf(path) {
  if (!path.startsWith('src/routes/')) return null;
  const name = posix.basename(path);
  if (!/^\+(?:page|server|layout)(?:\.server)?\.(?:svelte|[jt]s)$/.test(name)) return null;
  const parts = posix.dirname(path).slice('src/routes'.length).split('/').filter(part => part && !/^\(.*\)$/.test(part));
  return { path: '/' + parts.join('/'), layout: name.startsWith('+layout'), page: name.startsWith('+page') };
}
function importPaths(path, content, inventory) {
  const code = path.endsWith('.svelte') ? [...content.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]).join('\n') : content;
  const imports = ts.preProcessFile(code, true, true).importedFiles.map(item => item.fileName);
  for (const match of content.matchAll(/@import\s+(?:url\()?['"]([^'"]+)['"]/g)) imports.push(match[1]);
  return imports.flatMap(specifier => {
    let base;
    if (specifier.startsWith('$lib/')) base = 'src/lib/' + specifier.slice(5);
    else if (specifier.startsWith('$server/')) base = 'src/lib/server/' + specifier.slice(8);
    else if (specifier.startsWith('.')) base = posix.normalize(posix.join(posix.dirname(path), specifier));
    else return [];
    const candidates = [base, ...['.ts', '.js', '.mjs', '.svelte', '.css', '/index.ts', '/index.js'].map(extension => base + extension)];
    return candidates.filter(candidate => inventory.has(candidate));
  });
}

export function selectImpact({ changedFiles, baseFiles = {}, headFiles = {}, forceAll = false }) {
  const changed = [...new Set(changedFiles)].sort();
  const inventory = new Set([...Object.keys(baseFiles), ...Object.keys(headFiles)]);
  const reverse = new Map();
  for (const files of [baseFiles, headFiles]) for (const [path, content] of Object.entries(files)) {
    if (!SOURCE.test(path)) continue;
    for (const dependency of importPaths(path, content, inventory)) {
      if (!reverse.has(dependency)) reverse.set(dependency, new Set());
      reverse.get(dependency).add(path);
    }
  }
  const routes = new Set(), reached = new Set(changed), queue = [...changed], reasons = [];
  let full = forceAll;
  if (forceAll) reasons.push('full release/manual verification');
  for (const path of changed) if (GLOBAL.test(path)) { full = true; reasons.push(`shared infrastructure: ${path}`); }
  while (queue.length) {
    const file = queue.shift();
    const route = routeOf(file);
    if (route?.layout) {
      if (route.path === '/') { full = true; reasons.push(`global layout dependency: ${file}`); }
      for (const candidate of inventory) {
        const child = routeOf(candidate);
        if (child?.page && (route.path === '/' || child.path === route.path || child.path.startsWith(route.path + '/'))) routes.add(child.path);
      }
    } else if (route) routes.add(route.path);
    for (const parent of reverse.get(file) ?? []) if (!reached.has(parent)) { reached.add(parent); queue.push(parent); }
  }
  // Assess every changed runtime file independently. One resolved page must
  // not hide another change whose consumers cannot be inferred statically.
  for (const file of changed.filter(path => RUNTIME.test(path) && !GLOBAL.test(path))) {
    const seen = new Set(), pending = [file];
    let resolved = false;
    while (pending.length) {
      const candidate = pending.pop();
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      if (routeOf(candidate)) { resolved = true; break; }
      pending.push(...reverse.get(candidate) ?? []);
    }
    if (!resolved) { full = true; reasons.push(`unresolved runtime dependency: ${file}`); }
  }
  const runtime = full || changed.some(path => RUNTIME.test(path));
  const unmappedRoutes = [...routes].filter(route => !JOURNEYS.some(journey => journey.routes.includes(route))).sort();
  if (unmappedRoutes.length) { full = true; reasons.push(`unmapped route requires coverage: ${unmappedRoutes.join(', ')}`); }
  if (runtime && !routes.size && !full) { full = true; reasons.push('runtime change has no statically resolved route; expand coverage'); }
  if (!runtime) return { version: 1, mode: 'skip', changedFiles: changed, routes: [], unmappedRoutes: [], journeys: [], reasons: ['no runtime changes; UI verification explicitly skipped'] };
  const journeys = full ? [...JOURNEY_IDS] : JOURNEYS.filter(journey => journey.id === 'roles-smoke' || journey.routes.some(route => routes.has(route))).map(journey => journey.id);
  if (!reasons.length) reasons.push('static dependency impact plus declared page/API journey contracts');
  return { version: 1, mode: full ? 'full' : 'selected', changedFiles: changed, routes: [...routes].sort(), unmappedRoutes, journeys, reasons };
}
