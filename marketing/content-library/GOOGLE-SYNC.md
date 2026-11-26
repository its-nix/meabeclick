# Background Google access

## Content-centric approval — 2026-11-16

The authoritative owner view is now Review → Content: one row per exact video, one Listened checkbox, one Approve checkbox and one feedback field. Approval fans out to every connected supported Buffer destination in the existing business organization (Instagram professional accounts and Facebook Pages). The hidden Releases table retains independent delivery records and confirmed receipts; its channel rows are no longer a human review task. Current owner-approved videos carry over under Lior’s explicit instruction. Confirmed Facebook schedules are retained, never duplicated. New versions require a fresh approval. Platform results show partial success and reconciliation states. Feedback polling and publishing remain deterministic; this change adds no model calls. Older channel-approval instructions below are historical and superseded.

**Current status — 2026-11-14:** Connected and verified. The business account completed offline desktop consent; credentials are private on the Mac and configured in the logged-in preparation timer. Sheets API was enabled in the existing OAuth project. Native catalog reads, an unchanged-header write/readback and a hash-verified Drive upload passed. The OAuth app is already In production. Earlier setup limitations below describe the pre-connection state.

`google_sync.py` uses Google's documented REST OAuth refresh route. Connected chat tools are not daemon credentials. Neither `gws` nor `gcloud` was installed on the checked local PATH or standard Homebrew directories on 2026-11-14. No local Google credential content was inspected. Missing credentials remain an external readiness gate.

Create a Google Cloud project, enable Google Sheets API and Google Drive API, configure its OAuth consent screen and your user as an allowed test user, and create a **Desktop app** OAuth client. Download its client JSON outside the repository. For persistent operation, configure the consent app appropriately: Google's external Testing mode may expire refresh tokens after seven days; do not assume this is production ready.

Use the repository's secure consent helper with that downloaded Desktop client. It prints a copyable Google consent URL, validates the loopback callback with state and S256 PKCE, then writes a new private `authorized_user` credential file at mode0600. It never prints refresh tokens or reads credentials from connected chat plugins. It refuses an existing output file. No actual consent has been performed by building/testing the helper.

```sh
python3 marketing/content-library/authorize-google.py --client /absolute/private/desktop-client.json --output /absolute/private/content-machine-google.json --port 9765
```

From Termux/SSH, forward port9765 from the phone to the Mac before opening the printed URL in the phone browser, for example `ssh -L 9765:127.0.0.1:9765 YOUR_EXISTING_MAC_SSH_TARGET`. Run the helper on the Mac in that connection; its callback listener binds only127.0.0.1. Consent waits at most five minutes by default and fails closed on denial, partial scope grants or failed token exchange. Never paste tokens into chat. After consent, set the private config's `google_credentials` to the saved path and run one tick to verify actual Sheet/folder access.

The business already documents a Google Cloud project for existing integrations in `server/README.md`; use the appropriate owner-controlled project/client setup rather than inventing a new account. This helper needs a Desktop client, not the web-login client's secret. Existing Drive backup authorization requests only `drive.file` and does not silently acquire Sheets access for this workflow.

Alternatively, with the Google Cloud CLI installed, use your own desktop OAuth client to obtain supported user credentials through browser consent:

```sh
gcloud auth application-default login --client-id-file=/absolute/private/desktop-client.json --scopes=https://www.googleapis.com/auth/spreadsheets,https://www.googleapis.com/auth/drive.file
```

This creates an `authorized_user` Application Default Credentials JSON under the user configuration directory. Point the daemon's private config to that file and ensure mode `0600`. `google_sync.load_credentials(path)` requires `type`, `client_id`, `client_secret`, and `refresh_token`. Never paste tokens into chat, logs, tracked source or a shared Sheet. `drive.file` access is limited to files this client created or the user explicitly made available to this app; a pre-existing editorial Sheet/folder must be accessible to the configured principal and client. A 403 is a real permission blocker, not a reason to broaden scopes silently.

```python
from google_sync import GoogleSync, load_credentials
client = GoogleSync(load_credentials(private_credentials_path))
snapshot = client.snapshot(private_sheet_id, {
    'Queue': 40, 'Components': 80, 'Recipes': 40, 'References': 40,
}, batch='W003')
```

Bounds are absolute inclusive ending rows, 6..200; each read starts at row5 with headers. Only Queue, Components, Recipes, References and Ideas are allowed. `Ideas:50` captures the existing seven-column backlog with literal-header checks and unique IDs; it does not authorize generation or publication. No student or pricing data is read. Writes preserve Queue A:O and only fill candidate P:Q after an exact A:Q re-read. Google Sheets does not provide a conditional value update here: concurrent edits in the final read/write window cannot be made atomic. A changed readback is uncertain and requires reconciliation. Native owner decisions and original reviewed bindings are never overwritten by this adapter.

`upload` handles 1 byte..5MiB multipart files and verifies stored size and MD5 through metadata readback. Larger files fail before remote submission; resumable upload is explicitly not implemented. No checked active post render exceeded this bound. `write_candidate` and uploads require an ignored private `state_dir`. Submission intent is fsynced before network writes; uncertain outcomes block retries. Inspect the provider and retained intent before resolving a failure; do not delete it simply to retry. Verified receipts are reused rather than duplicated.

No service-account impersonation or `gws` command transport is claimed. Adding either requires real setup and verified behavior. No actual OAuth access, upload or daemon Sheet synchronization has been verified without independently provisioned credentials.

Sources: [Google offline OAuth](https://developers.google.com/identity/protocols/oauth2/web-server#offline), [Cloud CLI ADC login](https://cloud.google.com/sdk/gcloud/reference/auth/application-default/login), [Drive upload types](https://developers.google.com/workspace/drive/api/guides/manage-uploads), [bounded Sheets reads](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/get).

## Automatic workflow documents

The runner refreshes an explicit seven-file allowlist covering the three KB workflow pages, audio workflow, roadmap, runbook and Google setup. It does not scan or upload the repository, credentials, student or pricing data. Because drive.file cannot edit the historical chat-created mirrors, current automatic copies are app-owned files under the project launch folder’s Automated content outputs/Workflow documents. Historical mirrors remain available. The private config binds each source to its exact app-owned file ID.

Unchanged MD5 matches skip uploads. Changed source replaces the same configured file and verifies provider MD5/size. An independent Drive edit blocks overwrite for reconciliation. The read/write guard is not an atomic Drive compare-and-swap guarantee. Local source is authoritative for these automatic copies; edit the repo for continuing changes. Do not delete retained uncertain intents to force retry.

The Releases sync checks for owner edits under its scope lock before recording
an intent. If the check finds an edit, a later poll reads the updated rows and
plans a fresh sync. When a write was attempted and its result is uncertain,
compare the saved prior and desired machine-owned columns with live Releases.
Preserve current owner decisions and feedback during reconciliation.
