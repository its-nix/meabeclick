# Isolated synthetic VPS environment

This stack is for UX and release testing with fictional data only. It does not deploy, restart, stop, or inspect the production stack. It has a separate fixed Compose project, image, internal network, named volume, database, port, and deterministic seed.

## Current release gate

The normal-app smoke exercises the current one-time auth contract: HTTP 200
`/enter` confirmation, JSON POST `/api/access/redeem`, and a real browser
`/enter#<ephemeral-token>` visit followed by an explicit click on the real
`כניסה לדף האישי` button. It asserts the fragment is removed from address and
navigation history before any redemption, exact no-store success/destination,
student-only family cookie, and actual homework rendering. Containment fixtures
are **not** normal-app auth evidence. No legacy query-GET auth is restored.

Canonical offline Docker builds remain dependent on locally cached base layers
and npm dependencies; a cached-runtime derivative with a current local build is
only runtime evidence, not a canonical Dockerfile/build pass. Prior isolation
exceptions remain disclosed separately: do not claim strict zero external contact
for earlier runs. No VPS/production probe, merge, deploy or release is authorized
by these tests.

## Safety design

- Compose project: fixed `meabeclick-synthetic`, separate from production.
- Container names are project-prefixed (`meabeclick-synthetic-*`), not shared with production.
- Image: local-only `meabeclick-synthetic:local`; it never pulls or tags the production GHCR image.
- Network: the app and seeder use `meabeclick-synthetic_synthetic_internal` with `internal: true`, so they have no external route. A fixed-target Node gateway joins that network and a separate access bridge only to make Docker's loopback port publishing work; it has no credentials, data volume, shell-configurable target, or application command.
- Data: named volume `meabeclick-synthetic_synthetic_data`, mounted only at `/synthetic-data`; database `/synthetic-data/synthetic.db`.
- Access: the data-less gateway publishes `127.0.0.1:4173` by default and forwards only to `app:3000`. There is no public listener, Caddy service, DNS change, or TLS automation.
- Every lifecycle call pins Docker Compose to `--env-file /dev/null`, so Compose never implicitly reads the project-root production `.env`. `SYNTHETIC_PORT` is the only supported shell override and must be an integer from 1024 through 65535. No `.env`, host `data/`, service-account JSON, Codex home, protected knowledgebase path, production database, or other host path is mounted.
- `up`, `verify`, `rebuild`, and `down` take the same non-blocking per-UID lock on `/tmp/meabeclick-synthetic-<uid>.lock.d` before invoking Docker. The lock target is a retained, non-symlink, user-owned mode-700 directory; unsafe pre-existing targets fail closed with status 73. A concurrent command exits immediately with status 75 and a clear message, without touching Docker. The file descriptor holds the directory lock through failure cleanup. Read-only `config` does not take the lock.
- The entrypoint rejects a shared source-controlled inventory of integration credentials/config and all lesson/question engine, binary, model, effort, and timeout redirects. It also refuses Codex credential files, paths outside `/synthetic-data`, and non-loopback URLs.
- The named volume is marked before first database creation. An unmarked non-empty data directory is refused. After migrations, the seeder removes every application row except migration bookkeeping—including migration-created named tutors and generic catalog exercises—then inserts the deterministic fixture in one transaction with foreign-key enforcement enabled and deferred until the complete graph exists.
- The seeder also cleans the portal directory and atomically creates exactly `/synthetic-data/portal/synthetic-student-gamma.json`. Its obviously fictional, deterministic content includes the seeded lesson and game. Reruns replace corruption or stale temporary files and remove every unexpected portal entry.
- Final verification is exhaustive against `src/lib/server/storage-inventory.ts`: every known data table is either constrained to exact synthetic IDs/content or required to be empty. It independently runs SQLite's `foreign_key_check` and verifies the exact portal path/content and absence of other portal files. The allowlist includes the exact published `lesson_materials` slide row used by `/lessons/synthetic-quadratic-formulas`. Unknown/missing tables, broken references, real/default tutor fields, extra bookings/enrollments/payments/reports/results, and altered formula/homework/submission/material fixtures fail verification.
- The baseline policy explicitly includes migrations 32/33: `access_credentials`, `access_credential_audit`, `lesson_game_assignments`, and `lesson_game_revisions` are purged and required empty, and migration bookkeeping must be exactly versions 1–33. An isolated `DB_PATH=:memory:` regression initializes the real application schema (including legacy DDL), replaces fictional rows twice, and rejects unknown/missing tables and extra rows. Only the explicit smoke lifecycle adds exactly one real student link plus its unused join companion; both are checked against their exact issuance snapshots and production hashes, with student scope 92001 and system/null issuer. The link has the production 15-minute TTL and fails closed on expiry. The join remains issued, unconsumed and unrevoked throughout. After redemption there is one consumed audit row; replay adds exactly one replayed row without changing the first consumption. All other tables still undergo the same exhaustive fixture verification.
- A private anonymous-pipe handoff (`compose exec -T app`, never container logs) calls the exact production `issueStudentCredentials` helper after two clear/seed/verify cycles. Raw link token lives in process memory/pipe and the browser's ephemeral fragment only: no persisted fixture file, DB plaintext, URL query, log or CI output. The join secret is never handed out. The production issuer/database/migration source files are explicitly copied into the runtime image for this tool; no duplicate digest implementation or synthetic auth bypass exists. Each HTTP/browser run resets the synthetic fixture, then independently exercises one link. This is destructive only to the fixed synthetic volume; direct smoke invocations must not run concurrently.
- The real browser is launched only after a local exact-origin HTTP proxy is listening. Chrome has a fixed proxy with no DIRECT fallback and with implicit loopback bypass disabled. Redirects, subresources, workers and new targets all traverse the same transport boundary before any upstream contact. Only the exact supplied HTTP origin can be forwarded; all CONNECT tunnels and WebSocket upgrades are denied (not needed for this production-build smoke). QUIC and non-proxied WebRTC UDP are disabled; DNS is disabled except the numeric loopback proxy. Chrome background requests are blocked too, not silently forwarded. Page network events additionally report origin escapes; they are detection, not the containment mechanism.
- The HTTP smoke has a 15-second total deadline spanning every header and body read, using one abort controller. Unneeded bodies are canceled immediately; all pending work is aborted on every exit. A third smoke-only CLI argument may shorten (never extend) this deadline to 100–15000ms for adversarial tests. Streaming whitespace cannot reset it. Lifecycle commands add an outer 20-second HTTP / 55-second browser backstop. Browser TERM/INT triggers profile/transport/process cleanup.
- Every Compose operation is bounded with GNU `timeout`: builds 600s, ordinary operations 120s, teardown 60s, followed by KILL 5s after TERM. A timeout is nonzero; failed cleanup explicitly warns that resources may remain. Always verify scoped container/volume absence after cleanup—an attempted command is not evidence of removal.
- Gmail/SMTP, Calendar, Drive, Meet OAuth, CallMeBot/WhatsApp, Slack alerts, and Codex/OpenAI credentials are absent. The application network blocks egress as a second, independent control. The access gateway cannot read the database or invoke anything except the fixed app target.

The fixed tutor password is `synthetic-tutor-only`. It is intentionally public and valid only in this isolated stack. All seeded names contain `בדיקה`, all email addresses use reserved `example.invalid`, and phone/content values are obvious fixtures.

## Prerequisites

Docker Engine with Compose v2, GNU `timeout` (coreutils) for bounded operations, `flock` from util-linux for fail-closed lifecycle serialization, and a local Chrome/Chromium executable for the rendered student-UI smoke (`CHROME_BIN` may name a nonstandard path). No production environment file or credential is needed or accepted.

Validate the fully rendered configuration without starting anything:

```bash
./scripts/synthetic-vps.sh config
```

## Start, seed, and verify

```bash
./scripts/synthetic-vps.sh up
```

This first stops/removes the old synthetic gateway, builds and starts only the internal app, seeds/verifies the complete baseline (both access tables empty), then starts the loopback gateway. Each smoke uses a private fixture process that clears/seeds/verifies twice before issuing one real short-lived student link and its unused join companion. HTTP smoke checks the confirmation HTML, real JSON redemption, exact no-store success/destination/cookie, normal student page/API, lesson slides and signed game content. Browser smoke opens the fragment link in a fresh explicit Chrome profile behind the exact-origin proxy, checks history/address scrubbing and zero pre-click redeems, clicks the actual button via browser input, observes the real POST/response without mocking, then checks the normal homework card, submitted `לשחק שוב` action and `נבדק — יפה מאוד` grade. Both assert exact student family scope, parent/sibling/payment denials, generic replay failure without a new session/destination, and exhaustive post-consume/post-replay database readbacks. Every HTTP fetch uses manual redirects; targets and returned fixture URLs must stay on the exact numeric-loopback origin.

The existing layout requests one exact optional Google Fonts stylesheet. It remains **blocked by the proxy**, not fetched or replaced. The smoke reports the blocked attempt and renders with fallback fonts; only that exact GET stylesheet is classified as expected detection noise. All other page-origin escapes still fail, and all off-origin transport (including fonts, browser background requests, CONNECT and WebSockets) remains denied before contact. This is not a typography review or a claim of zero attempted external requests.

If app startup, seeding, database verification, gateway startup, the HTTP smoke, or the rendered-browser smoke fails, the command fails closed and removes the entire fixed synthetic Compose project, including its named data volume. A partially seeded or unverified environment is never left available.

Open `http://127.0.0.1:4173`. Use `/login` and the fixed synthetic tutor password for the tutor flow. The seeded account/student, completed homework, formula-rich quiz (`y = x²`), game result, booking, lesson, and report appear in the normal application views. To explicitly rerun the same normal student magic-link and portal flow checked by `up` and `verify`, run `node synthetic/http-smoke.mjs http://127.0.0.1:4173`; it mints only a short-lived link for fixed fictional student `92001` and prints no token or record content.

To use another loopback port:

```bash
SYNTHETIC_PORT=4273 ./scripts/synthetic-vps.sh up
```

For a remote VPS, do not publish the port. Keep the Compose binding unchanged and tunnel it:

```bash
ssh -L 4173:127.0.0.1:4173 <synthetic-vps-host>
```

Then browse locally to `http://127.0.0.1:4173`. No DNS or public Caddy change is part of this environment.

## Verify an existing stack

```bash
./scripts/synthetic-vps.sh verify
```

Expected evidence includes:

- Compose config validation succeeds.
- Only `meabeclick-synthetic-*` resources are shown.
- Baseline database verification reports exact fixture counts and empty access tables. After each journey the only additions are exactly two student credentials and two audit rows (`consumed`, `replayed`), with every other table unchanged.
- Confirmation HTML, real POST exchange, actual browser click/render, student page/API, lesson slides and signed game checks succeed; both exhaustive lifecycle checkpoints pass.

`verify` stops the gateway and reseeds the baseline before running these journeys again; it does not expect a prior consumed credential to disappear without reseeding.

The check prints counts only; it does not print seeded records.

## Teardown and clean rebuild

Remove only the fixed synthetic project and its named volume:

```bash
./scripts/synthetic-vps.sh down
```

Clean rebuild from an empty synthetic volume:

```bash
./scripts/synthetic-vps.sh rebuild
```

The lifecycle script hard-codes `--env-file /dev/null`, `--project-name meabeclick-synthetic`, and the absolute path to `docker-compose.synthetic.yml`. It does not accept an env/project/file override and never invokes broad removal commands such as `docker system prune` or `docker volume rm`.

## Verification scope and isolation disclosure

No VPS or production probe was performed for the current fragment-click auth
implementation or this documentation correction. Prior isolation exceptions remain
separately disclosed; this document does not claim strict zero external contact for
prior runs. No new host or network diagnostic is needed to verify the synthetic
journey.

Synthetic isolation relies on its separate fixed project, loopback port, internal
network, local image, and synthetic-only volume, with no Caddy service or production
credentials. Production-host metadata is not needed to establish these boundaries.
