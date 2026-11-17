/**
 * Root directory for student portal files (one JSON per student), the one
 * place that path is computed.
 *
 * Overridable via PORTAL_DIR so the characterization test suite can point
 * bookings and portal reads at a scratch directory instead of the real,
 * tracked portal/ directory, which holds actual student PII. Left unset,
 * this resolves to exactly the on-disk path every caller used before this
 * override existed — nothing about production behavior changes.
 *
 * `dataDir()` is the runtime data directory (DATA_DIR, `./data` when unset).
 * Read from process.env, not `$env/dynamic/private`: that import is a Vite
 * virtual module and would make this file unimportable by `node --test`.
 *
 * `portalDir()` is deliberately NOT expressed in terms of `dataDir()`: its
 * unset default is `<repo root>/portal`, a different directory from
 * `./data` relative to the process's cwd. Silently moving where student PII
 * portal files resolve to, for every deployment that leaves PORTAL_DIR
 * unset, is exactly the kind of drift this module exists to prevent.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export function portalDir(): string {
  return process.env.PORTAL_DIR || join(SITE, 'portal');
}

export const dataDir = (): string => process.env.DATA_DIR ?? './data';
