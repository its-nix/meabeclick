import { test } from 'node:test';
import assert from 'node:assert/strict';

const { assertPathSegment, portalLink } = await import('../../src/lib/server/urls.ts');

test('portalLink returns a site-absolute portal path for a student code', () => {
  assert.equal(portalLink('noga'), '/portal?s=noga');
});

test('portalLink throws on a path-traversal code rather than minting a url', () => {
  assert.throws(() => portalLink('../foo'));
});

test('a path segment is lowercase letters, digits and hyphens only', () => {
  assert.doesNotThrow(() => assertPathSegment('slug', 'algebra-basics-2'));
  for (const bad of ['', '../foo', 'a/b', 'A', 'a b', 'שלום']) {
    assert.throws(() => assertPathSegment('slug', bad), /invalid slug/, JSON.stringify(bad));
  }
});
