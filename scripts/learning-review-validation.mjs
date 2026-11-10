import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REVIEW_CASES } from './learning-review-cases.mjs';
import { REVIEW_V2_CASES } from './learning-review-v2-cases.mjs';

export const LEGACY_SOURCE_FILES = ['src/lib/server/lesson/prep.ts','src/lib/server/lesson/structured-output.ts','src/lib/learning/schema.ts','src/lib/learning/model.ts','src/lib/server/learning-render.ts','src/lib/learning/runtime.ts','src/lib/learning/visual.ts','src/lib/learning/styles.ts','src/lib/brand.ts','games/registry.json','scripts/learning-review-cases.mjs'];
export const PRE_V2_SOURCE_FILES=[...LEGACY_SOURCE_FILES,'src/lib/server/lesson-games.ts','src/lib/server/lesson/prompt.ts','src/lib/server/lesson/spawn.ts','src/lib/server/lesson/engine.ts','src/lib/server/lesson/engine-health.ts','src/lib/server/lesson/registry.ts','src/lib/learning/math.ts','src/lib/bidi.ts','src/lib/plans.ts','package-lock.json','scripts/generate-learning-review.mjs','scripts/learning-review-validation.mjs'];
export const SOURCE_FILES=[...PRE_V2_SOURCE_FILES,'src/lib/learning/teaching.ts','src/lib/learning/teaching-schema.ts','src/lib/learning/teaching-rules.ts','src/lib/server/teaching-display.ts','src/lib/server/lesson/teaching-context.ts','src/lib/server/lesson/official-questions.ts','scripts/learning-review-v2-cases.mjs','src/lib/server/assigned-teaching.ts','src/lib/server/presenter-notes.ts','scripts/render-learning-video.mjs','src/lib/server/lesson/homework.ts','src/lib/server/lesson/taught-bundle.ts','src/lib/server/reports/teaching-coverage.ts','src/lib/games/GraphMatch.svelte','src/lib/games/graph-plot.ts','src/lib/games/diagrams.ts','src/lib/games/Labelling.svelte','src/routes/app/play/[template]/+page.svelte','scripts/package-learning-review.mjs'];
export async function sourceFingerprint() {
  const hash=createHash('sha256');
  for (const path of SOURCE_FILES) hash.update(path).update(await readFile(path));
  return hash.digest('hex');
}
export function validateManifest(manifest) {
  if(manifest.config?.generationVersion!==undefined&&![1,2].includes(manifest.config.generationVersion))throw Error('Unsupported generator version');
  if(manifest.config?.generationVersion===2&&(!manifest.config.ruleVersion||manifest.config.schemaVersion!=='teaching-v2'))throw Error('Missing candidate teaching provenance');
  if(manifest.version!==1 || manifest.syntheticOnly!==true || manifest.approval!=='needs-human-review' || !Array.isArray(manifest.cases) || JSON.stringify(manifest.cases.map(c=>c.brief))!==JSON.stringify(manifest.config?.generationVersion===2?REVIEW_V2_CASES:REVIEW_CASES)) throw Error('Invalid synthetic review manifest or briefs');
  if(!manifest.config || !['model','effort','cli','sourceFingerprint'].every(key=>typeof manifest.config[key]==='string'&&manifest.config[key]))throw Error('Missing generation provenance');
  if(manifest.cases.some(c=>!['pending','generating','failed','ready'].includes(c.status)))throw Error('Unknown review status');
}
export async function readVerifiedPlan(out, item) {
  const content=await readFile(join(out,item.brief.id+'.json'),'utf8');
  if(createHash('sha256').update(content).digest('hex')!==item.planSha256)throw Error(`Review artifact checksum mismatch: ${item.brief.id}`);
  return JSON.parse(content);
}
// Import only after callers have set isolated DB_PATH/DATA_DIR.
export async function validatePlan(plan,version=1) {
  if(version===2&&!plan.teaching)throw Error('Candidate is missing the v2 teaching contract');
  const {validateLesson,TEMPLATE_FILES,toTemplateShape}=await import('../src/lib/server/lesson/prep.ts');
  const {experienceProblems,renderLearningDocument}=await import('../src/lib/server/learning-render.ts');
  const {validateLessonGame}=await import('../src/lib/server/lesson-games.ts');
  const problems=[...validateLesson(plan),...experienceProblems(plan.learning,{requirePresenterNotes:true})];
  if(problems.length)throw Error(problems.join('; '));
  renderLearningDocument(plan.learning,{demo:true});
  if(plan.teaching){const {homeworkExperience}=await import('../src/lib/server/teaching-display.ts');renderLearningDocument(homeworkExperience(plan),{demo:true,variant:'homework'});}
  for(const [key,body] of Object.entries(plan.games))if(body!=null)validateLessonGame(TEMPLATE_FILES[key],toTemplateShape(key,body));
}
