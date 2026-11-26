# Buffer MCP scheduling

The stdlib transport connects only to `https://mcp.buffer.com/mcp`. It reads the
bearer key from an owned regular non-symlink file with mode `0600`. Keep keys,
discovery snapshots, queue databases and returned provider records in private
runtime storage outside the repository and image. No payload or credential logs
are emitted. Public media directories contain approved MP4 files only.

`BufferMCP.tools()` initializes MCP and caches the exact live input schemas.
`discover_to(path)` refreshes discovery and atomically writes a private snapshot.
Discovery is limited to ten pages / 1,000 tools. JSON and SSE responses are
supported. Redirects, automatic retries and session recovery writes are disabled.
`call()` remains read-only (`get_account`, `list_channels`, `get_channel`,
`get_post`). `account()`, `channels(organization_id)` and `get_post(post_id)`
return the complete MCP envelope. `result_data(result)` decodes its single JSON
object or array, excluding separate `{rateLimit: ...}` blocks. Conflicting data
blocks are rejected.

The Queue integration is:

```python
from buffer_scheduler import verify_connection, schedule

publisher = {
    'provider': 'buffer-mcp',
    'key_path': '/run/secrets/buffer-api-key',
    'organization_id': configured_organization_id,
    'channel_id': configured_instagram_channel_id,
    'public_base_url': 'https://meabeclick.com/content-media',
    'media_root': '/media/public',
}
identity = verify_connection(publisher)  # read-only
receipt = schedule(queue, approved_package_sha256, publisher)
```

`verify_connection(cfg, *, client=None)` requires the configured channel to appear
exactly once in that organization's `list_channels`, then checks `get_channel`.
Both must identify the same connected, unlocked Instagram business/creator
channel. The detailed organization must match; the queue must be unpaused and
Instagram `defaultToReminders` must be false. Facebook is deferred.

`schedule(queue, key, cfg, *, client=None, public_fetch=None)` returns a verified
receipt or raises `ValueError`/sanitized `BufferError`. The injectable client and
public fetcher support offline verification. Production verifies public bytes by
HTTPS without redirects or credentials, with a 30-second timeout and 100 MiB cap.
The package must already have current exact approval for the configured Instagram
channel and a future schedule. It is never approved or edited by this adapter.

The adapter stages frozen media through `media_outbox.stage`, verifies the public
asset SHA256, and validates its bounded payload against live `create_post` input
schema before `Queue.begin_submission`. The payload uses automatic,
custom-scheduled publication, the approved caption/time, one video URL and
Instagram reel metadata (`type: reel`, `shouldShareToFeed: true`). Only then does
it persist the uncertain intent and make one internal `_write('create_post', ...)`
call. `_write` permits no other tool and validates the schema again. The public
`call` method does not expose writes.

The returned MCP envelope is stored as a `buffer_response` event in the private
Queue database before receipt parsing. A receipt requires an actual 24-character
hex post ID, scheduled status, exact channel and caption, equivalent scheduled
instant, the exact video URL (including documented saved-asset `source` spelling)
and reel settings. Only recognized direct post or `{post: ...}` envelopes are
accepted. Extra or unknown shapes remain uncertain and require reconciliation
using the saved response.

A timeout, network error, provider rejection, mismatched response or failure to
store the receipt leaves the intent uncertain. Repeated calls and process
restarts cannot submit that job again. The daily worker can recover from a failed
confirmation by checking a matching saved response and reading the same post ID
with `get_post`. It verifies the exact schedule, asset, caption and reel settings
before storing a receipt. When the saved response is missing or cannot be matched
to the approved content, scheduling remains held for reconciliation. Staged
bytes stay retained under the outbox's publication-retention rules.

Run offline checks from `marketing/content-library`:

```sh
python3 -m unittest test_buffer_mcp test_buffer_scheduler test_media_outbox
```

References: [Buffer MCP tools and saved-record behavior](https://developers.buffer.com/guides/integrations/mcp.html),
[Buffer setup](https://developers.buffer.com/guides/integrations/other-ai-tools.html),
[MCP transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports),
[MCP lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle).
