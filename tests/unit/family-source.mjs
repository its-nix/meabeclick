import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The parent view is its page plus the family components it shares with the
 * self-learner's home. Source-level tests that ask "does the parent page do
 * X" read the whole of it, so moving markup into a shared component does not
 * quietly turn a guard into a test of nothing.
 */
const FAMILY = 'src/lib/components/family';
export function familyComponents(root = process.cwd()) {
  return readdirSync(join(root, FAMILY)).filter(f => f.endsWith('.svelte'))
    .map(f => readFileSync(join(root, FAMILY, f), 'utf8')).join('\n')
    + '\n' + readFileSync(join(root, 'src/lib/family-format.ts'), 'utf8');
}
export function parentSource(root = process.cwd()) {
  return readFileSync(join(root, 'src/routes/app/parent/+page.svelte'), 'utf8') + '\n' + familyComponents(root);
}
