# Google learning workspace setup

The new learning workspace lives inside the existing personal-owned MeaBeclick Drive folder. Google Sheets holds structured teaching records, Google Docs holds readable profiles and tutor narrative, and Drive owns the artifact files. Marketing, Skills, reference decks and the stale student folder are preserved.

The initial staff-only skeleton and synthetic example remain intact. The central sync now connects once from the tutor dashboard and automatically copies existing and future educational content. The site's operational customer flows remain active; student publication is separate from staff storage.

## Central automatic sync

Open https://meabeclick.com/app/dashboard and use **האחסון המרכזי ב־Google Drive**. Connect the configured personal account once and select only its existing Learning folder. Consent enables automatic syncing and queues the initial backfill. Every tutor sees the same server connection; no student or individual tutor account is connected. An older read-only grant needs **הפעלת סנכרון אוטומטי** once.

The app creates **Website sync** under Learning, with **Library**, **Students** and a native **MeaBeclick — Website sync index** spreadsheet. It does not overwrite or repurpose the existing manual register, templates or demo folders. Each student gets one editable native profile Doc linked to the new index. Later syncs preserve edits to that Doc. The index has three clearly managed views: **Site Students**, **Site Materials**, **Site Progress**. Put human narrative in the profile or a separate tab; the site refreshes only its tagged views, atomically. Unclaimed name collisions fail instead of replacing a human tab.

The inventory includes current/historical lesson versions, private presenter notes, homework, games and revisions, library/curriculum, learning assets and observed progress. Original bytes and formats are preserved; historical interactive HTML is not converted to Slides. Content hashes/Drive markers reuse unchanged copies and preserve older revisions. Moved, edited, trashed or ambiguous managed artifacts stop the run; completed uploads are retained for retry. No automatic public sharing or student publication occurs. Credentials, contacts, payments, private calendars and database dumps are excluded.

The dashboard shows aggregate progress, last full success, errors, pause/resume and retry. Successful consent, server startup and `meabeclick-central-drive-sync.timer` queue serialized background work. The timer calls the cron-key-only `/api/central-drive-sync` every five minutes; authenticated dashboard status/actions use `/api/central-drive`. Private operational retry state lives in `DATA_DIR/.credentials/central-learning-sync.json` (0600), with no learner content or OAuth secrets. Resumable upload URLs in that private file must also stay out of logs and Git.

Once central storage is selected, `/api/drive-sync` and an already-running business sync stop learning transfers permanently, including during pause, revocation or misconfiguration. Business backup credentials and old Drive files remain intact. Bookings, payments, login, delivery links and interactive submissions continue using their existing persistence and never wait synchronously on Google.

Actual owner consent and a successful real Google backfill are separate from synthetic verification. Inspect the dashboard's full-success timestamp after authorization; a successful connection check alone does not prove transfer completion.

## Original manual structure and ownership

Learning contains the register, a short native workspace guide and Templates, Library, Students and Review folders. Templates contains a student profile and a lesson brief. A demo folder under Students illustrates their linked copies. The connected personal account owns the created files, and the existing staff editor inherits access. Students are not granted the master register or teacher templates.

The native register has five linked record tables and a Config tab:

| Tab | Responsibility |
| --- | --- |
| Students | Learner identity, educational context, goals, profile and folder links |
| Materials | Artifact reference, intended audience, review/publication status and release metadata |
| Lessons | Learner, date, goals, delivery status and tutor observation |
| Assignments | Binding between one learner, lesson and material |
| Progress | Skill observation, supporting source, assistance level and timestamp |
| Config | Schema version, verified file/folder/template IDs and connection readiness |

Headers retain stable machine keys inside brackets. Reordering rows or columns is supported; IDs and keys must remain unique. Demo flags cannot cross-link with real records, and demo assignments stay draft. Viewing a presentation does not establish independently demonstrated learning. Progress rows are observations, not an automatic mastery model.

Approval, audience and publication are distinct. Published material records require a release ID and content fingerprint. The first reader reports these as declared register state only: it does not prove physical immutability or publish a file. The central snapshot writer is independent of these manually declared release records; student release/publication remains a separate step.

## Programmatic reader

`src/lib/learning/workspace.ts` defines the shared schema, decoder, reference validation and isolated learning-context assembly. The workbook bootstrap uses that same schema. `src/lib/server/learning-workspace.ts` supplies a bounded read-only Google client. It verifies the OAuth account, owner, root relationships, register identity, UTC timezone and schema before returning records.

Native Sheets date serials are converted into ISO dates/UTC timestamps, independent of locale-specific display formatting. Safe row/column/response limits fail explicitly. Malformed or incomplete reads do not produce a partial context. Errors do not echo Google's response body or tokens.

The dedicated environment variables are:

```text
LEARNING_GOOGLE_CLIENT_ID
LEARNING_GOOGLE_CLIENT_SECRET
LEARNING_GOOGLE_REFRESH_TOKEN
```

There is no fallback to the existing business-account Drive connection. Keep the environment file private and outside Git. A private JSON configuration contains only the verified identity/file IDs:

```json
{
  "version": 1,
  "ownerEmail": "personal-owner@example.com",
  "projectFolderId": "VERIFIED_PROJECT_FOLDER_ID",
  "learningFolderId": "VERIFIED_LEARNING_FOLDER_ID",
  "spreadsheetId": "VERIFIED_NATIVE_SPREADSHEET_ID"
}
```

After connection, run:

```sh
node --env-file=/private/learning-google.env scripts/learning-workspace.mjs --config /private/workspace.json status
node --env-file=/private/learning-google.env scripts/learning-workspace.mjs --config /private/workspace.json context --student demo-001 --include-demo
```

`status` excludes demo records from customer counts and explicitly reports read-only access and automatic publishing off. `context` requires explicit demo access and never broadens learner isolation.

## Google applications and permission scope

The Drive connector in this chat and the website's OAuth client are separate applications. The bootstrap files were created through the former. The website's tutor-only `/app/library/connection` page now supplies the personal-account consent and verification flow. It needs deployment configuration followed by the owner's actual consent. Selecting a folder does not grant access to arbitrary pre-existing descendants. Central sync uses the selected root and app-created descendants, which are eligible under drive.file. The original manual-register CLI still requires its own eligible file grant or explicit-env reader credentials; the single-folder connection does not claim access to that register.

Enable Drive, Sheets and Google Picker APIs in the intended Cloud project. Docs and Slides APIs will also be needed by their subsequent native generation paths. Business backups retain their credentials and ownership. Legacy learning sync is suppressed after central activation. This code does not expose a personal refresh token through the chat.

### Website authorization setup

Configure a Web application client under the explicit `LEARNING_GOOGLE_CLIENT_ID` / `LEARNING_GOOGLE_CLIENT_SECRET` names. The operator may explicitly copy the existing Web-client pair, whose `/auth/google/callback` redirect is already registered; this is not an automatic fallback to business backup credentials. Keep the existing Meet/login redirects registered. The callback dispatches only `learning.` states into the new flow; normal sign-in still requests only its existing identity scopes.

Place the private workspace JSON under the existing data mount, for example `data/.credentials/learning-workspace.json`, and set `LEARNING_GOOGLE_WORKSPACE_FILE=/app/data/.credentials/learning-workspace.json` in the server environment. Extend its existing five fields with these verified identifiers:

```json
{
  "templatesFolderId": "VERIFIED_TEMPLATES_FOLDER_ID",
  "libraryFolderId": "VERIFIED_LIBRARY_FOLDER_ID",
  "studentsFolderId": "VERIFIED_STUDENTS_FOLDER_ID",
  "reviewFolderId": "VERIFIED_REVIEW_FOLDER_ID",
  "studentProfileTemplateId": "VERIFIED_PROFILE_TEMPLATE_ID",
  "lessonBriefTemplateId": "VERIFIED_BRIEF_TEMPLATE_ID"
}
```

Generate a dedicated 32-byte random key, represented as 64 hex characters, and save it as `LEARNING_GOOGLE_TOKEN_KEY` in the private server environment. Do not print it into logs or commit it. Recreate the app using the exact pinned-image environment-rotation procedure in `server/README.md`. An absent/incomplete configuration leaves the page visibly unavailable and does not affect customer flows.

After deployment, open `https://meabeclick.com/app/library/connection` from the dashboard and choose the configured personal Google account and browse to **MeaBeclick → Learning**, selecting the Learning folder itself. Searching for Learning is also supported. The hosted Google Picker requests `drive.file` only and shows the folder tree; the server accepts only the configured Learning ID and verified personal owner. Do not filter the Picker to that one ID, because it hides the parent folders needed for navigation; there are no external Picker scripts or new CSP exceptions. Acceptance enables automatic staff-storage writes. No unrelated personal files or student publication are authorized.

The callback requires the initiating browser and current tutor session, S256 PKCE and an unexpired single-use flow. It verifies the selected IDs, actual Google account, selected folder owner/type/parent and staff-only access before accepting credentials. A cancelled/partial/wrong-account/invalid-folder reconnection preserves the previous saved connection. Simultaneous checks cannot overwrite a newer connection.

Refresh credentials are AES-256-GCM encrypted in `DATA_DIR/.credentials/learning-google.json`, atomically replaced with mode 0600. Browser responses, URLs and public configuration contain no refresh/access tokens. Stored credentials are bound to the client and workspace identity; rotating the encryption key or changing these identities requires reauthorization. Preserve the key through ordinary deploys; losing it makes the saved token unreadable. Rotating only the same client's secret does not require a new token. Backups of encrypted credentials still need the separately retained key to restore them.

Verification failures record only `[learning-google]` plus a fixed error code, stage (`callback`, `token`, `account`, `folder`), HTTP status and allowlisted provider reason in the server log. Raw Google descriptions, response bodies, callback URLs and credentials are excluded. A disabled Drive API is shown as a setup error with a link to the OAuth client’s Cloud project; the project administrator must enable it before a fresh connection attempt. Client-credential rejection and authorization-code rejection have distinct messages. A passing synthetic callback is not proof that real Google consent or transfer succeeded.

The page shows the last dated verification, not a permanent assertion of access. Use its verification action after changing the selected folder or Google permissions. The CLI runs from the server's Git checkout with Node22, not inside the minimal runtime image. Load the private environment and override its container paths with host paths:

```sh
DATA_DIR=/home/meabeclick/mea-beclick/data \
LEARNING_GOOGLE_WORKSPACE_FILE=/home/meabeclick/mea-beclick/data/.credentials/learning-workspace.json \
node --env-file=.env scripts/learning-workspace.mjs --connected status
```

The same invocation accepts `context --student demo-001 --include-demo` instead of `status`. No refresh token is printed by either command.

The OAuth consent application's production/testing status and enabled APIs must be checked in Google Cloud; durable access is not proved by mocked tests. The owner performs the real Google authorization. Real generation/writes and migration remain separate acceptance gates.

The next native-authoring step can build on these central artifacts and observed progress; this sync does not migrate the operational database or make the original manual register the source of truth. Bookings, payments, login and interactive event capture keep their existing operational persistence. Do not make student submissions depend synchronously on Drive availability.

## Retiring duplicate code

Use native Google editing and presenter tools for the new presentation path. Once native-template generation and the same-lesson comparison pass, the new worker can return Google artifact IDs instead of a parallel editable HTML presentation. The custom presentation editor, notes viewer and duplicate library administration can then be retired for new material. Preserve historical readers and customer links until migration is verified. Keep mathematical validation and custom interactive graphs/games where they supply teaching value.

## Evidence

The actual native register was read back and decoded using the shared contract: one synthetic learner, consistent linked records, repaired native date values and zero published materials. Native table ranges and dropdown column types were verified; the source and a Google-exported XLSX were rendered across all populated tabs. Browser UI verification was unavailable because the browser host was offline, so native metadata/readback plus round-trip rendering supplied the available checks. Native Docs headings, links, content, parent folders and RTL direction are checked independently.

The bounded independent review accepted the scope and identified a timezone-drift defect. A regression failed when the workbook timezone became Asia/Jerusalem; the reader now requires UTC and the focused suite passes. Run the two workspace unit files plus the normal build/typecheck for future changes. A production personal-OAuth CLI read is still pending the separate authorization above.

At f334b3a, supported Linux Node 22 build, type check and all 1,852 tests pass with zero failures/skips and the existing 22-warning baseline. The focused workspace suite has 11 passing tests. The full suite first caught an existing prohibition on UTC timestamp slicing; Sheets civil dates now format their calendar components explicitly, with a near-midnight regression, and the existing UI date policy remains intact. The final independent review reports no unresolved findings.

Twelve newly created folders/files were verified for personal ownership, expected parents and staff-only permissions. Three representative native Docs exports were visually inspected: workspace guide, synthetic student profile and synthetic lesson brief each render as a clean one-page document with Hebrew text and working links. No real student data was read into this bootstrap or written to the new register.

The website connection extension adds synthetic OAuth/persistence/CLI tests and protected-route checks, including a complete callback and repeat verification. Dedicated TLS browser journeys cover both unconfigured access and native connect/verify forms on phone and desktop. A real Chromium check exposed `no-referrer` suppressing Origin on native POSTs: the connection page now uses `same-origin`, while the OAuth callback retains `no-referrer`. The browser regression failed before the correction and passes afterward. The fresh bounded review accepted the implementation and the targeted header correction; real owner consent remains pending.
