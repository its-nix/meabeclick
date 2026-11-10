import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
test('required build selects merge checkout impact against the PR base with full history', () => {
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /PR_QA_BASE_SHA: \$\{\{ github.event.pull_request.base.sha \}\}/);
  assert.match(workflow, /PR_QA_EVENT: \$\{\{ github.event_name \}\}/);
  assert.match(workflow, /id: pr_qa_select/);
  assert.match(workflow, /run: node scripts\/pr-qa\/select.mjs/);
});
test('browser checks block the existing build and preserve artifacts and summary on failure', () => {
  const gate = workflow.match(/- name: Verify affected user journeys[\s\S]*?(?=\n      - name:)/)?.[0] ?? '';
  assert.match(gate, /id: pr_qa_run/);
  assert.match(gate, /run: npm run test:qa/);
  assert.doesNotMatch(gate, /continue-on-error|pass-with-no-tests/);
  assert.match(workflow, /- name: Report PR UI verification\n        if: always\(\)/);
  assert.match(workflow, /- name: Save PR UI evidence\n        if: always\(\)/);
  assert.match(workflow, /playwright install --with-deps chromium webkit/);
});
test('visual pilot shares learning browser selection and reports its actual outcome', () => {
  const pilot = workflow.match(/- name: Check visual calibration pilot in Chromium[\s\S]*?(?=\n      - name:)/)?.[0] ?? '';
  assert.match(pilot, /id: qa_pilot/);
  assert.match(pilot, /if: steps.pr_qa_select.outputs.learning == 'true'/);
  assert.match(pilot, /run: npm run test:pilot:browser/);
  assert.match(workflow, /QA_PILOT_OUTCOME: \$\{\{ steps.qa_pilot.outcome \}\}/);
});
