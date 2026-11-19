// Every button-like control uses the single --radius-pill token. A rule whose
// selector names a button, link-button, chip, tab or icon control must not
// hard-code a radius; it points at the token (or a deliberate card radius is
// proven by not matching the button-like pattern).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { RADIUS_PILL } from '../../src/lib/brand.ts';

const root = join(import.meta.dirname, '../../src');
const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(svelte|css|ts)$/.test(n)) files.push(p);
  }
})(root);

const BUTTONISH = /(^|[\s,>+~(])(button|summary|\.(?:btn|button|chip|cta|pill|day-tab|slot|toggle|hamburger|icon-btn)(?![\w-])|\.[\w-]*(?:-btn|-cta|-button|-close|-trigger|-action|-submit|-retry)(?![\w-])|\.(?:act|wa|play|nav-item|menu-item|sidebar-btn|primary|secondary))/;
// Cards/inputs that merely contain a button-ish word are listed here on purpose.
const NOT_BUTTONS = [/input/, /textarea/, /select/, /\.parent-brief button/, /focus-visible/, /\.status-editor-wrap/, / span$/];

test('tokens.css and brand.ts agree on the pill radius', () => {
  const css = readFileSync(join(root, 'lib/styles/tokens.css'), 'utf8');
  assert.match(css, new RegExp(`--radius-pill:\\s*${RADIUS_PILL}`));
});

test('no button-like rule hard-codes a border-radius', () => {
  const bad = [];
  for (const f of files) {
    const t = readFileSync(f, 'utf8');
    for (const m of t.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const radius = m[2].match(/border-radius\s*:\s*([^;}]+)/);
      if (!radius) continue;
      const sel = m[1].trim().replace(/\s+/g, ' ').split('*/').pop().replace(/^.*<style>\s*/, '');
      if (!BUTTONISH.test(sel) || NOT_BUTTONS.some((r) => r.test(sel))) continue;
      const v = radius[1].trim();
      if (v !== 'var(--radius-pill)' && !/^(0|inherit|50%)$/.test(v) || /9{3,4}px/.test(v)) {
        bad.push(`${f.replace(root, 'src')}: ${sel} -> ${v}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('no stray 999px radius survives outside the token', () => {
  const bad = files.filter((f) => /border-radius\s*:\s*\d{3,4}px/.test(readFileSync(f, 'utf8')) && !f.endsWith('brand.ts'));
  assert.deepEqual(bad, []);
});
