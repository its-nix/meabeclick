#!/usr/bin/env bash
set -euo pipefail

# Forced SSH command. Read deploy inputs from stdin and ignore the SSH command.
cd "$(dirname -- "$(realpath -- "${BASH_SOURCE[0]}")")"
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

exec 9>.deploy.lock
flock --exclusive --wait 600 9

bounded() {
  # Keep the lock in this shell even if a child starts other processes.
  timeout --kill-after=5s "$@" 9>&-
}

main_ref=refs/heads/main
ref=$(bounded 15s git ls-remote --exit-code https://github.com/its-nix/meabeclick.git "$main_ref" </dev/null)
IFS=$'\t' read -r tip branch <<< "$ref"
if ! [[ "$tip" =~ ^[0-9a-f]{40}$ && "$branch" == "$main_ref" ]]; then
  echo 'Could not verify the current main commit' >&2
  exit 1
fi
if [[ "$tip" != "$commit" ]]; then
  printf 'Skipped staging commit %s because main is %s\n' "$commit" "$tip"
  exit 0
fi

repository=ghcr.io/its-nix/meabeclick
umask 077
work_dir=$(mktemp -d)
trap 'find "$work_dir" -depth -delete' EXIT
export DOCKER_CONFIG="$work_dir/docker"
mkdir -p "$DOCKER_CONFIG"
export BUILDX_CONFIG="$DOCKER_CONFIG/buildx"
printf '%s\n' "$registry_token" | bounded 15s docker login ghcr.io --username "$registry_user" --password-stdin
unset registry_token
published_digest=$(bounded 20s docker buildx imagetools inspect --format '{{.Manifest.Digest}}' "$repository:$commit")
if [[ "$published_digest" != "$digest" ]]; then
  printf 'Published digest for commit %s does not match the staging request\n' "$commit" >&2
  exit 1
fi

export STAGING_IMAGE="$repository@$digest"
compose=(docker compose --env-file /dev/null --project-name meabeclick-staging -f compose.yml)
if [[ -f https.compose.yml ]]; then
  compose+=(-f https.compose.yml)
fi
if ! bounded 5s docker image inspect "$STAGING_IMAGE" >/dev/null 2>&1; then
  bounded 300s "${compose[@]}" pull app
fi
bounded 25s "${compose[@]}" up --detach --no-build --pull never
container=$(bounded 5s "${compose[@]}" ps --quiet app)
expected=$(bounded 5s docker image inspect "$STAGING_IMAGE" --format '{{.Id}}')
running=$(bounded 5s docker inspect "$container" --format '{{.Image}}')
test "$expected" = "$running"

bounded 45s docker exec -i "$container" node --input-type=module - <<'JS'
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const app = 'http://127.0.0.1:3000';
const origin = process.env.ORIGIN;
const request = (path, options) => fetch(app + path, {
  redirect: 'manual', signal: AbortSignal.timeout(3000), ...options,
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
const booking = await request('/booking');
assert.equal(booking.status, 200, 'booking page responds directly');
assert.ok(/<h1(?:\s[^>]*)?>הזמנת שיעור<\/h1>/.test(await booking.text()), 'booking page heading renders');

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

if [[ -f https.compose.yml ]]; then
  public_url=${STAGING_PUBLIC_URL:-https://staging.meabeclick.com}
  public_url=${public_url%/}
  if [[ ! "$public_url" =~ ^https://[^[:space:]]+$ ]]; then
    printf 'Staging public URL must use https://, got %s\n' "$public_url" >&2
    exit 1
  fi
  curl_tls=()
  if [[ -n "${STAGING_CA_CERT:-}" ]]; then
    curl_tls=(--cacert "$STAGING_CA_CERT")
  fi

  if [[ ! -r proxy-password ]]; then
    echo 'Staging HTTPS is enabled but proxy-password is missing' >&2
    exit 1
  fi
  proxy_password=$(tr -d '\r\n' < proxy-password)
  if [[ -z "$proxy_password" ]]; then
    echo 'Staging HTTPS proxy-password is empty' >&2
    exit 1
  fi

  escaped_proxy_pass=${proxy_password//\\/\\\\}
  escaped_proxy_pass=${escaped_proxy_pass//\"/\\\"}
  printf 'user = "operator:%s"\n' "$escaped_proxy_pass" > "$work_dir/curl-auth.cfg"
  unset proxy_password escaped_proxy_pass

  # Read the effective ADMIN_PASSWORD directly from the running container so
  # quoted/escaped staging.env values always match Docker Compose's env_file parsing.
  if ! bounded 10s docker exec "$container" node -e \
      'const p = process.env.ADMIN_PASSWORD; if (!p) process.exit(1); process.stdout.write(JSON.stringify({ password: p }));' \
      > "$work_dir/login.json" || [[ ! -s "$work_dir/login.json" ]]; then
    echo 'Staging HTTPS ADMIN_PASSWORD could not be read from the running container' >&2
    exit 1
  fi

  unauth_status=''
  for _ in 1 2 3 4 5; do
    unauth_status=$(bounded 15s curl --silent --show-error --max-time 10 "${curl_tls[@]}" \
      --dump-header "$work_dir/unauth-me.hdr" \
      --output /dev/null --write-out '%{http_code}' "$public_url/api/me" || true)
    if [[ "$unauth_status" == 401 ]] && grep -qi '^www-authenticate:[[:space:]]*basic' "$work_dir/unauth-me.hdr"; then
      break
    fi
    sleep 2
  done
  if [[ "$unauth_status" != 401 ]] || ! grep -qi '^www-authenticate:[[:space:]]*basic' "$work_dir/unauth-me.hdr"; then
    printf 'Expected staging HTTPS %s/api/me without credentials to return 401 Basic challenge, got %s\n' \
      "$public_url" "${unauth_status:-error}" >&2
    exit 1
  fi

  unauth_booking_status=$(bounded 15s curl --silent --show-error --max-time 10 "${curl_tls[@]}" \
    --dump-header "$work_dir/unauth-booking.hdr" \
    --output /dev/null --write-out '%{http_code}' "$public_url/booking" || true)
  if [[ "$unauth_booking_status" != 401 ]] || ! grep -qi '^www-authenticate:[[:space:]]*basic' "$work_dir/unauth-booking.hdr"; then
    printf 'Expected staging HTTPS %s/booking without credentials to return 401 Basic challenge, got %s\n' \
      "$public_url" "${unauth_booking_status:-error}" >&2
    exit 1
  fi

  unauth_login_status=$(bounded 15s curl --silent --show-error --max-time 10 "${curl_tls[@]}" \
    --dump-header "$work_dir/unauth-login.hdr" \
    --header 'content-type: application/json' \
    --header "origin: $public_url" \
    --data '{}' \
    --output /dev/null --write-out '%{http_code}' "$public_url/api/login" || true)
  if [[ "$unauth_login_status" != 401 ]] || ! grep -qi '^www-authenticate:[[:space:]]*basic' "$work_dir/unauth-login.hdr" || grep -qi '^set-cookie:' "$work_dir/unauth-login.hdr"; then
    printf 'Expected staging HTTPS %s/api/login without credentials to return 401 Basic challenge, got %s\n' \
      "$public_url" "${unauth_login_status:-error}" >&2
    exit 1
  fi

  booking_status=$(bounded 15s curl --silent --show-error --max-time 10 "${curl_tls[@]}" \
    --config "$work_dir/curl-auth.cfg" \
    --dump-header "$work_dir/booking.hdr" \
    --output "$work_dir/booking.html" \
    --write-out '%{http_code}' "$public_url/booking")
  if [[ "$booking_status" != 200 ]]; then
    printf 'Expected authenticated staging /booking to return 200, got %s\n' "$booking_status" >&2
    exit 1
  fi
  if ! grep -qi '^x-robots-tag:.*noindex' "$work_dir/booking.hdr"; then
    echo 'Staging HTTPS /booking is missing X-Robots-Tag: noindex' >&2
    exit 1
  fi
  if ! grep -qi '^cache-control:.*no-store' "$work_dir/booking.hdr"; then
    echo 'Staging HTTPS /booking is missing Cache-Control: no-store' >&2
    exit 1
  fi
  if ! grep -qE '<h1([[:space:]][^>]*)?>הזמנת שיעור</h1>' "$work_dir/booking.html"; then
    echo 'Staging HTTPS /booking did not render the booking heading' >&2
    exit 1
  fi

  login_status=$(bounded 15s curl --silent --show-error --max-time 10 "${curl_tls[@]}" \
    --config "$work_dir/curl-auth.cfg" \
    --cookie-jar "$work_dir/cookies.txt" \
    --header 'content-type: application/json' \
    --header "origin: $public_url" \
    --data-binary "@$work_dir/login.json" \
    --output /dev/null --write-out '%{http_code}' "$public_url/api/login")
  if [[ "$login_status" != 200 ]]; then
    printf 'Expected authenticated staging /api/login to return 200, got %s\n' "$login_status" >&2
    exit 1
  fi

  me_body=$(bounded 15s curl --silent --show-error --fail --max-time 10 "${curl_tls[@]}" \
    --config "$work_dir/curl-auth.cfg" \
    --cookie "$work_dir/cookies.txt" \
    --dump-header "$work_dir/me.hdr" \
    "$public_url/api/me")
  if [[ "$me_body" != '{"authenticated":true}' ]]; then
    printf 'Expected authenticated staging /api/me over HTTPS, got %s\n' "$me_body" >&2
    exit 1
  fi

  expected_release="${commit} ${STAGING_IMAGE}"
  actual_release=$(awk -F: 'tolower($1) == "x-meabeclick-release" { sub(/^[^:]*:[[:space:]]*/, ""); sub(/\r$/, ""); print; exit }' "$work_dir/me.hdr")
  if [[ "$actual_release" != "$expected_release" ]]; then
    printf 'Expected staging HTTPS /api/me x-meabeclick-release %s, got %s\n' \
      "$expected_release" "${actual_release:-missing}" >&2
    exit 1
  fi

  printf 'Verified staging startup, booking page, tutor session, and HTTPS ingress for %s\n' "$digest"
  exit 0
fi

printf 'Verified staging startup, booking page, and tutor session for %s\n' "$digest"
