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

// The fixture models files in single-parent My Drive folders. Validate the
// complete PATCH before changing either the file metadata or its ancestry.
export function patchDriveFile(files, file, query, metadata) {
  let parents = file.parents;
  const invalid = () => Response.json({ error: 'invalid file update' }, { status: 400 });
  if (Object.keys(metadata).some(key => key !== 'writersCanShare')) return invalid();
  if ('writersCanShare' in metadata && typeof metadata.writersCanShare !== 'boolean') return invalid();
  if (query.has('addParents') || query.has('removeParents')) {
    const added = query.get('addParents');
    const removed = query.get('removeParents');
    if (query.getAll('addParents').length !== 1 || query.getAll('removeParents').length !== 1 ||
        parents.length !== 1 || removed !== parents[0] || removed === added) return invalid();
    const destination = files.get(added);
    if (destination?.mimeType !== 'application/vnd.google-apps.folder' || destination.trashed) return invalid();
    const seen = new Set([file.id]);
    for (let folder = destination; folder; folder = files.get(folder.parents[0])) {
      if (seen.has(folder.id)) return invalid();
      seen.add(folder.id);
    }
    parents = parents.filter(id => id !== removed).concat(added);
  }
  Object.assign(file, metadata, { parents });
  return Response.json({ id: file.id, parents, writersCanShare: file.writersCanShare });
}
