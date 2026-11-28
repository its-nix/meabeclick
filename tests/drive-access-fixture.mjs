import assert from 'node:assert/strict';

// Recompute on each request: moving a file or changing a folder grant changes
// access immediately, including for someone who saved the original URL.
export function effectivePermissions(files, id) {
  const grants = new Map();
  const visited = new Set();
  function visit(fileId, ancestors) {
    assert.ok(!ancestors.has(fileId), 'Cycle in simulated Drive hierarchy: ' + fileId);
    if (visited.has(fileId)) return;
    const file = files.get(fileId);
    assert.ok(file, 'Missing simulated Drive ancestor: ' + fileId);
    visited.add(fileId);
    for (const grant of file.permissions) {
      assert.ok(grant.id, 'Missing simulated Drive permission ID');
      grants.set(JSON.stringify([grant.id, grant.role]), grant);
    }
    const path = new Set(ancestors).add(fileId);
    for (const parentId of file.parents) visit(parentId, path);
  }
  visit(id, new Set());
  return [...grants.values()];
}

export function canAccessDocument(files, id, email, write) {
  return effectivePermissions(files, id).some(grant => {
    let matches;
    switch (grant.type) {
      case 'anyone': matches = true; break;
      case 'user': matches = grant.emailAddress?.toLowerCase() === email.toLowerCase(); break;
      case 'domain': matches = email.split('@')[1]?.toLowerCase() === grant.domain.toLowerCase(); break;
      default: throw Error('Unsupported simulated Drive permission: ' + grant.type);
    }
    assert.ok(['reader', 'commenter', 'writer', 'fileOrganizer', 'organizer', 'owner'].includes(grant.role));
    return matches && (!write || ['writer', 'fileOrganizer', 'organizer', 'owner'].includes(grant.role));
  });
}
