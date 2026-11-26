#!/usr/bin/env bash
set -euo pipefail

# Forced SSH command. Read deploy inputs from stdin and ignore the SSH command.
cd /srv/meabeclick-staging
if ! IFS= read -r -n 41 -t 5 commit || [[ ! "$commit" =~ ^[0-9a-f]{40}$ ]]; then
  echo 'Expected a full Git commit SHA' >&2
  exit 2
fi
if ! IFS= read -r -n 72 -t 5 digest || [[ ! "$digest" =~ ^sha256:[a-f0-9]{64}$ ]]; then
  echo 'Expected one sha256 image digest' >&2
  exit 2
fi

registry_user_pattern='^[A-Za-z0-9_-]{1,49}(\[bot\])?$'
if ! IFS= read -r -n 56 -t 5 registry_user || [[ ! "$registry_user" =~ $registry_user_pattern ]]; then
  echo 'Expected a GitHub registry username' >&2
  exit 2
fi
if ! IFS= read -r -n 4096 -t 5 registry_token || [[ -z "$registry_token" || ${#registry_token} -ge 4096 ]]; then
  echo 'Expected a GitHub registry token' >&2
  exit 2
fi

exec 9>/run/lock/meabeclick-staging-deploy.lock
flock --exclusive 9

main_ref=refs/heads/main
ref=$(timeout 15s git ls-remote --exit-code https://github.com/its-nix/meabeclick.git "$main_ref")
IFS=$'\t' read -r tip branch <<< "$ref"
if ! [[ "$tip" =~ ^[0-9a-f]{40}$ && "$branch" == "$main_ref" ]]; then
  echo 'Could not verify the current main commit' >&2
  exit 1
fi
if [[ "$tip" != "$commit" ]]; then
  printf 'Skipped staging commit %s because main is %s\n' "$commit" "$tip"
  exit 0
fi

export STAGING_IMAGE="ghcr.io/its-nix/meabeclick@$digest"
compose=(docker compose --env-file /dev/null --project-name meabeclick-staging)
if ! docker image inspect "$STAGING_IMAGE" >/dev/null 2>&1; then
  export DOCKER_CONFIG
  DOCKER_CONFIG=$(mktemp -d)
  trap 'test ! -f "$DOCKER_CONFIG/config.json" || unlink "$DOCKER_CONFIG/config.json"; rmdir "$DOCKER_CONFIG"' EXIT
  printf '%s\n' "$registry_token" | docker login ghcr.io --username "$registry_user" --password-stdin
  unset registry_token
  "${compose[@]}" pull app
fi
"${compose[@]}" up --detach --no-build --pull never
container=$("${compose[@]}" ps --quiet app)
expected=$(docker image inspect "$STAGING_IMAGE" --format '{{.Id}}')
running=$(docker inspect "$container" --format '{{.Image}}')
test "$expected" = "$running"

docker exec -i "$container" node --input-type=module - <<'JS'
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const app = 'http://127.0.0.1:3000';
const origin = process.env.ORIGIN;
const request = (path, options) => fetch(app + path, {
  signal: AbortSignal.timeout(3000), ...options,
});

let ready = false;
for (let attempt = 0; attempt < 20; attempt++) {
  try {
    ready = (await request('/api/me')).ok;
    if (ready) break;
  } catch {}
  await delay(1000);
}
assert.ok(ready, 'staging app started');
assert.deepEqual(await (await request('/api/me')).json(), { authenticated: false });
assert.equal((await request('/booking')).status, 200, 'booking page responds');

const login = await request('/api/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin },
  body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }),
});
assert.equal(login.status, 200, 'staging tutor can sign in');
const cookie = login.headers.get('set-cookie')?.split(';', 1)[0];
assert.ok(cookie, 'staging returned a session');
assert.deepEqual(await (await request('/api/me', { headers: { cookie } })).json(), { authenticated: true });
JS

printf 'Verified staging startup, booking page, and tutor session for %s\n' "$digest"
