import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PARABOLAS } from '../../src/lib/learning/parabolas.ts';
import { publicExperience } from '../../src/lib/learning/model.ts';
import { LEARNING_SCHEMA } from '../../src/lib/learning/schema.ts';
import { experienceProblems, learningFingerprint, renderLearningDocument } from '../../src/lib/server/learning-render.ts';
import { renderPresenterNotes } from '../../src/lib/server/presenter-notes.ts';
import { BRAND_LOGO_SRC } from '../../src/lib/brand.ts';

test('generation requires usable presenter notes for every stage, including discovery and reflection', () => {
  assert.deepEqual(experienceProblems(PARABOLAS, { requirePresenterNotes: true }), []);
  assert.ok(LEARNING_SCHEMA.properties.scenes.items.required.includes('presenterNotes'));
  for (const value of [undefined, null, {}, { explanation: 'x', ask: 'x', expectedAnswer: 'x', ifStuck: '' }]) {
    const lesson = structuredClone(PARABOLAS);
    lesson.scenes.at(-1).presenterNotes = value;
    assert.ok(experienceProblems(lesson, { requirePresenterNotes: true }).some(p => p.includes('הערות למורה')));
  }
});

test('older lessons remain readable without inventing teacher notes', () => {
  const old = structuredClone(PARABOLAS);
  old.scenes.forEach(scene => delete scene.presenterNotes);
  assert.deepEqual(experienceProblems(old), []);
  assert.match(renderLearningDocument(old), /data-scene=/);
  assert.match(renderPresenterNotes(old, 'old'), /עדיין אין הערות/);
});

test('teacher notes never enter learner, projector, demo, solution or worksheet data', () => {
  const lesson = structuredClone(PARABOLAS);
  lesson.scenes.forEach(scene => scene.presenterNotes.explanation = 'PrivateTeacherExplanation');
  assert.ok(!JSON.stringify(publicExperience(lesson)).includes('presenterNotes'));
  for (const options of [{}, { demo: true }, { preview: true }, { solutions: true }]) {
    const html = renderLearningDocument(lesson, options);
    assert.ok(!html.includes('PrivateTeacherExplanation'));
    assert.ok(!html.includes('presenterNotes'));
    assert.ok(html.includes(BRAND_LOGO_SRC));
    assert.ok(!html.includes('brand-symbol'));
  }
  assert.match(renderPresenterNotes(lesson, 'lesson-one'), /PrivateTeacherExplanation/);
});

test('editing private notes preserves student progress and escapes HTML while rendering math', () => {
  const lesson = structuredClone(PARABOLAS);
  lesson.scenes[0].presenterNotes.explanation = '<script>INJECTION</script> \\(\\frac{1}{2}\\)';
  assert.equal(learningFingerprint(lesson), learningFingerprint(PARABOLAS));
  const html = renderPresenterNotes(lesson, 'safe-slug');
  assert.ok(!html.includes('<script>INJECTION'));
  assert.match(html, /&lt;/);
  assert.match(html, /INJECTION/);
  assert.match(html, /class="katex"/);
  assert.match(html, /\/app\/learn\/safe-slug#scene=notice/);
  lesson.scenes[0].presenterNotes.explanation = '\\(\\unknowncommand{x}\\)';
  assert.ok(experienceProblems(lesson).some(p => p.includes('נוסחה')));
});

test('video compositions use original logo artwork and exclude private teaching notes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'learning-video-brand-'));
  let composition;
  try {
    const lesson = structuredClone(PARABOLAS);
    lesson.title = 'בדיקת וידאו ' + dir.split('/').at(-1);
    lesson.scenes[0].presenterNotes.explanation = 'PrivateVideoNotes';
    const input = join(dir, 'lesson.json');
    writeFileSync(input, JSON.stringify(lesson));
    const output = execFileSync(process.execPath, ['scripts/render-learning-video.mjs', '--input', input, '--prepare-only'], { encoding: 'utf8' });
    composition = output.match(/^Composition: (.+)$/m)[1];
    const html = readFileSync(join(composition, 'index.html'), 'utf8');
    assert.ok(!html.includes('PrivateVideoNotes'));
    assert.match(html, /src="assets\/logo.svg"/);
    assert.equal(readFileSync(join(composition, 'assets/logo.svg'), 'utf8'), readFileSync('static' + BRAND_LOGO_SRC.split('?')[0], 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (composition) rmSync(composition, { recursive: true, force: true });
  }
});

// Preserve an actual engine output, in addition to the authored reference.
test('a fresh generated linear/quadratic lesson has private notes for every scene', () => {
  const lesson = JSON.parse(readFileSync('tests/fixtures/learning-generated-with-notes.json', 'utf8')).learning;
  assert.deepEqual(experienceProblems(lesson, { requirePresenterNotes: true }), []);
  assert.ok(lesson.scenes.every(scene => scene.presenterNotes));
  assert.ok(!JSON.stringify(publicExperience(lesson)).includes('presenterNotes'));
  assert.ok(lesson.scenes.some(scene => scene.visual === 'linear'));
  assert.ok(lesson.scenes.some(scene => scene.visual === 'quadratic'));
});
