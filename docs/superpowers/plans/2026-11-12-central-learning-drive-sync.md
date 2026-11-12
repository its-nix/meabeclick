# Central learning Drive synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** One personal-account connection in the tutor dashboard continuously syncs all existing/future learning content to the central MeaBeclick folder.
**Architecture:** Reuse the global encrypted OAuth connection, an explicit sanitized source inventory, Drive content markers and one serialized background worker. Native managed Sheet views/profile Docs provide human-readable access. Existing operational customer paths remain active.
**Tech Stack:** Existing Node/SvelteKit/SQLite/Google Drive+Sheets REST APIs; no new production dependency.
**Spec:** docs/superpowers/specs/2026-11-12-central-learning-drive-sync-design.md

## Global Constraints
- One configured personal owner/root shared by all tutors/students; select one folder once, automatically bootstrap app-owned children/index; no per-person authorization.
- No credential/payment/database dumps, customer deletions, public sharing or automatic student publication.
- Preserve human Drive content and original teaching tabs; snapshots plus claimed managed views only.
- Persist operational state only; stop on scope/auth changes and retry safely after interruption.

## Review Focus
- A successful remote write with a lost acknowledgement must not create repeated copies.
- A moved, edited or duplicate-marked Drive artifact must not be silently overwritten/reused.
- Corpus/source/API failure must leave previous complete views intact and show failure.
- Pause/reconnect/config change while a job runs must stop further writes and preserve the newer state.
- Revocation or pause after central selection must never reactivate old business-account learning sync.

### Task 1: Safe educational source inventory
Files: new `src/lib/server/central-drive/source.ts`, `tests/unit/central-drive-source.test.mjs`.
Interface: asynchronous `learningInventory()` yields sanitized content/profile descriptors and managed-view rows; pure test fixtures exercise secrets, both lesson stores, versions, files, evidence and runtime media.
- [x] Write a failing capture/sanitization test; implement the explicit schema/file allowlist.
- [x] Add immutable stable fingerprints, file bounds/symlink checks and failure tests.
- [x] Verify focused tests and commit.

### Task 2: Drive storage and serialized worker
Files: new `central-drive/api.ts`, `central-drive/sync.ts`; extend `learning-google.ts`; new API/worker tests.
Interfaces: server-only authorized credential access; scoped Drive marker listing, folders/profile/snapshot uploads and atomic managed Sheet views; queued run/status/enable/pause functions.
- [x] Write failing idempotent storage/worker tests and implement bounded Google calls.
- [x] Test uncertain acknowledgements, conflicts, failed partial inventory/upload, pause/reconnect and restart recovery.
- [x] Integrate explicit saved sync policy with backward-compatible existing read-only credentials.
- [x] Verify focused checks and commit.

### Task 3: Dashboard, automatic triggers and rollout
Files: new shared dashboard card/status/action routes, OAuth callback/connection copy, tutor loader/page, central cron route and host units; legacy drive-sync guard; tests and setup docs.
- [ ] Add failing shared-dashboard/auth/activation/scheduler tests; implement tutor controls and initial consent-triggered run.
- [ ] Add periodic sync and no-business-fallback guard; keep notifications and customer publication untouched.
- [ ] Run complete supported checks, real browser cases and one independent bounded review; fix material findings.
- [ ] Merge/deploy through normal gates; verify live dashboard, scheduler and owner-consent boundary; archive private evidence.
