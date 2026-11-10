import { readFileSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('`', '&#96;').replaceAll('|', '&#124;').replaceAll('\n', ' ');
function specs(suites = []) {
  return suites.flatMap(suite => [...suite.specs ?? [], ...specs(suite.suites)]);
}
export function buildReport(plan, results, { selectionOutcome, runOutcome, projects, supplemental = [] } = {}) {
  const executed = specs(results?.suites).flatMap(spec => spec.tests.map(test => ({
    journey: spec.title.split(':')[0], project: test.projectName,
    passed: test.expectedStatus === 'passed' && test.results.length === 1 && test.results[0].status === 'passed',
  })));
  let status = 'failed';
  if (selectionOutcome === 'success' && plan?.mode === 'skip' && !plan.unmappedRoutes?.length) status = 'skipped';
  else if (selectionOutcome === 'success' && runOutcome === 'success' && ['selected', 'full'].includes(plan?.mode) && plan?.journeys?.length
    && !plan.unmappedRoutes?.length && projects?.length && results?.stats
    && !results.errors?.length && !results.stats.unexpected && !results.stats.skipped && !results.stats.flaky
    && executed.every(test => test.passed)
    && supplemental.every(suite => !suite.required || suite.outcome === 'success')
    && plan.journeys.every(journey => projects.every(project => executed.some(test => test.journey === journey && test.project === project)))) status = 'passed';
  const list = values => values?.length ? values.map(value => `- ${escape(value)}`).join('\n') : '- None';
  const markdown = `## PR UI verification: ${status}\n\n`
    + `Engine: deterministic Playwright; no AI service or credentials.\n\n`
    + `Checkout: ${escape(plan?.headSha ?? 'unavailable')}${plan?.dirty ? ' (working tree contains local edits)' : ''}\n\n`
    + `Selection: ${escape(plan?.mode ?? 'unavailable')}; browser step: ${escape(runOutcome ?? 'not run')}.\n\n`
    + `${status === 'skipped' ? 'No runtime changes: browser verification explicitly skipped.' : `${executed.filter(test => test.passed).length}/${executed.length} browser scenarios passed. Missing, skipped, flaky or interrupted coverage fails this gate.`}\n\n`
    + `### Changed files\n\n${list(plan?.changedFiles)}\n\n### Affected routes\n\n${list(plan?.routes)}\n\n`
    + `### Selected journeys\n\n${list(plan?.journeys)}\n\n### Selection reasons\n\n${list(plan?.reasons)}\n\n`
    + `### Executed scenarios\n\n${list(executed.map(test => `${test.project} / ${test.journey}: ${test.passed ? 'passed' : 'failed'}`))}\n\n`
    + `### Supplemental browser checks\n\n${list(supplemental.filter(suite => suite.required).map(suite => `${suite.id}: ${suite.outcome ?? 'not run'}`))}\n\n`
    + `Download the pr-ui-verification artifact for the HTML report, screenshots and failure traces.\n`;
  return { status, executed, markdown };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = resolve(process.env.PR_QA_DIR ?? '.qa-results');
  const read = name => { try { return JSON.parse(readFileSync(join(directory, name), 'utf8')); } catch { return null; } };
  const plan = read('impact.json');
  const has = id => plan?.journeys?.includes(id);
  const report = buildReport(plan, read('results.json'), {
    selectionOutcome: process.env.QA_SELECTION_OUTCOME,
    runOutcome: process.env.QA_RUN_OUTCOME,
    projects: ['chromium-phone', 'chromium-desktop', ...(process.env.CI || process.env.QA_WEBKIT ? ['webkit-phone'] : [])],
    supplemental: process.env.CI ? [
      { id: 'learning', required: has('learning'), outcome: process.env.QA_LEARNING_OUTCOME },
      { id: 'learning-review', required: has('learning'), outcome: process.env.QA_REVIEW_OUTCOME },
      { id: 'tutor-workspace', required: has('workspace') || has('tutor-create'), outcome: process.env.QA_WORKSPACE_OUTCOME },
      { id: 'charts', required: has('workspace'), outcome: process.env.QA_CHARTS_OUTCOME },
      { id: 'google-onboarding', required: has('invitations'), outcome: process.env.QA_AUTH_OUTCOME },
      { id: 'changed-page-matrix', required: plan?.mode !== 'skip', outcome: process.env.QA_MATRIX_OUTCOME },
    ] : [],
  });
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'summary.md'), report.markdown);
  writeFileSync(join(directory, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report.markdown);
  console.log(report.markdown);
  if (report.status === 'failed') process.exitCode = 1;
}
