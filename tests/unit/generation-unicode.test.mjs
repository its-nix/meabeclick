import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'generation-unicode-'));
process.env.DB_PATH = join(directory, 'results.db');
const { spawnAgent } = await import('../../src/lib/server/lesson/spawn.ts');
after(() => rm(directory, { recursive: true, force: true }));

const text = 'שברים: חצי ועוד שליש — 𝑥';
function splitOutput(stream, exitCode) {
  return `const bytes=Buffer.from(${JSON.stringify(text)});process.${stream}.write(bytes.subarray(0,1));setTimeout(()=>{process.${stream}.write(bytes.subarray(1));process.exitCode=${exitCode}},30);`;
}

test('generation captures Hebrew and mathematical Unicode split between stdout chunks', async () => {
  const output = await spawnAgent(process.execPath, ['-e', splitOutput('stdout', 0)], '', directory, {
    label: 'fixture', timeoutMs: 2000, collectStdout: true,
  });
  assert.equal(output, text);
});

test('generation diagnostics preserve Hebrew split between stderr chunks', async () => {
  await assert.rejects(spawnAgent(process.execPath, ['-e', splitOutput('stderr', 1)], '', directory, {
    label: 'fixture', timeoutMs: 2000,
  }), error => {
    assert.equal(error.kind, 'engine-failed');
    assert.equal(error.detail, `stderr: ${text}`);
    return true;
  });
});
