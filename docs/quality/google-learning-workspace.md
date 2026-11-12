# Google learning workspace setup

The new learning workspace lives inside the existing personal-owned MeaBeclick Drive folder. Google Sheets holds structured teaching records, Google Docs holds readable profiles and tutor narrative, and Drive owns the artifact files. Marketing, Skills, reference decks and the stale student folder are preserved.

This first delivery is a staff-only skeleton with one labelled synthetic example. It has no real learner imports, published student assignments or automatic booking-time writes. The site's existing customer flows remain active.

## Structure and ownership

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

Approval, audience and publication are distinct. Published material records require a release ID and content fingerprint. The first reader reports these as declared register state only: it does not prove physical immutability or publish a file. Snapshot creation, verified release access and the production writer remain a subsequent step.

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

## What remains to connect

The Drive connector in this chat and the website's OAuth client are separate applications. The bootstrap files were created through the former. The website's tutor-only `/app/library/connection` page now supplies the personal-account consent and verification flow. It needs deployment configuration followed by the owner's actual consent. Per-file authorization does not automatically grant another application's files or all children of a selected folder.

Enable Drive, Sheets and Google Picker APIs in the intended Cloud project. Docs and Slides APIs will also be needed by their subsequent native generation paths. Existing business backups/lesson sync retain their current credentials and ownership. This code does not expose a personal refresh token through the chat.

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

After deployment, open `https://meabeclick.com/app/library/connection`, sign into the tutor dashboard, then choose the personal Google account and all nine displayed items: project root, Learning, register, four functional folders and two templates. The hosted Google Picker uses `drive.file` only, filtered to those exact IDs; there are no external Picker scripts or new CSP exceptions. The token allows editing selected files, but this implementation performs read-only checks and keeps automatic publication off. There is no grant to unrelated personal files.

The callback requires the initiating browser and current tutor session, S256 PKCE and an unexpired single-use flow. It verifies the selected IDs, actual Google account, file owner/type/parent and complete register before accepting credentials. A cancelled/partial/wrong-account/invalid-register reconnection preserves the previous saved connection. Simultaneous checks cannot overwrite a newer connection.

Refresh credentials are AES-256-GCM encrypted in `DATA_DIR/.credentials/learning-google.json`, atomically replaced with mode 0600. Browser responses, URLs and public configuration contain no refresh/access tokens. Stored credentials are bound to the client and workspace identity; rotating the encryption key or changing these identities requires reauthorization. Preserve the key through ordinary deploys; losing it makes the saved token unreadable. Rotating only the same client's secret does not require a new token. Backups of encrypted credentials still need the separately retained key to restore them.

The page shows the last dated verification, not a permanent assertion of access. Use its verification action after editing the register or changing Google permissions. The saved connection can also be tested inside the configured server environment with:

```sh
node scripts/learning-workspace.mjs --connected status
node scripts/learning-workspace.mjs --connected context --student demo-001 --include-demo
```

The OAuth consent application's production/testing status and enabled APIs must be checked in Google Cloud; durable access is not proved by mocked tests. The owner performs the real Google authorization. Real generation/writes and migration remain separate acceptance gates.

The next production step is one serialized, idempotent artifact-publication/event path, using the register as the educational record store. Bookings, payments, login and interactive event capture keep their existing operational persistence. Do not make student submissions depend synchronously on Drive availability.

## Retiring duplicate code

Use native Google editing and presenter tools for the new presentation path. Once native-template generation and the same-lesson comparison pass, the new worker can return Google artifact IDs instead of a parallel editable HTML presentation. The custom presentation editor, notes viewer and duplicate library administration can then be retired for new material. Preserve historical readers and customer links until migration is verified. Keep mathematical validation and custom interactive graphs/games where they supply teaching value.

## Evidence

The actual native register was read back and decoded using the shared contract: one synthetic learner, consistent linked records, repaired native date values and zero published materials. Native table ranges and dropdown column types were verified; the source and a Google-exported XLSX were rendered across all populated tabs. Browser UI verification was unavailable because the browser host was offline, so native metadata/readback plus round-trip rendering supplied the available checks. Native Docs headings, links, content, parent folders and RTL direction are checked independently.

The bounded independent review accepted the scope and identified a timezone-drift defect. A regression failed when the workbook timezone became Asia/Jerusalem; the reader now requires UTC and the focused suite passes. Run the two workspace unit files plus the normal build/typecheck for future changes. A production personal-OAuth CLI read is still pending the separate authorization above.

At f334b3a, supported Linux Node 22 build, type check and all 1,852 tests pass with zero failures/skips and the existing 22-warning baseline. The focused workspace suite has 11 passing tests. The full suite first caught an existing prohibition on UTC timestamp slicing; Sheets civil dates now format their calendar components explicitly, with a near-midnight regression, and the existing UI date policy remains intact. The final independent review reports no unresolved findings.

Twelve newly created folders/files were verified for personal ownership, expected parents and staff-only permissions. Three representative native Docs exports were visually inspected: workspace guide, synthetic student profile and synthetic lesson brief each render as a clean one-page document with Hebrew text and working links. No real student data was read into this bootstrap or written to the new register.

The website connection extension adds synthetic OAuth/persistence/CLI tests and protected-route checks, including a complete callback and repeat verification. Dedicated TLS browser journeys cover both unconfigured access and native connect/verify forms on phone and desktop. A real Chromium check exposed `no-referrer` suppressing Origin on native POSTs: the connection page now uses `same-origin`, while the OAuth callback retains `no-referrer`. The browser regression failed before the correction and passes afterward. The fresh bounded review accepted the implementation and the targeted header correction; real owner consent remains pending.
