# One central learning Drive with automatic sync

The owner corrected the prior delivery: one central folder in the personal Google account holds learning content for the whole business. Authorization happens once from the tutor dashboard. All tutors and students use that shared server connection. The owner explicitly confirmed continuous automatic syncing after authorization, including existing and future learning content. Preserve the fresh MeaBeclick/Learning skeleton and exclude the stale student folder. Existing customer URLs, authored versions, assignments and progress must remain intact.

The previous OAuth implementation is already global; reuse its encrypted credentials, exact owner/resource validation and browser/session/PKCE boundaries. Finish the missing content writer and dashboard integration. Routine implementation choices below are the builder's choices under the owner's continuing implementation authority.

## User behavior

The dashboard has a branded Hebrew central-storage card, outside individual tutor/student cards. It shows account, central folder link, connection state, whether automatic syncing is enabled, last successful sync and aggregate progress/failures. Connect opens the existing secure flow with copy explaining one shared account. Success enables automatic syncing and queues the first backfill. A previously saved read-only connection needs one activation action. Pause stops future uploads without deleting files; resume/retry is available. No student or individual tutor authorizes a separate account.

A protected status endpoint lets the card refresh while a job runs. A protected manual-sync action queues work and returns promptly. A cron-key endpoint and five-minute host timer perform subsequent passes and resume interrupted work. A restart preserves configuration and last results; incomplete work is retried. Sync failure does not block bookings, lesson generation, student access or submission. Actual personal consent remains an owner-only external action, never claimed completed by synthetic tests.

## Content and visible organization

Capture explicit educational sources only: sanitized student/enrollment profiles; current and historical lessons/materials including private presenter notes; homework, game results, learning assignments/progress/events and plan structure/evidence; library/catalogue metadata; generated lessons, drafts and game JSON; shared learning support/media assets. Preserve source formats and mathematical content. Never copy environment files, OAuth/session/access credentials, PINs, service keys, Codex state, payment data, private calendar feeds or the entire SQLite/database/runtime tree. Do not read prohibited local knowledge-base student/pricing directories.

All artifacts are private staff files under the selected Learning/Students and Learning/Library folders. Create one editable native student-profile Doc per stable student ID; it links to the central register and is not overwritten after creation, preserving teacher narrative. Keep source file/revision snapshots addressable by a deterministic marker/hash, so unchanged data is reused, prior versions survive and manual Drive changes cannot be overwritten. Identical source revisions must not be uploaded repeatedly, including after an interrupted acknowledgement.

Use appProperties namespace derived from owner, selected roots and a versioned sync purpose. Search app-owned records with bounded pagination and reject ambiguous duplicate markers or wrong parents/types/owners. Existing root/templates/demo/reference files are not repurposed. Original content remains intact if a remote file is moved/edited/deleted; flag the conflict instead of updating or deleting human content. Content uploads do not create public permissions or change student publication states.

Add three clearly labelled app-managed tabs to the existing register: Site Students, Site Materials, Site Progress. They show current identity/context/profile links, artifact links/versions and observed progress, without inferring mastery from views. Original five teaching tables and Config stay untouched. Managed tabs are claimed with developer metadata; a pre-existing unclaimed tab with the same name is a conflict. Replace only these managed views atomically, with raw typed cell values, working native links, RTL headings and frozen rows. Manual teacher edits belong in profile Docs and original teaching tables; managed views are explicitly marked as refreshed from the site.

## Worker and reliability

Use a single serialized worker in the existing one-process app; no new queue dependency or educational database. Keep only private operational state (scope, selected/enabled policy, run dates, counts and fixed error codes) locally. Drive markers carry artifact identity; bounded source hashes and checksums distinguish complete content from an interrupted upload. Google failures, duplicate markers, invalid ownership and partial reads never become a successful sync. Do not echo provider bodies or private learner data in logs/status.

Batch/stream file handling to avoid loading the entire content corpus. Bound Google response sizes and call duration; large binary files use resumable uploads. Stop a pass on shared authorization/availability failure, preserve completed work and retry later. Complete, unchanged artifacts are reused; snapshot identity includes source content and artifact role. Source inventory/data validation failure must not replace the last good managed views with partial data. A job begun under one account/root configuration cannot continue writing after that configuration or enabled policy changes.

After central storage is selected, the older business-account lesson synchronizer must not write new learning copies or pull stale edits. Retain its historical files/readers and the independent business backup credentials. Pausing or an authorization error must not silently fall back to business storage. Keep teacher-only content restricted to the master staff folder; no student sharing is added here.

## Acceptance

Tests prove sanitized all-content capture, preserved source bytes/versions, idempotence, restart/uncertain-ack recovery, partial failures, ownership/parent/marker conflicts, managed-tab protection, disabled/revoked behavior, correct shared dashboard state and authorization. Full supported build/typecheck/tests and browser journeys cover owner connect, automatic activation/backfill, pause/retry and a shared connection visible across tutor sessions. Independent bounded review before release. Verify the deployed dashboard and scheduler; real Google transfer is pending until the owner completes the single consent.

This delivery centralizes storage and visibility. It does not silently migrate operational bookings/payments/login to Sheets, replace customer delivery links, convert historical interactive HTML into native Slides, or claim the subsequent native-authoring rollout is complete.
