import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const cli = resolve('scripts/pr-qa/select.mjs');
function fixture(run) {
  const dir = mkdtempSync(join(tmpdir(), 'qa-git-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir }).toString().trim();
  const write = (path, text) => { const target = join(dir, path); mkdirSync(resolve(target, '..'), { recursive: true }); writeFileSync(target, text); };
  try {
    git('init', '-q'); git('config', 'user.name', 'Synthetic QA'); git('config', 'user.email', 'qa@example.test'); git('config', 'commit.gpgsign', 'false');
    write('src/routes/app/parent/+page.svelte', '<h1>Parent</h1>');
    git('add', '.'); git('commit', '-qm', 'base');
    run({ dir, git, write, base: git('rev-parse', 'HEAD') });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const select = (dir, base) => {
  execFileSync(process.execPath, [cli, '--base', base, '--out', join(dir, 'report')], { cwd: dir, env: { ...process.env, PR_QA_EVENT: 'pull_request' } });
  return JSON.parse(readFileSync(join(dir, 'report/impact.json')));
};
test('the CLI reads a real NUL-delimited git diff and reports the tested commit', () => fixture(({ dir, git, write, base }) => {
  write('src/routes/app/parent/+page.svelte', '<h1>Updated</h1>'); git('add', '.'); git('commit', '-qm', 'change');
  const plan = select(dir, base);
  assert.equal(plan.mode, 'selected');
  assert.equal(plan.headSha, git('rev-parse', 'HEAD'));
  assert.deepEqual(plan.routes, ['/app/parent']);
  assert.equal(plan.engine, 'deterministic-playwright');
}));
test('missing base history runs the full suite instead of passing an empty selection', () => fixture(({ dir }) => {
  assert.equal(select(dir, '0'.repeat(40)).mode, 'full');
}));
test('a deleted covered route remains in the impact report', () => fixture(({ dir, git, base }) => {
  git('rm', 'src/routes/app/parent/+page.svelte'); git('commit', '-qm', 'remove page');
  assert.deepEqual(select(dir, base).routes, ['/app/parent']);
}));
