// Round-trip test between the write side (src/lib/server/lesson/queue.ts)
// and the read side (src/lib/server/content.ts, materials.ts) of generated
// content: publishDraftOnly() writes a draft where readContent() reads it,
// and publish() records slides and plan in the versioned store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Set before importing queue.ts: it transitively imports db.ts, which
// resolves its DB_PATH from DATA_DIR once, at module load — same pattern
// as tests/characterization/harness.mjs. Setting it here, rather than
// inside a test body, keeps this test from ever touching the repo's real
// ./data/ directory.
process.env.DATA_DIR = await mkdtemp(join(tmpdir(), 'queue-content-'));

const { readContent } = await import('../../src/lib/server/content.ts');
const { latestPublished } = await import('../../src/lib/server/materials.ts');
const { publish, publishDraftOnly } = await import('../../src/lib/server/lesson/queue.ts');

/** A minimal but schema-valid LessonPlan — just enough to exercise the
 *  writing code, no lesson generation (no network call) involved. */
function fixturePlan() {
  return {
    title: 'בדיקה',
    gradeContext: 'י\'',
    slides: [{ heading: 'a', bullets: ['b'] }],
    examples: [{ problem: 'p', steps: ['s'], answer: 'a' }],
    homework: [{ task: 't', why: 'w' }],
    games: {},
  };
}

const meta = { subject: 'מתמטיקה', level: 'י\'', topic: 'נגזרות', student: 'בדיקה' };

test('publish() records the slides and the plan as published versions', async () => {
  const slug = 'roundtrip-lesson';

  await publish(slug, fixturePlan(), meta);

  assert.ok(latestPublished(slug, 'slides').content.includes('בדיקה'), 'the slides should be the published version');
  assert.equal(JSON.parse(latestPublished(slug, 'plan').content).title, 'בדיקה');
});

test('publishDraftOnly() writes drafts where readContent() reads them', async () => {
  const slug = 'roundtrip-draft';

  await publishDraftOnly(slug, fixturePlan(), meta);

  const slides = await readContent('drafts', slug, 'slides.html');
  assert.ok(slides.toString('utf8').includes('בדיקה'));

  const plan = await readContent('drafts', slug, 'lesson.json');
  assert.equal(JSON.parse(plan.toString('utf8')).title, 'בדיקה');
});
