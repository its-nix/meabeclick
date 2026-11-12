# Personal learning Google connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the owner a safe, usable Google authorization link for the new personal teaching workspace.
**Architecture:** Server-side OAuth/hosted Picker, browser/session-bound single-use state, encrypted durable credentials and an authenticated workspace page. Existing register reader verifies the connection before acceptance.
**Tech Stack:** Existing SvelteKit, TypeScript, Node crypto/fs and Node test; no new dependency.
**Spec:** docs/superpowers/specs/2026-11-12-learning-google-connection-design.md

## Global Constraints
- Existing business `GOOGLE_OAUTH_*`, login scopes/cookies and student/customer paths remain unchanged.
- Dedicated explicit learning config/client/key; only `drive.file`, ten-minute state, maximum50 pending flows, nine exact required resources.
- Secrets remain server-only; failed reconnection preserves prior credentials; automatic publication remains off.

## Review Focus
- Different admin/browser or expired/replayed callback must never exchange a code.
- Valid consent with missing files, wrong owner or invalid register must never replace working credentials.
- Client/workspace/key rotation must not read another saved connection.
- Normal Google login must retain callback behavior and CSP.
- Provider/config/network failure must give useful recovery without exposing secrets or claiming success.

### Task 1: Connection boundary and durable credentials
Files: create `src/lib/server/learning-google.ts`, `tests/unit/learning-google.test.mjs`.
Interfaces: `learningGoogleConfig()`, `startLearningConnection(session)`, `finishLearningConnection(input)`, `learningConnectionStatus()`, `verifyLearningConnection()`, `connectedWorkspace()`.
- [x] Write and run a failing end-to-end synthetic authorization test.
- [x] Implement strict config, hosted Picker URL and bounded one-time browser/session state.
- [x] Add failing cases incrementally; implement token exchange, account/resource/register verification, atomic encrypted persistence and safe reconnect.
- [x] Verify focused tests and commit.

### Task 2: Authenticated connection page and CLI
Files: create `/app/library/connection/+page.server.ts`, `+page.svelte`; modify existing Google callback, library entry link, CLI, test harness blocked credentials and add route characterization/browser coverage.
- [x] Write failing protected-route/callback tests; implement authenticated POST actions and separate learning callback dispatch.
- [x] Add on-brand Hebrew connection/recovery/verification page and library entry link.
- [x] Add explicit CLI connected mode and synthetic coverage.
- [x] Run focused route/browser checks, RTL detector, build/typecheck/full suite; commit.

### Task 3: Review and release handoff
Files: `.env.example`, `docs/quality/google-learning-workspace.md`, deployment docs and task-private config/evidence.
- [x] Document exact private setup, API/client requirements, rotation and remaining personal-consent gate.
- [x] Obtain one fresh whole-diff review; fix material findings with regression tests.
- [ ] Update existing PR, verify required CI gates; complete authorized merge/deploy if configuration/access permits.
- [ ] Verify live guarded page and provider entry; provide full connection URL and precise owner-only remaining step.
