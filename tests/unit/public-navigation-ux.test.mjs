import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('the public menu is a native modal dialog with focus return and a closed hidden state', () => {
  const header = readFileSync('src/lib/components/Header.svelte', 'utf8');
  assert.match(header, /<dialog[^>]*bind:this=\{sidebar\}/);
  assert.match(header, /sidebar\?\.showModal\(\)/);
  assert.match(header, /onclose=\{[^]*?menuButton\?\.focus\(\)/);
  assert.match(header, /aria-expanded=\{sidebarOpen\}/);
  assert.match(header, /\.sidebar:not\(\[open\]\) \{ display: none/);
});
test('carousel pause persists independently of hover focus and manual-scroll grace', () => {
  const carousel = readFileSync('src/lib/components/AutoCarousel.svelte', 'utf8');
  assert.match(carousel, /let paused = \$state\(false\)/);
  assert.match(carousel, /!reduceMotion.matches &&\s*!paused &&/);
  assert.match(carousel, /aria-pressed=\{paused\}/);
  assert.match(carousel, /onclick=\{\(\) => \(paused = !paused\)\}/);
  assert.match(carousel, /השהיית תנועה/);
  assert.match(carousel, /חידוש תנועה/);
});
