import test from 'node:test';
import assert from 'node:assert/strict';
import { canAccessDocument, patchDriveFile } from '../drive-access-fixture.mjs';

test('a saved homework URL follows inherited grants, revocation and folder moves', () => {
  const email = 'parent@example.test';
  const folder = parents => ({ mimeType: 'application/vnd.google-apps.folder', parents, permissions: [] });
  const files = new Map([['root', folder([])], ['review', folder(['root'])],
    ['lesson', folder(['review'])], ['student', folder(['root'])], ['doc', folder(['lesson'])]]);
  for (const [id, file] of files) file.id = id;
  const doc = files.get('doc');
  doc.mimeType = 'application/vnd.google-apps.document';
  const access = write => canAccessDocument(files, 'doc', email, write);
  assert.equal(access(false), false);
  files.get('review').permissions.push({ id: 'reader', type: 'user', emailAddress: email, role: 'reader' });
  assert.equal(access(false), true, 'a draft URL is readable through the review folder');
  assert.equal(access(true), false);
  for (const query of ['addParents=student', 'addParents=student&removeParents=review',
    'removeParents=lesson', 'addParents=unknown&removeParents=lesson']) {
    const result = patchDriveFile(files, doc, new URLSearchParams(query), { writersCanShare: false });
    assert.equal(result.status, 400, query);
    assert.deepEqual(doc.parents, ['lesson']);
    assert.equal(doc.writersCanShare, undefined);
    assert.equal(access(false), true, 'a rejected move must preserve inherited access');
  }
  const moved = patchDriveFile(files, doc, new URLSearchParams({ addParents: 'student', removeParents: 'lesson' }), {});
  assert.equal(moved.status, 200);
  assert.deepEqual(doc.parents, ['student']);
  assert.equal(access(false), false);
  files.get('student').permissions.push({ id: 'public', type: 'anyone', role: 'writer' });
  files.get('doc').permissions = [{ id: 'direct', type: 'user', emailAddress: email, role: 'reader' }];
  assert.equal(access(true), true, 'the direct reader grant cannot mask inherited writer access');
  files.get('doc').permissions = [];
  assert.equal(access(true), true, 'removing the document grant alone cannot revoke inherited access');
  files.get('student').permissions = [];
  assert.equal(access(false), false);
});
