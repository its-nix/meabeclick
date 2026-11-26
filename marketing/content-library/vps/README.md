# Content machine Linux runtime

The image packages only the explicitly listed worker modules, three accepted source templates, and seven workflow documents. Build from the generated context, never from the repository root. The builder never traverses student, pricing, website, output or credential trees, and rejects selected symlinks before writing any context. Optional Buffer/outbox modules are copied only when present. New source assets require a deliberate allowlist change.

```sh
python3 marketing/content-library/vps/build-context.py --output /tmp/content-machine-context
docker build -t meabeclick-content-machine:20261114 -f /tmp/content-machine-context/marketing/content-library/vps/Dockerfile /tmp/content-machine-context
```

Node 22, HyperFrames 0.9.9 and Codex CLI 0.149.0 are installed with a dedicated npm lockfile. The source templates carry their own GSAP assets. Chromium comes from Debian Bookworm; `HYPERFRAMES_BROWSER_PATH=/usr/bin/chromium` prevents browser downloads. FFmpeg and Python 3 are installed in the image. `/app/node_modules/.bin/hyperframes` matches preparation.py's expected repository layout.

Deploy this Compose file to `/home/meabeclick/content-machine/compose.yaml` and operate it as meabeclick uid/gid 1002. Provision these host paths with that ownership before starting:

- `state/` (0700): SQLite, generated projects, renders, frozen artifacts, health, intent ledgers, caches, and optional Codex authorization under `state/codex/`. Create owned `state/tmp/` before startup. `TMPDIR=/state/tmp` keeps renderer temporary files on persistent disk; the 512MiB `/tmp` sandbox fails HyperFrames' minimum free-space check.
- `media/` (0700): persistent approved outbox bytes, mounted at `/media`; serve only the explicit public subdirectory configured by the outbox.
- `config/machine.json` (0600): private configuration with `state_dir` set to `/state`, `google_credentials` set to `/run/secrets/google-authorized-user.json`, and snapshot/seed paths translated to `/state/...`.
- `secrets/google-authorized-user.json` (0600): unattended authorized-user Google credentials. The dedicated `secrets/` directory mounts read-only; OAuth refresh occurs in memory. An optional Buffer key may live in this same private content-machine directory without requiring a missing-file bind mount. Do not share the site credentials directory.

Do not include runtime state or secrets in the build context. Transfer selected state separately. The worker uses a read-only image, bounded writable tmpfs directories, no host Docker socket or site database, and a one CPU/3 GiB limit. Persistent `/state/cache`, `/state/codex`, and `/media` remain writable. `PRODUCER_LOW_MEMORY_MODE=1` limits HyperFrames to one render worker and skips memory-intensive calibration. There is no host-port binding. Public approved-media routing is a separate reviewed operation; no general state directory should be served.

```sh
cd /home/meabeclick/content-machine
docker compose -p content-machine run --rm worker --once
docker compose -p content-machine up -d worker
docker compose -p content-machine ps
```

The wrapper calls machine.tick every 900 seconds after the previous tick finishes. Existing machine.tick owns the process lock; blocked external readiness remains explicit in `state/health.json`. Runtime heartbeat is separate in `state/worker-health.json`. Exceptions write a sanitized error class and return nonzero for `--once`; daemon failures remain visible and the next periodic tick may recover. An active tick refreshes its heartbeat every 30 seconds, including during renders and reviewer calls. Healthcheck accepts recent successful or running ticks (up to 3900 seconds), while a failed tick becomes unhealthy. Docker does not restart an unhealthy container automatically; inspect state and restore its dependency/configuration. Stop the Mac timer only after a real Linux generated render, full FFmpeg decode and Google sync pass, and confirmation that the host scheduler owns a single writer.

Useful runtime checks:

```sh
docker compose run --rm --entrypoint sh worker -c 'id; node --version; python3 --version; ffmpeg -version; chromium --version; hyperframes --version; codex --version'
docker compose run --rm --entrypoint python3 worker -c 'import os; from pathlib import Path; assert os.getuid()==1002; Path("/state/probe").touch(); assert Path("/app/node_modules/.bin/hyperframes").is_file()'
```

Generation and full decode must be verified against real transferred snapshot/configuration on the target architecture before claiming deployment readiness. Buffer scheduling still requires exact approval and verified durable authorization.

## Daily cadence rollout and rollback

Use the allowlisted context to build both the worker and renderer images. The new
worker accepts `autonomous_content_enabled: true` and
`daily_calendar_enabled: true`. Set `daily_limit: 1` and
`monthly_limit: 31` for the daily calendar. The worker checks every 900 seconds
and assigns one 19:30 Asia/Jerusalem slot per upcoming day. Ideation replenishes
when inventory falls below the rolling month plus one review batch.

Make a private copy of the current config and Compose file. Create
`state/render-spool` with mode 0700 and ownership 1002:1002. Run a synthetic
render under an isolated Compose project first. Check its video hash and full
decode and inspect the renderer mount list. The worker and renderer share only
the spool. The renderer reaches public HTTPS through the egress proxy, which
rejects private addresses.

Start the renderer and proxy first. For the initial worker run, set
`buffer_create_enabled: false`. Confirm a fresh verified Drive preview and an
unchecked Content row. Check `Daily Calendar` and `Review Log` in Sheets and
`state/health.json` on the VPS. Re-enable Buffer writes after acceptance.
Confirm the approved content has the same exact release in Buffer on all
configured channels and check the next seven days for gaps.

To pause creation and submission, set `paused: true`. To roll back the image,
stop the new worker, restore the saved Compose and config and start the old
worker. Keep the existing state, Google intents, and Buffer receipts for
reconciliation.
