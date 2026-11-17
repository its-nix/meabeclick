import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const { STUDENT_GAMES_PATH } = await import('../../src/lib/native-links.ts');
const { nativeFamilyLinks } = await import('../../src/lib/server/native-family-links.ts');

test('students are sent to the native games page', () => {
  assert.equal(STUDENT_GAMES_PATH, '/app/student/games');
  const data = nativeFamilyLinks({
    games: [{ title: 'a', template: 'quiz', dataId: 'x', url: '/app/play/quiz?d=x' }, { title: 'b', url: 'games/memory.html?d=1' }],
    homework: [{ task: 't', url: '/app/play/quiz?d=y' }, { task: 'no link' }],
    learning: [{ slug: 's', url: '/app/learn/s' }],
    learningPreparation: [{ slug: 'p', url: '/app/learn/p/homework' }],
  }, 'student');
  for (const e of [...data.games, data.homework[0], ...data.learning, ...data.learningPreparation]) assert.equal(e.url, STUDENT_GAMES_PATH);
  assert.equal(data.homework[1].url, undefined);
});

test('parents get no game links at all', () => {
  const data = nativeFamilyLinks({
    games: [{ title: 'a', url: '/app/play/quiz?d=x' }],
    homework: [{ task: 't', url: '/app/play/quiz?d=y', dataId: 'y' }],
    learning: [{ slug: 's', url: '/app/learn/s' }],
  }, 'parent');
  assert.ok(!JSON.stringify(data).match(/\/app\/(play|learn|student\/games)/));
  assert.equal(data.homework[0].dataId, 'y', 'status facts are kept');
});

/* Nothing outside the classic/legacy code itself may link to it. That code is
   removed in the next step; this guard keeps new links from appearing. */
const LEGACY = [
  /^src\/routes\/app\/(learn|lessons|play|games|review-game)\//, /^src\/routes\/(learn|lessons)\//,
  /^src\/lib\/(games|server\/lesson)\//, /^src\/lib\/server\/(urls|presenter-notes|assigned-teaching|visual-deck-render|learning-review|teaching-display|game-filler|boot-checks)\.ts$/,
  /^src\/lib\/urls\.ts$/, /^src\/lib\/server\/migrations\//, /\.json$/, /\.css$/, /^src\/routes\/\+error\.svelte$/, /^src\/routes\/app\/\+layout\.svelte$/,
  /^src\/lib\/server\/lesson\//, /^src\/routes\/api\/lessons\/\[slug\]\/materials\//,
];
const BAD = /["'`(]\/app\/(learn\/|play\/|lessons\/[^"'`]*\/edit)|\$\{site\}\/app\/lessons|\bgameUrl\(/;
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
test('no product source links to the classic or legacy routes', () => {
  const hits = [];
  for (const f of walk('src')) {
    const rel = relative('.', f);
    if (LEGACY.some(r => r.test(rel))) continue;
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => { if (/^\s*(\*|\/\/|\/\*)/.test(line)) return; if (BAD.test(line)) hits.push(`${rel}:${i + 1}`); });
  }
  assert.deepEqual(hits, []);
});
