import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('the recovery email states the real 15-minute single-use lifetime', () => {
  const email = readFileSync('src/lib/server/email.ts', 'utf8');
  const portalEmail = email.slice(email.indexOf('export async function sendPortalLinkEmail'));

  assert.match(portalEmail, /15 דקות/);
  assert.match(portalEmail, /כניסה אחת/);
  assert.doesNotMatch(portalEmail, /שבועיים/);
});

test('the entry screen keeps a retry action only for a pre-consumption network failure', () => {
  const entry = readFileSync('src/routes/enter/+page.svelte', 'utf8');

  assert.match(entry, /errorKind === 'network'/);
  assert.match(entry, />ניסיון נוסף</);
  assert.match(entry, /errorKind = 'invalid'/);
  assert.match(entry, /errorKind = 'network'/);
  assert.doesNotMatch(entry, /error = body\.error/);
  assert.match(entry, /<BrandMark height=\{30\} href=\{null\} label=\{null\} \/>/);
});

test('admin access actions name one scope and provide safe single-use handoff guidance', () => {
  const dashboard = readFileSync('src/routes/app/dashboard/+page.svelte', 'utf8');

  assert.match(dashboard, /כניסה חדשה למשפחה של/);
  assert.match(dashboard, /כניסה חדשה ל.*בלבד/);
  assert.match(dashboard, /account_id:\s*number/);
  assert.match(dashboard, /accessKey\(account\.accountId,\s*'account'\)/);
  assert.match(dashboard, /JSON\.stringify\(\{ scope \}\)/);
  assert.match(dashboard, /שליחה בוואטסאפ/);
  assert.match(dashboard, /הצגת הקישור/);
  assert.match(dashboard, /role=\{t\.kind === 'error' \? 'alert' : 'status'\}/);
  assert.match(dashboard, /15 דקות ולכניסה אחת/);
  assert.match(dashboard, /role="status"/);
  assert.match(dashboard, /\.copy-btn\s*\{[^}]*min-height:\s*44px/s);
  assert.match(dashboard, /\.toast-close\s*\{[^}]*min-height:\s*44px[^}]*min-width:\s*44px/s);
  assert.match(dashboard, /<b dir="ltr">\{links\[studentKey\]\.joinCode\}<\/b>/);
  assert.match(dashboard, /\.rs-join b\s*\{[^}]*unicode-bidi:\s*isolate/s);
  assert.match(dashboard, /@media \(max-width: 600px\)[\s\S]*\.codes-table\s*\{[^}]*min-width:\s*0/s);
  assert.match(dashboard, /@media \(max-width: 600px\)[\s\S]*\.codes-table\s*\{[^}]*inline-size:\s*100%[^}]*max-inline-size:\s*100%/s);
});

test('admin access groups one account action above its per-student actions', () => {
  const dashboard = readFileSync('src/routes/app/dashboard/+page.svelte', 'utf8');

  assert.match(dashboard, /const accessAccounts = \$derived\.by/);
  assert.match(dashboard, /new Map<number, AccessAccount>/);
  assert.match(
    dashboard,
    /\{#each accessAccounts as account \(account\.accountId\)\}[\s\S]*כניסה למשפחה[\s\S]*\{#each account\.students as rs \(rs\.code\)\}[\s\S]*כניסה לתלמיד\/ה בלבד[\s\S]*\{\/each\}[\s\S]*\{\/each\}/,
  );
  assert.match(dashboard, /בחשבון של \{account\.accountName\}/);
});

test('portal pending feedback and narrow reflow remain explicit', () => {
  const portal = readFileSync('src/routes/portal/+page.svelte', 'utf8');

  assert.match(portal, /linkState === 'sending'.*role="status"/s);
  assert.match(portal, /\.brand\s*\{[^}]*min-height:\s*44px/s);
  assert.match(portal, /\.tab\s*\{[^}]*min-width:\s*0/s);
  assert.match(portal, /\.links a\s*\{[^}]*min-height:\s*44px/s);
});