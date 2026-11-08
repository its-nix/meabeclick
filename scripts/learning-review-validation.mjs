import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REVIEW_CASES } from './learning-review-cases.mjs';

export const LEGACY_SOURCE_FILES = ['src/lib/server/lesson/prep.ts','src/lib/server/lesson/structured-output.ts','src/lib/learning/schema.ts','src/lib/learning/model.ts','src/lib/server/learning-render.ts','src/lib/learning/runtime.ts','src/lib/learning/visual.ts','src/lib/learning/styles.ts','src/lib/brand.ts','games/registry.json','scripts/learning-review-cases.mjs'];
export const PRE_QUALITY_SOURCE_FILES=[...LEGACY_SOURCE_FILES,'src/lib/server/lesson-games.ts','src/lib/server/lesson/prompt.ts','src/lib/server/lesson/spawn.ts','src/lib/server/lesson/engine.ts','src/lib/server/lesson/engine-health.ts','src/lib/server/lesson/registry.ts','src/lib/learning/math.ts','src/lib/bidi.ts','src/lib/plans.ts','package-lock.json','scripts/generate-learning-review.mjs','scripts/learning-review-validation.mjs'];
export const PRE_GRAPH_SOURCE_FILES=[...PRE_QUALITY_SOURCE_FILES,'src/lib/server/lesson/quality.ts','src/lib/server/learning-store.ts','src/lib/server/lesson/structured-validation.ts','src/lib/server/lesson/game-generation.ts','src/lib/games/adaptive.ts','scripts/render-learning-video.mjs','src/lib/server/presenter-notes.ts','src/lib/games/engine.ts','src/lib/games/GameShell.svelte','src/lib/games/Quiz.svelte','src/lib/games/ErrorHunt.svelte','src/lib/games/TwoTruths.svelte','src/lib/games/GraphMatch.svelte','src/lib/games/NumberLine.svelte','src/lib/games/SpeedDrill.svelte'];
export const PRE_CONTROLS_SOURCE_FILES=[...PRE_GRAPH_SOURCE_FILES,'src/lib/games/graph-match-plot.ts'];
export const SOURCE_FILES=[...PRE_CONTROLS_SOURCE_FILES,'src/lib/learning/controls.ts'];
export async function sourceFingerprint() {
  const hash=createHash('sha256');
  for (const path of SOURCE_FILES) hash.update(path).update(await readFile(path));
  return hash.digest('hex');
}
export function validateManifest(manifest) {
  if(manifest.version!==1 || manifest.syntheticOnly!==true || manifest.approval!=='needs-human-review' || !Array.isArray(manifest.cases) || JSON.stringify(manifest.cases.map(c=>c.brief))!==JSON.stringify(REVIEW_CASES)) throw Error('Invalid synthetic review manifest or briefs');
  if(!manifest.config || !['model','effort','cli','sourceFingerprint'].every(key=>typeof manifest.config[key]==='string'&&manifest.config[key]))throw Error('Missing generation provenance');
  if(manifest.cases.some(c=>!['pending','generating','failed','ready'].includes(c.status)))throw Error('Unknown review status');
}
export async function readVerifiedPlan(out, item) {
  const content=await readFile(join(out,item.brief.id+'.json'),'utf8');
  if(createHash('sha256').update(content).digest('hex')!==item.planSha256)throw Error(`Review artifact checksum mismatch: ${item.brief.id}`);
  return JSON.parse(content);
}
/** Historical corpora have no critique. New evidence must assess the exact final candidate. */
export async function readVerifiedQualityReport(out, item, plan, required = false) {
  if (!item.qualitySha256) {
    if (required) throw Error(`Missing generation quality evidence: ${item.brief.id}`);
    return null;
  }
  const content = await readFile(join(out, item.brief.id+'.quality.json'),'utf8');
  if (createHash('sha256').update(content).digest('hex') !== item.qualitySha256) throw Error(`Review quality checksum mismatch: ${item.brief.id}`);
  const report = JSON.parse(content), last = report?.attempts?.at(-1);
  if (report?.version !== 1 || report.scope !== 'generation-snapshot' || report.status !== 'passed'
    || !Array.isArray(report.attempts) || !report.attempts.length || report.attempts.length > 2
    || last?.critique !== 'passed' || !Array.isArray(last.issues) || last.issues.length) throw Error(`Review quality evidence is not passed: ${item.brief.id}`);
  if (last.candidateHash !== createHash('sha256').update(JSON.stringify(plan)).digest('hex')) throw Error(`Review quality candidate mismatch: ${item.brief.id}`);
  return report;
}
// Import only after callers have set isolated DB_PATH/DATA_DIR.
export async function validatePlan(plan) {
  const {validateLesson,TEMPLATE_FILES,toTemplateShape}=await import('../src/lib/server/lesson/prep.ts');
  const {experienceProblems,renderLearningDocument}=await import('../src/lib/server/learning-render.ts');
  const {validateLessonGame}=await import('../src/lib/server/lesson-games.ts');
  const problems=[...validateLesson(plan),...experienceProblems(plan.learning,{requirePresenterNotes:true})];
  if(problems.length)throw Error(problems.join('; '));
  renderLearningDocument(plan.learning,{demo:true});
  for(const [key,body] of Object.entries(plan.games))if(body!=null)validateLessonGame(TEMPLATE_FILES[key],toTemplateShape(key,body));
}
