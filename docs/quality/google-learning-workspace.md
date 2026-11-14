# Google learning workspace setup

## Archive and native-workspace cutover

The owner approved archiving the rejected corpus and starting a fresh library.
An operator-only POST to `/api/central-drive-sync` (cron key required) queues the
one-time archive behind any active sync. There is no retirement control on the
ordinary tutor dashboard. It rechecks every original upload, creates a separate
dated native Sheets register including source key, hash, MIME type, size and
Drive ID, and reads all three archive views back. A fresh source fingerprint and
SQLite connection/external-writer revision must still match before a single
transaction records the exact retired slugs and workspace receipt. A failed or
changed snapshot cannot retire data. Repeated activation cannot capture newly
created lessons. A pending job preserves its original fingerprint and slug set;
source changes require explicit operator diagnosis instead of silently widening
the archive. Existing managed source blobs are linked from the archive, never
moved out of the mirror or duplicated merely for folder appearance.

`Teaching workspace` is an app-created sibling of `Website sync`, with a fresh
Library (Presentations, Homework, Interactive games, Teacher notes), Templates,
Review, Archive and a native workspace guide. Original manual folders remain
untouched. Student profiles and progress remain linked to the ongoing mirror.
The website library becomes a small branded hub. Retired masters are unavailable
for reuse and absent from active tutor lists; historical readers, customer
versions, teacher edits, submissions and progress retain their original storage.
Old review indexes redirect to the new workspace.

After cutover the legacy generator, prepare and import paths are disabled,
including their shared publication boundaries. Bookings continue normally and
the tutor dashboard explains that materials are prepared in the new workspace.
This is a fresh native workspace, **not a reviewed native authoring engine**.
Original HTML/JSON is an archive; it is not relabelled as Google Slides. New
automatic authoring and student publication require their separate quality gate.

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

### Native booking preparation draft path — 2026-11-14

Confirmed bookings enqueue a durable student/booking-scoped SQLite job without
waiting for Google. Production startup and a 30-second poll recover queued,
expired-lease and post-activation bookings whose initial enqueue was missed.
Cancellation fences further writes and final review binding. Jobs expose queued,
preparing, needs-preparation, failed, review and cancelled states to the tutor.

`NATIVE_LESSON_AUTHORING_ENABLED=true` opts into private draft authoring; its
default is off. The tutor must explicitly confirm the supported 90-minute
high-school mathematics context: introductory normal distribution, three-unit
35372, percentages/mean understood, normal distribution new, school `s` notation,
and verified summer 2025 question 3. Unknown/unsupported contexts remain visible
as needs-preparation. A previous native review for the learner blocks automatic
repetition. The context is a tutor planning statement, not demonstrated mastery.

The worker uses the encrypted personal `learningService().syncAccess()` and the
verified native-workspace receipt. Native teacher Slides contain their own per-slide speaker notes and answer
keys; separate question-only homework remains in the private Review folder.
New drafts do not create a teacher-notes Doc. The teacher deck is staff material:
sharing a Slides file can expose its notes, so student delivery requires a
separate notes-free artifact. Historical separate-notes receipts stay readable. Activity links target
tutor-authenticated `/app/native-review-activities`; its runtime records no
customer scores. `/api/native-lessons/[bookingId]` is tutor-only, including its
private notes links and explicit context binding. Legacy authoring stays disabled.

The ongoing index receives separate managed `Native Students`, `Native Lessons`,
`Native Materials` and `Native Assignments` tabs. Stable IDs link learner,
booking, material and draft assignment; source IDs and bundle hashes retain
provenance. Existing human edits and historical/archive tabs are untouched.
Identity/URL/hash conflicts stop preparation. Sheets append retries read stable
IDs before writing; an uncertain response can be retried without replacing rows.
Artifact identity includes a checked renderer manifest covering the exporter,
shared maths/diagrams, brand/logo, fonts and dependency lock. Run
`node scripts/native-renderer-manifest.mjs` after changing these inputs; the
regression suite rejects stale manifests. A renderer change creates a new
immutable draft and preserves older native files and human edits.
No progress/mastery row, published material, assigned homework, public sharing,
notification or automatic student release is created by this draft worker.

Focused regressions cover restart recovery, backoff, cancellation, expired-worker
fencing, source continuity, exactly-once final binding, response-loss retries,
linked records and human edits. Seeded Playwright `native-lessons` journeys cover
the real booking enqueue, explicit tutor context UI, unsupported/flag-off states,
private route guards and score-free activities on phone and desktop. These checks
do not establish native Google rendering quality or owner teaching approval;
owner teaching approval remains a separate release gate.

Local verification for this integration: production build passed; 34 focused
worker/context/PR-QA checks passed; all six seeded Chromium journeys passed
across phone and desktop. The activity test makes a real authenticated grading
POST and verifies no customer results, learning events or homework were written.
The migration dependency graph reaches 85 mapped routes with no unmapped
boundaries. Type checking retains the existing 22-warning baseline. Phone
screenshots of the explicit context panel and activity page were inspected for
Hebrew wrapping and horizontal overflow. These are isolated synthetic fixtures,
not a production reliability or native Google teaching-quality claim.

Use native Google editing and presenter tools for the new presentation path. Once native-template generation and the same-lesson comparison pass, the new worker can return Google artifact IDs instead of a parallel editable HTML presentation. The custom presentation editor, notes viewer and duplicate library administration can then be retired for new material. Preserve historical readers and customer links until migration is verified. Keep mathematical validation and custom interactive graphs/games where they supply teaching value.

## Evidence

The actual native register was read back and decoded using the shared contract: one synthetic learner, consistent linked records, repaired native date values and zero published materials. Native table ranges and dropdown column types were verified; the source and a Google-exported XLSX were rendered across all populated tabs. Browser UI verification was unavailable because the browser host was offline, so native metadata/readback plus round-trip rendering supplied the available checks. Native Docs headings, links, content, parent folders and RTL direction are checked independently.

The bounded independent review accepted the scope and identified a timezone-drift defect. A regression failed when the workbook timezone became Asia/Jerusalem; the reader now requires UTC and the focused suite passes. Run the two workspace unit files plus the normal build/typecheck for future changes. A production personal-OAuth CLI read is still pending the separate authorization above.

At f334b3a, supported Linux Node 22 build, type check and all 1,852 tests pass with zero failures/skips and the existing 22-warning baseline. The focused workspace suite has 11 passing tests. The full suite first caught an existing prohibition on UTC timestamp slicing; Sheets civil dates now format their calendar components explicitly, with a near-midnight regression, and the existing UI date policy remains intact. The final independent review reports no unresolved findings.

Twelve newly created folders/files were verified for personal ownership, expected parents and staff-only permissions. Three representative native Docs exports were visually inspected: workspace guide, synthetic student profile and synthetic lesson brief each render as a clean one-page document with Hebrew text and working links. No real student data was read into this bootstrap or written to the new register.

The website connection extension adds synthetic OAuth/persistence/CLI tests and protected-route checks, including a complete callback and repeat verification. Dedicated TLS browser journeys cover both unconfigured access and native connect/verify forms on phone and desktop. A real Chromium check exposed `no-referrer` suppressing Origin on native POSTs: the connection page now uses `same-origin`, while the OAuth callback retains `no-referrer`. The browser regression failed before the correction and passes afterward. The fresh bounded review accepted the implementation and the targeted header correction; real owner consent remains pending.


### Native calibration import verification (2026-11-14)

The synthetic normal-distribution draft was created using the runtime personal
OAuth connection and verified as native Google Slides plus two Google Docs.
Ownership, expected private parent folder and staff-only access were read back
from Drive. All 67 slide builds, two homework pages and 13 private notes pages
were exported back from Google and visually inspected. An initial import exposed
mixed prose/formula overlap; the exporter now measures shipped Heebo glyphs,
authors explicit one-line native runs and reserves text space across reveal
stages. Regression checks cover bounds, non-overlap and legibility on the failed
examples. The corrected Google import passed the same visual review. This is
technical acceptance of a review draft, not owner teaching approval or generic
lesson-generation coverage. Automatic authoring and student delivery remain off.
Private evidence and file IDs are held outside the repository.


### Embedded presenter notes (2026-11-14)

The native exporter attaches a real speaker-notes page to every progressive slide,
including current-build cues, whole-scene timing, the authored spoken explanation,
questions, expected answers, scaffolds, misconceptions and transitions. Relevant
class/source solutions stay with their slides; the final notes page also holds
the private homework/game answer guide. Speaker notes are plain text; common
math notation is made readable without adding projected answer text. New imports
create one teacher Slides file and one homework Doc. Receipt metadata declares
`notesLocation: slides`; Sheets marks the combined teacher deck as staff-only.
Do not share the teacher file as a student resource merely because notes are
hidden during projection. Existing separate-guide files/receipts remain intact.

Google Slides supports native animation in its editor. Its published API request
model does not expose equivalent animation/timeline authoring. Treat automated
PowerPoint animation import as unverified until a real native round trip and
slideshow playback prove it. Prefer brief tutor-controlled mathematical video
demonstrations with a useful static/PDF frame; keep prediction and independent
practice answer-safe. Interactive sliders still use the protected web activities.


### Mathematical animation is part of native authoring

`native-learning/motion.ts` selects eligible worked single-model spread/area
scenes; `bundle.ts` appends a dedicated motion build after their authored static
steps. Identical mathematical plans reuse the first demonstration in the same
lesson rather than adding duplicate loops. The motion builds contain native
editable titles/captions, an embedded labelled GIF and their own speaker notes.
No additional Google API is needed for this verified Drive import path.

Spread has 32 frames at 180ms; area has 32 held school-bound frames at 240ms.
Every frame uses the existing SVG mathematical renderer with fixed axes and
current parameter/probability labels. The static frame remains available before
the loop, and the GIF has an intentional first frame for PDF. Independent tasks,
source questions, comparisons and homework are excluded. Unsupported models keep
their original static representation. Export manifests and private receipts
record scene/slide, kind, frame count, duration and GIF SHA-256; the committed
renderer fingerprint includes the motion helper.
