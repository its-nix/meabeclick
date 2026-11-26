# Approved media route (prepared; separate deployment)

`compose.media.yaml` is an optional overlay for the content-machine project. It adds a Caddy sidecar on the existing site's external Docker network without modifying the worker, production Compose, or production Caddyfile. It binds no host ports. `Caddy.site-media.snippet` is a proposed route inside the existing HTTPS site; review and validate the combined site configuration before reload.

Provision `/home/meabeclick/content-machine/media/` as uid/gid 1002, mode 0700, and its `public/` child as uid/gid 1002, mode 0755. Frozen artifacts, source, manifests, receipts, SQLite and secrets belong in private `state/` or `secrets/`, never under `media/public/`. The sidecar mounts only the public child read-only and its own Caddy configuration. The worker mounts the media parent writable. Only `media_outbox.stage` may write public files; each approved file is `<64 lowercase SHA256 hex characters>.mp4`, mode 0644. Staging verifies frozen content and exact current approval before making bytes visible atomically. A filename alone is not approval: do not manually copy files into this directory.

Copy these three files beside the existing content-machine `compose.yaml`: `compose.media.yaml`, `Caddy.media`, `Caddy.site-media.snippet`. Set `CONTENT_MACHINE_SITE_NETWORK` to the existing Docker network used by the site Caddy service. Read the actual network from the site's existing configuration or container inspection. Do not create a replacement site network or restart the site project. The sidecar DNS alias `content-machine-media` must be unique on this network.

Before starting anything, validate the merged content-machine configuration:

```sh
cd /home/meabeclick/content-machine
export CONTENT_MACHINE_SITE_NETWORK=ACTUAL_EXISTING_SITE_NETWORK
docker compose -p content-machine -f compose.yaml -f compose.media.yaml config --quiet
docker compose -p content-machine -f compose.yaml -f compose.media.yaml run --rm --no-deps media caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

The official Caddy 2.11.4 Alpine image is pinned by its multi-platform digest. Its binary carries a NET_BIND_SERVICE file capability; the sidecar retains that bounding bit so the kernel permits execution under uid 1002. `no-new-privileges` prevents gaining capabilities, and it listens on unprivileged port 8080. All other capabilities are dropped.

The sidecar allows only GET/HEAD for a single hash MP4 path. All other paths or methods return 404; missing hash files also return 404. Directory listing is disabled. HTTP range requests support Buffer's video fetches. No access log is configured. The internal server uses plain HTTP on port 8080; the existing site Caddy terminates public HTTPS. The outbox `public_base_url` must be the exact public HTTPS origin plus `/content-media`, with no query, credentials or fragment. The `handle_path` route strips `/content-media` before proxying.

After the route change is approved, start only the sidecar:

```sh
docker compose -p content-machine -f compose.yaml -f compose.media.yaml up -d --no-deps media
```

Validate the full proposed site Caddyfile with the existing site's own Caddy image/container (`caddy validate --config ... --adapter caddyfile`). Back up the active site configuration before changing it. Add the snippet inside the intended HTTPS site's block and before any catch-all proxy, then reload Caddy using the site's established process. No source file here changes the live site automatically. Confirm the main site still returns 200 before and after reload. A temporary unpublished file must not be used for public testing: use one exact-approved outbox file and compare downloaded SHA256 against the package's media SHA256. Check HEAD and a Range GET (206), then verify `/content-media/`, `/content-media/manifest.json`, `/content-media/source/index.html`, `/content-media/../state/queue.sqlite3` (use curl `--path-as-is`) and a nonexistent hash MP4 do not expose any private bytes. Requests may be rejected by the outer site's existing security rules before reaching the sidecar.

Keep the Mac worker timer until the independent runtime/sync and single-writer handover gates pass. Public routing does not authorize social scheduling. The outbox keeps bytes across restarts; cleanup requires a bound provider receipt with published status and a timezone-aware `published_at`, plus seven days by default. Any related Instagram/Facebook job pending or within retention holds the shared media. To roll back routing, restore/reload the previous site configuration first, confirm the site is healthy, then stop only the media service. Preserve `media/public/` while any scheduled or uncertain provider fetch may remain.

Caddy syntax references: [request matchers](https://caddyserver.com/docs/caddyfile/matchers), [file_server](https://caddyserver.com/docs/caddyfile/directives/file_server), [handle_path](https://caddyserver.com/docs/caddyfile/directives/handle_path).

Run the bounded local Docker checks without touching the VPS:

```sh
RUN_MEDIA_SERVER_TESTS=1 python3 -m unittest discover -s marketing/content-library/vps -p test_media_server.py
```

These create and remove a temporary local container and fixture directory, verify the merged overlay's read-only mount/network boundary, then check exact downloaded bytes, HEAD, Range 206 and denied routes/methods. They bind only a random localhost test port; deployment binds no host ports.
