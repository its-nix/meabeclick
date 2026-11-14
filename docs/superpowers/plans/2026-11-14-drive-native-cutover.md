# Drive native cutover implementation plan

> **For agentic workers:** Use executing-plans to implement inline; one bounded fresh review at the end.

**Goal:** Verify all old educational content in personal Drive, retire its active bindings, and open a fresh native workspace.

**Architecture:** Reuse the serialized central worker, narrow Drive client and immutable snapshot uploads. A one-time archive action writes a separate archive index and native workspace, checks a fresh source fingerprint, then commits the retirement receipt in one SQLite transaction. Readers use that receipt to exclude retired material; historical readers remain intact.

**Tech Stack:** Existing SvelteKit, Node 22 SQLite, Drive/Sheets APIs. No added packages.

**Spec:** docs/superpowers/specs/2026-11-14-drive-native-cutover-design.md

## Global constraints

- Personal account only, drive.file, staff-only files, no notifications or public sharing.
- Preserve customer source versions, notes, direct historical links, assignments and progress.
- No retirement before complete real upload/readback; no mock-based production activation.
- Preserve existing manual folders and human edits; app-created descendants only.
- Do not call archived HTML a native presentation or activate unreviewed native authoring.

## Review focus

- A sync already running when archive is requested must finish before the archive starts.
- New/edited source during upload must prevent retirement.
- A partial archive must be retryable without duplicating files or retiring any entry.
- A new lesson after cutover must not be swept into the old retirement receipt.
- Stale import/prepare APIs and booking reuse must not resurrect a retired master.

### Task 1: Verified one-time archive

Files: central-drive/archive.ts, central-drive/sync.ts, central-drive/api.ts,
learning-archive.ts, migrations/039_learning_archive.ts and list.ts;
tests/unit/learning-archive.test.mjs, central-drive-sync.test.mjs.

- [ ] Write failing tests for complete manifest, no retirement on failed/changed sources, idempotency and retained history.
- [ ] Run focused tests and observe the failures.
- [ ] Add the archive receipt/schema and the serialized archive operation. Expose verified native file creation through the existing client.
- [ ] Pass focused tests; verify original worker behavior.

### Task 2: Fresh native workspace and retirement boundaries

Files: app/library loaders/view, small DriveWorkspace component, library/store,
library/prepare, library/import, lesson queue, lesson-list API, old review routes;
tests/unit/learning-archive.test.mjs and focused browser/integration journey.

- [ ] Write failing checks for exclusion, legacy import/prepare rejection, retained direct history, and native workspace links.
- [ ] Implement receipt-driven retirement. New workspace page uses shared branding/RTL controls and real verified file URLs.
- [ ] Prevent the legacy generator from recreating discarded content after cutover, with an explicit tutor-facing state.
- [ ] Pass focused browser/integration checks, build, typecheck and supported Linux Node 22 suite.
- [ ] Independent bounded review; fix concrete findings with regressions.
- [ ] Merge/deploy under existing authorization, finish real backfill/archive, verify archive metadata and active-site retirement.
