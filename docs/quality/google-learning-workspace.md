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

The Drive connector in this chat and the website's OAuth client are separate applications. The bootstrap files were created through the former. The website still needs dedicated personal-account authorization and API access to the selected existing root, Learning folder, register and templates. Per-file authorization does not automatically grant another application's files or all children of a selected folder.

Enable Drive, Sheets, Docs and Slides APIs in the intended Cloud project and grant only the needed files to the website's client. Existing business backups/lesson sync retain their current credentials and ownership. This code does not obtain or expose a personal refresh token through the chat.

The next production step is one serialized, idempotent artifact-publication/event path, using the register as the educational record store. Bookings, payments, login and interactive event capture keep their existing operational persistence. Do not make student submissions depend synchronously on Drive availability.

## Retiring duplicate code

Use native Google editing and presenter tools for the new presentation path. Once native-template generation and the same-lesson comparison pass, the new worker can return Google artifact IDs instead of a parallel editable HTML presentation. The custom presentation editor, notes viewer and duplicate library administration can then be retired for new material. Preserve historical readers and customer links until migration is verified. Keep mathematical validation and custom interactive graphs/games where they supply teaching value.

## Evidence

The actual native register was read back and decoded using the shared contract: one synthetic learner, consistent linked records, repaired native date values and zero published materials. Native table ranges and dropdown column types were verified; the source and a Google-exported XLSX were rendered across all populated tabs. Browser UI verification was unavailable because the browser host was offline, so native metadata/readback plus round-trip rendering supplied the available checks. Native Docs headings, links, content, parent folders and RTL direction are checked independently.

The bounded independent review accepted the scope and identified a timezone-drift defect. A regression failed when the workbook timezone became Asia/Jerusalem; the reader now requires UTC and the focused suite passes. Run the two workspace unit files plus the normal build/typecheck for future changes. A production personal-OAuth CLI read is still pending the separate authorization above.
