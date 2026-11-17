/**
 * Typed access to games/registry.json — the matching layer between lesson
 * generation and the game content shapes. It tells the lesson-prep pipeline
 * which game type fits which learning goal, and exactly what data shape
 * each one needs.
 *
 * Read lazily, on first use (getRegistry()) — NOT at module load, so
 * importing this module can never crash on an absent or invalid
 * games/registry.json (boot-checks.ts WARNS about that instead of
 * throwing). getRegistry() caches after the first successful read.
 *
 * Path resolved from process.cwd(), not import.meta.url: the adapter-node
 * build inlines this module into whichever route bundle imports it, and
 * that bundled chunk's import.meta.url is the OUTPUT file's path, not the
 * repo root. cwd is what dataDir() in content.ts already resolves `./data`
 * against (both `npm run dev` and the built `node build/index.js` start
 * from the project root).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REGISTRY_PATH = join(process.cwd(), 'games', 'registry.json');

export interface RegistryTemplate {
  title: string;
  status: string;
  bestFor?: string;
  itemRange?: [number, number];
  ageRange?: [number, number];
  dataSchema?: unknown;
  notes?: string;
  example?: string;
  name?: string;
}

export interface SelectionRule {
  when: string;
  use: string;
  goal: string;
}

export interface Registry {
  version: number;
  selection: { rules: SelectionRule[]; fallback: string };
  templates: Record<string, RegistryTemplate>;
  conventions?: Record<string, string>;
}

let cached: Registry | null = null;

/** Reads and parses games/registry.json on first call, caching the result
 *  for the life of the process; every later call returns the cached value
 *  without touching the filesystem again. Throws (ENOENT / SyntaxError)
 *  if the file is missing or invalid — callers that need graceful
 *  degradation should catch around this, not the boot check, which only
 *  warns. */
export function getRegistry(): Registry {
  if (!cached) {
    // The `as Registry` is load-bearing, not decorative: JSON.parse
    // returns `any`, and assigning an `any` to a variable whose declared
    // type is `Registry | null` widens it right back to the full declared
    // type instead of narrowing — without the cast, TS can't prove `cached`
    // is non-null on the `return` below.
    cached = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')) as Registry;
  }
  return cached;
}
