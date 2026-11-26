# Stable automatic Drive previews

`drive_assets.store(client, item, cfg, state_dir, queue=None)` replaces repeated
preview uploads with one stable Drive binary file per frozen post and schedule
slot. It accepts only `verification_status='ready_for_human'`, requires the actual
creative attestation through `creative_verification.require`, and verifies the
frozen bundle before any external write. Failed candidates never reach Drive.

The work-item key is the frozen job post ID plus the exact scheduled timestamp,
for example `P002@2026-11-15T19:30:00+02:00`. Keep timestamp formatting stable.
A new week/slot creates a distinct work item. Date folders use Jerusalem time.
The visible hierarchy is `Posts/YYYY-MM-DD/Rectangles/Video.mp4` (or `Add18`,
`Mathhelp`, with the post ID as fallback). New folders and the upload use existing
GoogleSync durable intents. No Drive listing, permission broadening, cleanup,
deletions, or moves are performed.

## Configuration and call

```python
cfg = {
    'drive_posts_folder_id': posts_folder_id,
    'drive_work_items': {
        work_item_key: {
            'file_id': existing_canonical_file_id,
            'folder_id': existing_concept_folder_id,
            'short_name': 'Rectangles',
            'expected_md5': independently_verified_head_md5,
            'revision_id': independently_verified_head_revision_id,
        },
    },
}
receipt = drive_assets.store(google, verified_item, cfg, private_state_dir, queue)
```

`drive_work_items` is optional and seeds existing canonical app-owned assets. A
configured mapping is checked once against Drive metadata, then private registry
state becomes authoritative. Do not reuse an existing work item's file ID for a
new slot. The supplied Posts folder must already be accessible through the
existing supported authorization. Missing access blocks preparation; never add
scopes as an automatic workaround.

Receipts expose `file_id`, `revision_id`, `md5Checksum`, `sha256`, `work_item`,
`folder_id`, `webViewLink`, frozen bundle/artifact identity and
`needs_verification`. Keep the receipt in the queue package as `drive_receipt`;
also retain `media_sha256` and the canonical `preview_url`.

## Crash safety and approvals

`drive-assets.json` holds current state, frozen local bundle paths, actual revision
IDs, checksums and revision history. Keep this private directory persistent across
restarts. A local registry lock serializes all operations. Before first creation,
a durable record binds the attempt to one SHA256. Retrying the same SHA uses the
same folder/upload intents and previously verified receipts; changed bytes during
creation are blocked. A private cache creates `Video.mp4` without changing the
immutable bundle. Initial heads are pinned with `drive_versions.pin_head`.

Updates persist `status='updating'` before the media write. A crash or uncertain
outcome blocks all later candidates until explicit provider/registry
reconciliation. This deliberately fails closed if the provider succeeded but the
final local registry save did not. Never delete state to make a retry succeed.
No-change calls still verify the current file checksum, revision ID and retained
revision metadata; they do not upload or create another revision.

Always pass the real queue. A queue review referring to the file with different
media blocks replacement. Approved, submitted, scheduled, published, submitting
and uncertain references block mutation regardless of checksum. The guard
recognizes `drive_receipt`, `drive_file_id`, the canonical Drive preview URL, and
explicit `work_item`/`drive_work_item`. A same-media read-only verification is
allowed. An owner reset/withdrawal belongs to the caller; this module never
silently cancels a queue row or removes owner approval.

`restore_previous(client, work_item, state_dir, queue=None)` restores the preceding
known local frozen artifact through its pinned revision into a new head on the
same ID. Active review/publication references must first be explicitly withdrawn.
It retains history, leaves the work item in `draft`, and returns
`needs_verification=True`. It never restores an approval. A later successful
verification and `store` call can clear this flag after exact head readback.
Configured legacy bytes without a known local frozen bundle are not a rollback
target; only versions recorded by this registry can be promoted automatically.

## Limits

The underlying uploader accepts only 1 byte through 5 MiB. Every replaced and new
head is retained; the provider's 200 pinned-revision limit causes a refusal rather
than history deletion. The registry must have a single shared state directory and
single cooperative writer. Queue inspection and Drive writes do not form one
atomic transaction, so the caller must serialize queue approval with preparation.
Other independent Drive writers can still race after a metadata check. See
[Drive revision limits and official references](DRIVE-VERSIONS.md).

Offline checks from this directory:
`python3 -m unittest test_drive_assets test_drive_versions test_google_sync -v`.
Live acceptance is separate and must use disposable app-owned assets. These tests
do not read credentials or perform external writes.
