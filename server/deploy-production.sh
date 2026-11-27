#!/usr/bin/env bash
set -euo pipefail

# Forced SSH command for production promotion.
# Reads the exact commit SHA and staging-verified image digest from stdin,
# verifies the checkout and GHCR image under an exclusive lock, deploys without
# pulling an unverified tag, and confirms the running container image ID.
if ! IFS= read -r -n 41 -t 5 commit || [[ ! "$commit" =~ ^[0-9a-f]{40}$ ]]; then
  echo 'Expected a full Git commit SHA' >&2
  exit 2
fi
if ! IFS= read -r -n 72 -t 5 digest || [[ ! "$digest" =~ ^sha256:[a-f0-9]{64}$ ]]; then
  echo 'Expected one sha256 image digest' >&2
  exit 2
fi

repo_dir=${PRODUCTION_REPO_DIR:-/home/meabeclick/mea-beclick}
lock_file=${PRODUCTION_LOCK_FILE:-/home/meabeclick/.production-deploy.lock}
repository=${PRODUCTION_IMAGE_REPO:-ghcr.io/its-nix/meabeclick}

cd "$repo_dir"
exec 9>"$lock_file"
flock --exclusive --wait 240 9

bounded() {
  # Keep the lock in this shell even if a child starts other processes.
  timeout --kill-after=5s "$@" 9>&-
}

# Fetch main and confirm this commit is still the tip before changing the box.
bounded 30s git fetch --quiet origin main </dev/null
tip=$(bounded 10s git rev-parse origin/main)
if [[ ! "$tip" =~ ^[0-9a-f]{40}$ ]]; then
  echo 'Could not resolve origin/main commit SHA' >&2
  exit 1
fi
if [[ "$tip" != "$commit" ]]; then
  printf 'Skipped production commit %s because main is %s\n' "$commit" "$tip"
  exit 0
fi

# Fast-forward strictly to the verified commit SHA, never past it.
bounded 20s git merge --ff-only "$commit" </dev/null
head_sha=$(bounded 10s git rev-parse HEAD)
if [[ "$head_sha" != "$commit" ]]; then
  printf 'Expected checkout HEAD %s, got %s\n' "$commit" "$head_sha" >&2
  exit 1
fi

# Pull the immutable staging-verified digest and the commit tag, and verify
# both resolve to the exact same image ID before Compose starts APP_TAG.
digest_ref="$repository@$digest"
tag_ref="$repository:$commit"
if ! bounded 5s docker image inspect "$digest_ref" >/dev/null 2>&1; then
  bounded 90s docker pull "$digest_ref"
fi
expected_id=$(bounded 5s docker image inspect "$digest_ref" --format '{{.Id}}')
if [[ -z "$expected_id" ]]; then
  printf 'Could not inspect pulled digest image %s\n' "$digest_ref" >&2
  exit 1
fi

bounded 90s docker pull "$tag_ref"
tag_id=$(bounded 5s docker image inspect "$tag_ref" --format '{{.Id}}')
if [[ "$tag_id" != "$expected_id" ]]; then
  printf 'Commit tag %s (%s) does not match verified digest %s (%s)\n' \
    "$tag_ref" "$tag_id" "$digest_ref" "$expected_id" >&2
  exit 1
fi

export APP_TAG="$commit"
bounded 45s docker compose up -d --no-build --pull never

container=$(bounded 5s docker compose ps --quiet app)
running_id=$(bounded 5s docker inspect "$container" --format '{{.Image}}')
if [[ "$running_id" != "$expected_id" ]]; then
  printf 'Running production container image %s does not match verified image %s\n' \
    "$running_id" "$expected_id" >&2
  exit 1
fi

bounded 45s docker exec -i "$container" node --input-type=module - <<'JS'
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const app = 'http://127.0.0.1:3000';
const request = path => fetch(app + path, { redirect: 'manual', signal: AbortSignal.timeout(3000) });

let ready = false;
for (let attempt = 0; attempt < 20; attempt++) {
  try {
    ready = (await request('/api/me')).ok;
    if (ready) break;
  } catch {}
  await delay(1000);
}
assert.ok(ready, 'production app started');
assert.deepEqual(await (await request('/api/me')).json(), { authenticated: false });
const booking = await request('/booking');
assert.equal(booking.status, 200, 'booking page responds directly');
assert.ok(/<h1(?:\s[^>]*)?>הזמנת שיעור<\/h1>/.test(await booking.text()), 'booking page heading renders');
JS

printf 'Deployed and verified production commit %s (%s)\n' "$commit" "$digest"
