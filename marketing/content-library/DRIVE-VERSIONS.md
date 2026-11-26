# Binary Drive revisions

`drive_versions.py` uses native binary revisions on one stable Drive file ID. It
never creates duplicate names, deletes files/revisions, changes sharing, or moves
assets. The worker must assign one file to each work item (batch/date + slot +
concept), for example `Posts/2026-11-15/Addition/Video.mp4`. A later week's P003 is
a different work item and file.

## Integration

```python
from drive_versions import versioned_upload, list_revisions, restore

receipt = versioned_upload(
    client, frozen_mp4, file_id, private_state_dir,
    expected_md5=last_verified_head_md5, work_item_status='draft')
revisions = list_revisions(client, file_id)
receipt = restore(
    client, original_frozen_mp4, file_id, pinned_revision_id, private_state_dir,
    expected_md5=receipt['md5Checksum'], work_item_status='draft')
```

`client` is the existing `GoogleSync` instance with its independently provisioned
OAuth authorization. No credential discovery or extra network transport is used.
The state directory must persist across worker restarts and be shared by all
writers of that file. Keep it private and outside source control. Receipts include
`id`, `revision_id`, `md5Checksum`, `size`, `sha256`, `status`, and provider fields
such as `webViewLink`. Restore additionally returns `restored_from`.

The expected MD5 is the previously verified Drive head checksum, not the incoming
candidate checksum. Store the returned revision ID and SHA256 with the immutable
local artifact. The caller supplies the real work-item state; only `draft` is
accepted. Approved, submitted, scheduled, published, uncertain and unknown states
are rejected. An explicit owner reset to a new draft and approval revocation are
caller responsibilities. A restore must undergo new verification and owner
review. Exact approval must bind revision ID + SHA256 and never follow a mutable
preview link.

## Preservation and failure behavior

Before a head update the module lists revisions and checks retention capacity,
checks the old head against the expected checksum, pins the previous revision,
and verifies that pin. It updates the same ID using `files.update` with
`uploadType=media&keepRevisionForever=true`, then verifies file identity, new
revision ID, byte size, MD5 and retained revision metadata. A per-file local lock
serializes cooperating writers. Version, revision, MIME, checksum and size are
rechecked immediately before media submission.

Existing `GoogleSync._write` durably records each intent before submission.
Timeouts, response loss or readback failures remain uncertain. Every subsequent
update on that file is blocked, even for changed candidate bytes or a changed
expected checksum. Reconcile the provider history and retained intent manually;
never clear an uncertain record just to retry. A pre-upload race found inside an
already recorded intent also requires reconciliation, even if media was not sent.

Restore checks the named pinned revision against the frozen local bytes and
uploads those exact bytes as a new head. The earlier revision and intervening
history remain intact. It does not download private remote binaries.

## Provider limits and operational limits

Google permits at most 200 retained binary revisions per file. Retained revisions
consume storage; unretained older revisions are typically kept for 30 days, but
may be pruned earlier after 100 unretained revisions. The module retains every
head it replaces and every new head. It refuses an update before capacity would
be exceeded; it never unpins or deletes history to make room. An owner must choose
a new work item/file or separately resolve storage policy.

This adapter deliberately accepts only 1 byte through 5 MiB, matching the existing
bounded simple-upload transport. Larger assets need a separately implemented
resumable uploader. Revision listing is paginated and bounded at 100 pages; an
incomplete head listing is rejected. Native Docs/Sheets/Slides are unsupported.

Drive has no atomic transaction spanning pin, metadata check and media update in
this adapter. Another writer can race after the final metadata read. Readback
catches mismatched media/revisions where visible, but cannot prove no other writer
existed in that window. Use a single writer and keep approved work items immutable.
Changing OAuth permissions, provisioning credentials, work-item allocation,
freeze storage and approval enforcement remain caller responsibilities.

Official references (checked 2026-11-15):

- [Manage revisions and retention](https://developers.google.com/workspace/drive/api/guides/manage-revisions)
- [Update a file and keep its new revision](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update)
- [List revisions and pagination](https://developers.google.com/workspace/drive/api/reference/rest/v3/revisions/list)
- [Get revision metadata](https://developers.google.com/workspace/drive/api/reference/rest/v3/revisions/get)

Offline validation: `python3 -m unittest test_drive_versions test_google_sync -v`
from `marketing/content-library`. Live acceptance must use a disposable app-owned
file: create, update, list pinned history, restore frozen original bytes, verify
same ID and old/new revision metadata. No live writes are performed by these tests.
