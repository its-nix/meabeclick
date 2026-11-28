import test from 'node:test';
import assert from 'node:assert/strict';
import { canAccessDocument } from '../drive-access-fixture.mjs';

test('a saved homework URL follows inherited grants, revocation and folder moves', () => {
  const email = 'parent@example.test';
  const folder = parents => ({ parents, permissions: [] });
  const files = new Map([['root', folder([])], ['review', folder(['root'])],
    ['lesson', folder(['review'])], ['student', folder(['root'])], ['doc', folder(['lesson'])]]);
  const access = write => canAccessDocument(files, 'doc', email, write);
  assert.equal(access(false), false);
  files.get('review').permissions.push({ id: 'reader', type: 'user', emailAddress: email, role: 'reader' });
  assert.equal(access(false), true, 'a draft URL is readable through the review folder');
  assert.equal(access(true), false);
  files.get('doc').parents = ['student'];
  assert.equal(access(false), false);
  files.get('student').permissions.push({ id: 'public', type: 'anyone', role: 'writer' });
  files.get('doc').permissions = [{ id: 'direct', type: 'user', emailAddress: email, role: 'reader' }];
  assert.equal(access(true), true, 'the direct reader grant cannot mask inherited writer access');
  files.get('doc').permissions = [];
  assert.equal(access(true), true, 'removing the document grant alone cannot revoke inherited access');
  files.get('student').permissions = [];
  assert.equal(access(false), false);
});
