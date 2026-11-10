#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { selectImpact } from './impact.mjs';

const git = (...args) => execFileSync('git', args, { maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
const sourcePath = path => /\.(?:[cm]?[jt]s|svelte|css)$/.test(path) && /^(?:src|tests|scripts)\//.test(path);
function tree(ref) {
  const paths = git('ls-tree', '-rz', '--name-only', ref).toString().split('\0').filter(sourcePath);
  if (paths.some(path => /[\r\n]/.test(path))) throw new Error('unsupported source filename');
  const output = execFileSync('git', ['cat-file', '--batch'], { input: paths.map(path => `${ref}:${path}\n`).join(''), maxBuffer: 64 * 1024 * 1024 });
  const files = {};
  let offset = 0;
  for (const path of paths) {
    const end = output.indexOf(10, offset);
    const match = output.subarray(offset, end).toString().match(/^[a-f0-9]+ blob (\d+)$/);
    if (!match) throw new Error('cannot read source snapshot');
    const length = Number(match[1]);
    files[path] = output.subarray(end + 1, end + 1 + length).toString();
    offset = end + 1 + length + 1;
  }
  return files;
}
function changedPaths(base, head) {
  const fields = git('diff', '--name-status', '-z', '--find-renames', `${base}...${head}`).toString().split('\0');
  const files = [];
  for (let i = 0; i < fields.length && fields[i];) {
    const status = fields[i++];
    files.push(fields[i++]);
    if (/^[RC]/.test(status)) files.push(fields[i++]);
  }
  if (files.some(path => typeof path !== 'string' || !path)) throw new Error('invalid git diff');
  return files;
}
const args = process.argv.slice(2);
const value = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
const directory = resolve(value('--out') ?? process.env.PR_QA_DIR ?? '.qa-results');
const headSha = git('rev-parse', 'HEAD').toString().trim();
const baseSha = value('--base') ?? process.env.PR_QA_BASE_SHA ?? null;
const full = args.includes('--all') || process.env.PR_QA_EVENT && process.env.PR_QA_EVENT !== 'pull_request';
let plan;
try {
  if (full) plan = selectImpact({ changedFiles: [], forceAll: true });
  else {
    if (!/^[a-f0-9]{40}$/.test(baseSha ?? '')) throw new Error('missing/invalid PR base SHA');
    plan = selectImpact({ changedFiles: changedPaths(baseSha, headSha), baseFiles: tree(baseSha), headFiles: tree(headSha) });
  }
} catch {
  plan = selectImpact({ changedFiles: [], forceAll: true });
  plan.reasons = ['diff or source graph unavailable; fail closed to full journey coverage'];
}
plan = { ...plan, headSha, baseSha, engine: 'deterministic-playwright', dirty: !!git('status', '--porcelain').toString().trim() };
mkdirSync(directory, { recursive: true });
writeFileSync(join(directory, 'impact.json'), JSON.stringify(plan, null, 2) + '\n');
if (process.env.GITHUB_OUTPUT) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_OUTPUT, `run_ui=${plan.mode !== 'skip'}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `full=${plan.mode === 'full'}\n`);
  for (const id of ['invitations', 'learning', 'workspace', 'tutor-create']) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${id.replaceAll('-', '_')}=${plan.journeys.includes(id)}\n`);
  }
}
console.log(JSON.stringify({ mode: plan.mode, headSha, changedFiles: plan.changedFiles, routes: plan.routes, journeys: plan.journeys, reasons: plan.reasons, unmappedRoutes: plan.unmappedRoutes }, null, 2));
if (plan.unmappedRoutes.length) process.exitCode = 1;
