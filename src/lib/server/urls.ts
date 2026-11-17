/**
 * URL helpers for the one place a path segment or a portal link is built.
 *
 * Path segments (unlike query params, which URLSearchParams percent-encodes
 * safely) are interpolated directly into URLs and file paths, so this
 * module enforces the shape itself and throws loudly on anything else,
 * rather than silently minting a traversal-shaped path.
 */

const PATH_SEGMENT = /^[a-z0-9-]+$/;

// Exported so other modules that mint or read filesystem/URL segments
// (src/lib/server/lesson/queue.ts) reuse this exact allowlist instead of
// maintaining a second copy that could quietly drift out of sync.
export function assertPathSegment(name: string, value: string): void {
  if (!PATH_SEGMENT.test(value)) {
    // Keep the message short — do not echo the offending value, which may
    // be arbitrarily long or attacker-controlled.
    throw new Error(`urls: invalid ${name}`);
  }
}

/** The student portal page for a given student code, e.g. "/portal?s=noga". */
export function portalLink(code: string): string {
  assertPathSegment('code', code);
  return `/portal?s=${code}`;
}
