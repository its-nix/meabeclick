import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const { STUDENT_GAMES_PATH } = await import('../../src/lib/native-links.ts');

test('students are sent to the native games page', () => {
  assert.equal(STUDENT_GAMES_PATH, '/app/student/games');
  assert.match(readFileSync('src/routes/app/student/+page.svelte', 'utf8'), /href=\{STUDENT_GAMES_PATH\}/);
});

/* There is one game system, the Drive-native one. The classic game system and
   the site-made lesson pages and editors are gone for good, so this guard
   fails on any trace of them coming back. */
const REMOVED = [
  'src/lib/games', 'src/lib/styles/games.css', 'seed',
  'src/lib/server/lesson-games.ts', 'src/lib/server/game-filler.ts', 'src/lib/server/assigned-teaching.ts',
  'src/lib/server/results.ts', 'src/lib/urls.ts', 'src/lib/server/native-family-links.ts',
  'src/routes/app/play', 'src/routes/app/games', 'src/routes/app/learn', 'src/routes/app/lessons',
  'src/routes/app/review-game', 'src/routes/lessons',
  'src/routes/api/game-result', 'src/routes/api/results', 'src/routes/api/lessons', 'src/routes/api/learning',
  // The legacy lesson generator (removed 2026-11-18): lessons are prepared only by the Drive-native pipeline.
  'src/routes/api/library', 'src/routes/api/drive-sync', 'src/routes/api/health/generation',
  'src/routes/app/learning-pilot', 'src/routes/app/learning-review',
  ...['queue', 'prep', 'editing', 'homework', 'taught-bundle', 'teaching-context', 'targeting', 'generation-health'].map(n => `src/lib/server/lesson/${n}.ts`),
  'src/lib/server/library', 'src/lib/server/drive', 'src/lib/server/materials.ts', 'src/lib/server/urls.ts',
  'src/lib/server/learning-store.ts', 'src/lib/server/learning-render.ts', 'src/lib/server/learning-review.ts',
  'src/lib/server/presenter-notes.ts', 'src/lib/server/teaching-display.ts', 'src/lib/server/reports/after.ts',
  'src/lib/server/reports/teaching-coverage.ts', 'src/lib/library-table.ts', 'src/lib/learning/teaching.ts',
  'scripts/library-local.mjs', 'scripts/generate-learning-review.mjs', 'scripts/render-learning-video.mjs',
  'server/meabeclick-drive-sync.service', 'server/meabeclick-drive-sync.timer',
  'server/meabeclick-generation-health.service', 'server/meabeclick-generation-health.timer',
];

test('the classic game system and the legacy lesson pages and editors no longer exist', () => {
  assert.deepEqual(REMOVED.filter(path => existsSync(path)), []);
});

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out); else out.push(path);
  }
  return out;
}

const SELF = 'tests/unit/native-links.test.mjs';
// The QA gate's declared list of deleted routes names them on purpose; each is asserted to 404.
const REMOVED_LIST = 'scripts/pr-qa/removed-routes.mjs';
// Tests that assert a removed legacy-generator endpoint now answers 404 must name it.
const ASSERTS_404 = new Set(['tests/characterization/learning-archive.test.mjs', 'tests/characterization/learning-google.test.mjs', 'tests/characterization/visual-pilot.test.mjs', 'tests/qa/journeys.spec.mjs']);
const HISTORY = /^(?:src\/lib\/server\/migrations\/|tests\/unit\/(?:migrations|results-backfill|learning-migrations)\.test\.mjs$)|corpus\.json$/;
const NO_TRACE = new RegExp([
  String.raw`/app/(?:play|learn|games|lessons|review-game)\b`,
  String.raw`["'\x60(]/lessons/`,
  String.raw`/api/(?:game-result|results|lessons|learning)(?![-\w])`,
  String.raw`\$lib/games|lib/games/|lesson-games|game-filler|assigned-teaching|native-family-links`,
  String.raw`\b(?:lesson_games|lesson_game_assignments|lesson_game_revisions|game_filler|game_skills|results_v2)\b`,
  String.raw`\b(?:checkRegistry|TEMPLATE_FILES|toTemplateShape|GamesMap|saveLesson|learning_progress|learning_events)\b|games/registry|["'\x60(]/drafts/`,
  // The legacy lesson generator.
  String.raw`lesson/(?:queue|prep|editing|homework|taught-bundle|teaching-context|targeting|generation-health)\.ts|library/(?:prepare|store|view|use|due|slug)\.ts|learning-(?:store|render|pilot-page)\b|presenter-notes|teaching-display|learning-review|app/learning-pilot`,
  String.raw`api/library|api/drive-sync|api/health/generation|\bgeneration-health\b|renderLearningDocument|withLegacyPublication|assertLegacyAuthoring|triggerForBooking`,
  String.raw`\b(?:library_items|library_uses|lesson_engines|drive_items|learning_retired_lessons)\b`,
].join('|'));

test('no source, script or test refers to a removed route, module or table (migrations keep history)', () => {
  const hits = [];
  for (const root of ['src', 'scripts', 'tests']) {
    for (const file of walk(root)) {
      const rel = relative('.', file);
      // Migrations and their tests are history; the review corpora are recorded model output.
      if (rel === SELF || rel === REMOVED_LIST || ASSERTS_404.has(rel) || HISTORY.test(rel)) continue;
      if (!/\.(ts|svelte|mjs|js|css|json)$/.test(rel)) continue;
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => { if (NO_TRACE.test(line)) hits.push(`${rel}:${i + 1}`); });
    }
  }
  assert.deepEqual(hits, []);
});
