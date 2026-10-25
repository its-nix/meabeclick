// The design tokens promise certain contrast ratios, and the site is used
// by parents on phones in daylight and by 13-year-olds, so those promises
// are functional requirements (PRODUCT.md, "Accessibility & Inclusion").
//
// This reads tokens.css and checks the numbers themselves, so a future
// "let's warm the orange up a bit" cannot quietly drop the peach accent's
// text variant under WCAG AA again — which is exactly how #fa8231 ended up
// as body text at 2.5:1 on the live site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const css = readFileSync(join(ROOT, 'src/lib/styles/tokens.css'), 'utf8');

function source(path) {
  return readFileSync(join(ROOT, path), 'utf8');
}

/** The hex value a token is set to in :root, or undefined if absent. */
function token(name) {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  return m?.[1];
}

/** WCAG 2.1 relative luminance of a #rrggbb colour. */
function luminance(hex) {
  const chan = (i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(1) + 0.7152 * chan(3) + 0.0722 * chan(5);
}

/** WCAG 2.1 contrast ratio between two #rrggbb colours. */
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `fg` at `alpha` composited over opaque `bg`, as #rrggbb. */
function over(fg, alpha, bg) {
  const mix = (i) => Math.round(
    alpha * parseInt(fg.slice(i, i + 2), 16) + (1 - alpha) * parseInt(bg.slice(i, i + 2), 16),
  );
  return '#' + [1, 3, 5].map(i => mix(i).toString(16).padStart(2, '0')).join('');
}

const AA_TEXT = 4.5;
const AA_UI = 3;

test('the peach accent has a strong variant for text, borders and focus rings', () => {
  assert.ok(token('accent2-strong'), '--accent2-strong is missing from tokens.css');
});

test('the strong peach clears AA as small text on every light ground it sits on', () => {
  const strong = token('accent2-strong');
  const peach = token('accent2');
  const grounds = {
    'white (cards)': token('bg-card'),
    'page background': token('bg-base'),
    'blue surface': token('bg-surface'),
    // --accent2-dim is the peach at 10% over whatever is beneath it. The
    // landing page's section labels put that wash on the blue surface,
    // which is the darkest ground any orange text actually sits on — the
    // Playwright audit found it at 4.37:1 with a token that cleared every
    // other ground here.
    'peach wash on page background': over(peach, 0.10, token('bg-base')),
    'peach wash on blue surface': over(peach, 0.10, token('bg-surface')),
  };
  for (const [name, ground] of Object.entries(grounds)) {
    const ratio = contrast(strong, ground);
    assert.ok(ratio >= AA_TEXT, `${strong} on ${name} ${ground} is ${ratio.toFixed(2)}:1, needs ${AA_TEXT}:1`);
  }
});

test('the strong peach is a visible boundary against white', () => {
  const ratio = contrast(token('accent2-strong'), token('bg-card'));
  assert.ok(ratio >= AA_UI, `border/focus contrast is ${ratio.toFixed(2)}:1, needs ${AA_UI}:1`);
});

test('button text on the peach fill still clears AA', () => {
  const ratio = contrast(token('btn-text'), token('accent2'));
  assert.ok(ratio >= AA_TEXT, `--btn-text on --accent2 is ${ratio.toFixed(2)}:1, needs ${AA_TEXT}:1`);
});

test('the primary accent clears AA as text on its intended light grounds', () => {
  const accent = token('accent');
  const grounds = {
    'white (cards)': token('bg-card'),
    'page background': token('bg-base'),
    'blue surface': token('bg-surface'),
  };
  for (const [name, ground] of Object.entries(grounds)) {
    const ratio = contrast(accent, ground);
    assert.ok(ratio >= AA_TEXT, `--accent ${accent} on ${name} ${ground} is ${ratio.toFixed(2)}:1, needs ${AA_TEXT}:1`);
  }
});

test('the deep primary clears AA as small text on primary washes', () => {
  const accent = token('accent');
  const deep = token('accent-deep');
  const washes = {
    'primary wash on white': over(accent, 0.08, token('bg-card')),
    'primary wash on page background': over(accent, 0.08, token('bg-base')),
    'primary wash on blue surface': over(accent, 0.08, token('bg-surface')),
  };
  for (const [name, ground] of Object.entries(washes)) {
    const ratio = contrast(deep, ground);
    assert.ok(ratio >= AA_TEXT, `--accent-deep ${deep} on ${name} ${ground} is ${ratio.toFixed(2)}:1, needs ${AA_TEXT}:1`);
  }
});

test('every small primary-on-wash role is bound to an AA-safe text token and composite ground', () => {
  const roles = [
    ['landing hero badge', 'src/routes/+page.svelte', String.raw`\.hero-badge`, String.raw`\.hero-badge`, 'hero radial wash'],
    ['header sidebar hover', 'src/lib/components/Header.svelte', String.raw`\.sidebar-btn:hover`, String.raw`\.sidebar-btn:hover`, 'white (sidebar)'],
    ['plan structure active item', 'src/lib/components/plan/PlanTree.svelte', String.raw`\.menu-item\.active`, String.raw`\.menu-item\.active`, 'white (sheet)'],
    ['plan status active button', 'src/lib/components/plan/SkillSheet.svelte', String.raw`\.status-btn\.active`, String.raw`\.status-btn\.active`, 'white (sheet)'],
    ['error-hunt step number', 'src/lib/games/ErrorHunt.svelte', String.raw`\.step-num`, String.raw`\.step-num`, 'white (step)'],
    ['game goal badge', 'src/lib/games/GameShell.svelte', String.raw`\.goal`, String.raw`\.goal`, 'page background'],
    ['sequence step number', 'src/lib/games/Sequence.svelte', String.raw`\.num`, String.raw`\.num`, 'white (step)'],
    ['table-game header', 'src/lib/games/Table.svelte', String.raw`th`, String.raw`th`, 'white (table)'],
    ['game error code', 'src/lib/styles/games.css', String.raw`\.msg code`, String.raw`\.msg code`, 'page background'],
    ['dashboard outline button', 'src/routes/app/dashboard/+page.svelte', String.raw`\.btn-outline`, String.raw`\.btn-outline`, 'page background'],
    ['dashboard lesson link', 'src/routes/app/dashboard/+page.svelte', String.raw`\.lsn-links a`, String.raw`\.lsn-links a`, 'white (lesson card)'],
    ['dashboard payments header', 'src/routes/app/dashboard/+page.svelte', String.raw`\.payments-table th`, String.raw`\.payments-table th`, 'white (student card)'],
    ['dashboard next-lesson label', 'src/routes/app/dashboard/+page.svelte', String.raw`\.nl-label`, String.raw`\.next-lesson-box`, 'white (student card)'],
    ['games URL', 'src/routes/app/games/+page.svelte', String.raw`\.url`, String.raw`\.url`, 'white (game card)'],
    ['library working chip', 'src/routes/app/library/+page.svelte', String.raw`\.chip\.working`, String.raw`\.chip\.working`, 'white (topic card)'],
    ['marketing active chip', 'src/routes/app/marketing/+page.svelte', String.raw`\.chip\.active`, String.raw`\.chip\.active`, 'page background'],
    ['parent next-lesson contact', 'src/routes/app/parent/+page.svelte', String.raw`\.nl-contact`, String.raw`\.next-lesson-box`, 'page background'],
    ['parent table header', 'src/routes/app/parent/+page.svelte', String.raw`\.data-table th`, String.raw`\.data-table thead`, 'white (table)'],
    ['parent lesson pill', 'src/routes/app/parent/+page.svelte', String.raw`\.pill`, String.raw`\.pill`, 'white (table)'],
    ['parent seen tag', 'src/routes/app/parent/+page.svelte', String.raw`\.seen-tag`, String.raw`\.seen-tag`, 'white (progress card)'],
    ['plan filter active chip', 'src/routes/app/plan/[code]/+page.svelte', String.raw`\.chip\.active`, String.raw`\.chip\.active`, 'page background'],
    ['booking selected-plan badge', 'src/routes/booking/+page.svelte', String.raw`\.selected-plan-badge`, String.raw`\.selected-plan-badge`, 'page background'],
    ['booking active who card', 'src/routes/booking/+page.svelte', String.raw`\.who-card\.active`, String.raw`\.who-card\.active`, 'white (booking sheet)'],
    ['booking fixed subject', 'src/routes/booking/+page.svelte', String.raw`\.fixed-subject`, String.raw`\.fixed-subject`, 'white (booking sheet)'],
  ];

  for (const [role, path, foregroundSelector, washSelector, groundName] of roles) {
    const roleSource = source(path);
    const foregroundBlock = roleSource.match(new RegExp(`${foregroundSelector}\\s*\\{([^}]*)\\}`, 's'))?.[1];
    assert.ok(foregroundBlock, `${role} foreground selector is not covered by the primary-on-wash role map`);
    const washBlock = roleSource.match(new RegExp(`${washSelector}\\s*\\{([^}]*)\\}`, 's'))?.[1];
    assert.ok(washBlock, `${role} wash selector is not covered by the primary-on-wash role map`);
    assert.match(washBlock, /background:\s*(?:linear-gradient\([^;]*?)?var\(--accent-dim\)/,
      `${role} no longer declares the mapped primary wash`);

    const foregroundToken = foregroundBlock.match(/(?:^|;)\s*color:\s*var\(--([^)]+)\)/)?.[1];
    assert.ok(foregroundToken, `${role} does not use a token for its text colour`);
    const foreground = token(foregroundToken);
    assert.ok(foreground, `${role} uses missing token --${foregroundToken}`);

    const baseGround = groundName === 'hero radial wash'
      ? over(token('accent'), 0.12, token('bg-base'))
      : groundName.startsWith('white')
        ? token('bg-card')
        : token('bg-base');
    const compositeGround = over(token('accent'), 0.08, baseGround);
    const ratio = contrast(foreground, compositeGround);
    assert.ok(ratio >= AA_TEXT,
      `${role}: --${foregroundToken} ${foreground} on ${groundName} ${compositeGround} is ${ratio.toFixed(2)}:1, needs ${AA_TEXT}:1`);
  }
});

test('white text clears AA on every primary button, hover and gradient fill role', () => {
  const booking = source('src/routes/booking/+page.svelte');
  const portal = source('src/routes/portal/+page.svelte');
  const parent = source('src/routes/app/parent/+page.svelte');
  const roles = [
    ['booking submit', booking, /\.btn-primary\s*\{[^}]*background:\s*var\(--([^)]+)\)[^}]*color:\s*#fff/s],
    ['booking submit hover', booking, /\.btn-primary:hover\s*\{[^}]*background:\s*var\(--([^)]+)\)/s],
    ['booking handoff', booking, /\.handoff-primary\s*\{[^}]*background:\s*var\(--([^)]+)\)[^}]*color:\s*#fff/s],
    ['booking handoff hover', booking, /\.handoff-primary:hover\s*\{[^}]*background:\s*var\(--([^)]+)\)/s],
    ['portal submit', portal, /\.go\s*\{[^}]*background:\s*var\(--([^)]+)\)[^}]*color:\s*#fff/s],
    ['portal submit hover', portal, /\.go:hover\s*\{[^}]*background:\s*var\(--([^)]+)\)/s],
    ['parent booking CTA', parent, /\.fam-book\s*\{[^}]*background:\s*var\(--([^)]+)\)[^}]*color:\s*#fff/s],
    ['parent booking CTA hover', parent, /\.fam-book:hover\s*\{[^}]*background:\s*var\(--([^)]+)\)/s],
    ['parent student-header gradient start', parent, /\.student-header\s*\{[^}]*linear-gradient\([^,]+,\s*var\(--([^)]+)\)\s+0%/s],
    ['parent student-header gradient end', parent, /\.student-header\s*\{[^}]*linear-gradient\([^,]+,\s*var\(--[^)]+\)\s+0%,\s*var\(--([^)]+)\)\s+100%/s],
  ];

  for (const [role, roleSource, pattern] of roles) {
    const fill = roleSource.match(pattern)?.[1];
    assert.ok(fill, `${role} primary fill is not covered by the role map`);
    const fillColour = token(fill);
    assert.ok(fillColour, `${role} uses missing token --${fill}`);
    const ratio = contrast(token('bg-card'), fillColour);
    assert.ok(ratio >= AA_TEXT,
      `${role}: white on --${fill} ${fillColour} is ${ratio.toFixed(2)}:1, needs ${AA_TEXT}:1`);
  }
});

test('small parent-header text stays opaque and clears AA across the gradient and badge wash', () => {
  const parent = source('src/routes/app/parent/+page.svelte');
  assert.ok(/\.sh-meta\s*\{[^}]*color:\s*#fff/s.test(parent),
    'small student-header metadata must use opaque white');
  assert.ok(/\.sh-badge\s*\{[^}]*color:\s*#fff/s.test(parent),
    'small student-header badges must use opaque white');

  for (const fill of ['accent', 'accent-deep']) {
    const fillColour = token(fill);
    const directRatio = contrast(token('bg-card'), fillColour);
    assert.ok(directRatio >= AA_TEXT,
      `small white text on gradient --${fill} is ${directRatio.toFixed(2)}:1, needs ${AA_TEXT}:1`);

    const badgeGround = over(token('bg-card'), 0.08, fillColour);
    const badgeRatio = contrast(token('bg-card'), badgeGround);
    assert.ok(badgeRatio >= AA_TEXT,
      `small white badge text over --${fill} wash is ${badgeRatio.toFixed(2)}:1, needs ${AA_TEXT}:1`);
  }
});

test('strong muted text clears AA on the blue surface', () => {
  const ratio = contrast(token('text-muted-strong'), token('bg-surface'));
  assert.ok(ratio >= AA_TEXT, `--text-muted-strong on --bg-surface is ${ratio.toFixed(2)}:1, needs ${AA_TEXT}:1`);
});

test('the primary accent is a visible boundary against white', () => {
  const ratio = contrast(token('accent'), token('bg-card'));
  assert.ok(ratio >= AA_UI, `accent boundary contrast is ${ratio.toFixed(2)}:1, needs ${AA_UI}:1`);
});

test('the peach fill itself is documented as unfit for text', () => {
  // Not a contrast assertion — a guard that the token comment still tells
  // the next reader why --accent2-strong exists, so the rule travels with
  // the value.
  assert.match(css, /--accent2-strong:[^\n]*\n/, 'token present');
  const block = css.slice(css.indexOf('Secondary accent'), css.indexOf('--accent2-strong'));
  assert.match(block, /text/i, 'the comment above --accent2-strong should say it is the text/border variant');
});

/* WhatsApp green (Todoist 6hfrX4MVcfMjPP6q). The brand's own #25d366 is
   1.98:1 on white — fills only, like the peach. The strong green is what
   text, borders and focus rings use. */
test('the strong WhatsApp green clears AA as text on every ground its buttons sit on', () => {
  const strong = token('whatsapp-strong');
  const green = token('whatsapp');
  assert.ok(strong && green, '--whatsapp and --whatsapp-strong are in tokens.css');
  const grounds = {
    'white (cards)': token('bg-card'),
    'page background': token('bg-base'),
    'blue surface': token('bg-surface'),
    'green wash on white (hover)': over(green, 0.12, token('bg-card')),
    'green wash on blue surface': over(green, 0.12, token('bg-surface')),
  };
  for (const [name, ground] of Object.entries(grounds)) {
    const ratio = contrast(strong, ground);
    assert.ok(ratio >= AA_TEXT, `${strong} on ${name} ${ground} is ${ratio.toFixed(2)}:1, needs ${AA_TEXT}:1`);
  }
});
