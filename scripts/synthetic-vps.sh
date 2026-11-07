#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose --env-file /dev/null --project-name meabeclick-synthetic --file "$ROOT/docker-compose.synthetic.yml")
PORT="${SYNTHETIC_PORT:-4173}"

# Bound daemon/CLI waits as well as application smoke. No timeout override:
# build 10m; ordinary operations 2m; teardown 1m; TERM then KILL after 5s.
compose() {
  local seconds=120
  case " $* " in
    *" --build "*) seconds=600 ;;
    *" down "*) seconds=60 ;;
  esac
  timeout --signal=TERM --kill-after=5s "${seconds}s" "${COMPOSE[@]}" "$@"
}

if ! command -v timeout >/dev/null 2>&1; then
  printf '[synthetic] GNU timeout is required to bound lifecycle operations\n' >&2
  exit 69
fi

if [[ ! "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1024 || PORT > 65535 )); then
  printf '[synthetic] SYNTHETIC_PORT must be an integer from 1024 through 65535\n' >&2
  exit 64
fi

case "${1:-}" in
  up|verify|down|rebuild)
    if ! command -v flock >/dev/null 2>&1; then
      printf '[synthetic] flock is required to serialize synthetic lifecycle commands\n' >&2
      exit 69
    fi
    LOCK_DIR="/tmp/meabeclick-synthetic-${UID}.lock.d"
    if [[ ! -e "$LOCK_DIR" && ! -L "$LOCK_DIR" ]]; then
      (umask 077; mkdir "$LOCK_DIR") 2>/dev/null || true
    fi
    if [[ -L "$LOCK_DIR" || ! -d "$LOCK_DIR" ]] \
      || [[ "$(stat -c '%u' -- "$LOCK_DIR" 2>/dev/null || true)" != "$UID" ]] \
      || [[ "$(stat -c '%a' -- "$LOCK_DIR" 2>/dev/null || true)" != "700" ]]; then
      printf '[synthetic] lifecycle lock directory must be a user-owned mode-700 directory: %s\n' "$LOCK_DIR" >&2
      exit 73
    fi
    exec 9<"$LOCK_DIR"
    if ! flock -n 9; then
      printf '[synthetic] another synthetic lifecycle command is active; retry after it finishes\n' >&2
      exit 75
    fi
    ;;
esac

verify_existing() {
  local verified=0
  cleanup_failed_verify() {
    local status=$?
    trap - ERR EXIT
    if (( verified == 0 )); then
      printf '[synthetic] verification failed; removing the synthetic project and volume\n' >&2
      compose down --volumes --remove-orphans || printf '[synthetic] cleanup failed; synthetic resources may remain; run down and verify removal\n' >&2
    fi
    exit "$status"
  }
  trap cleanup_failed_verify ERR EXIT

  compose config --quiet
  compose ps
  compose rm --stop --force gateway
  compose --profile tools run --rm --no-deps seed
  compose --profile tools run --rm --no-deps seed node synthetic/verify.mjs
  compose up -d --wait gateway
  timeout --signal=TERM --kill-after=5s 20s node synthetic/http-smoke.mjs "http://127.0.0.1:${PORT}"
  timeout --signal=TERM --kill-after=5s 55s node synthetic/browser-smoke.mjs "http://127.0.0.1:${PORT}"
  verified=1
  trap - ERR EXIT
}

up() {
  local ready=0
  cleanup_failed_up() {
    local status=$?
    trap - ERR EXIT
    if (( ready == 0 )); then
      printf '[synthetic] startup failed; removing the synthetic project and volume\n' >&2
      compose down --volumes --remove-orphans || printf '[synthetic] cleanup failed; synthetic resources may remain; run down and verify removal\n' >&2
    fi
    exit "$status"
  }
  trap cleanup_failed_up ERR EXIT

  compose rm --stop --force gateway
  compose up -d --build --wait app
  compose --profile tools run --rm --no-deps seed
  compose --profile tools run --rm --no-deps seed node synthetic/verify.mjs
  compose up -d --wait gateway
  timeout --signal=TERM --kill-after=5s 20s node synthetic/http-smoke.mjs "http://127.0.0.1:${PORT}"
  timeout --signal=TERM --kill-after=5s 55s node synthetic/browser-smoke.mjs "http://127.0.0.1:${PORT}"
  ready=1
  trap - ERR EXIT
  printf '[synthetic] ready at http://127.0.0.1:%s\n' "$PORT"
}

case "${1:-}" in
  up) up ;;
  verify) verify_existing ;;
  down) compose down --volumes --remove-orphans ;;
  rebuild)
    compose down --volumes --remove-orphans
    up
    ;;
  config) compose config ;;
  *)
    printf 'Usage: %s {up|verify|down|rebuild|config}\n' "$0" >&2
    exit 64
    ;;
esac
