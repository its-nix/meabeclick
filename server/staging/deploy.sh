#!/usr/bin/env bash
set -euo pipefail

# Forced SSH command. Read deploy inputs from stdin and ignore the SSH command.
cd /srv/meabeclick-staging
IFS= read -r -n 72 digest
if [[ ! "$digest" =~ ^sha256:[a-f0-9]{64}$ ]]; then
  echo 'Expected one sha256 image digest' >&2
  exit 2
fi

exec 9>/run/lock/meabeclick-staging-deploy.lock
flock --exclusive 9

export STAGING_IMAGE="ghcr.io/its-nix/meabeclick@$digest"
compose=(docker compose --env-file /dev/null --project-name meabeclick-staging)
if ! docker image inspect "$STAGING_IMAGE" >/dev/null 2>&1; then
  IFS= read -r -n 50 registry_user
  [[ "$registry_user" =~ ^[A-Za-z0-9_-]{1,49}$ ]]
  export DOCKER_CONFIG
  DOCKER_CONFIG=$(mktemp -d)
  trap 'test ! -f "$DOCKER_CONFIG/config.json" || unlink "$DOCKER_CONFIG/config.json"; rmdir "$DOCKER_CONFIG"' EXIT
  docker login ghcr.io --username "$registry_user" --password-stdin
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
