# Google Learning Workspace Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for native implementation. A fresh reviewer checks the workspace contract and delivery boundaries.

**Goal:** Create a personal-account Google learning workspace with linked native records and a safe programmatic context reader.

**Architecture:** A versioned schema drives the Google Sheets bootstrap and a small read-only API adapter. Google owns new artifacts and teaching records; the existing website keeps its operational responsibilities while migration remains explicit.

**Tech Stack:** Existing Node/TypeScript, Google Drive/Sheets/Docs APIs and connector, native Google files, existing test harness. No new production service or dependency.

**Spec:** `docs/superpowers/specs/2026-11-11-google-learning-workspace-design.md`

## Global Constraints

- Use the verified personal-owned MeaBeclick folder; preserve Marketing, Skills and the stale student folder.
- Only synthetic learner records. No customer imports, student sharing or progress changes.
- Dedicated personal OAuth namespace; no fallback to existing business credentials.
- Native Sheets/Docs, stable IDs, explicit schema version and evidence-driven progress.
- Existing customer paths and generation defaults remain usable during migration.

## Review Focus

- Reordered rows/columns must preserve identity; duplicate keys and references must fail clearly.
- A created/viewed artifact must not become independent learning evidence.
- A staff-only artifact must not become a released student assignment.
- Personal Drive ownership must be verified independently from the website connection.
- Workbook conversion and visual inspection must cover every populated tab and native structure.

## Task 1: Versioned record schema and context assembly

**Files:** `src/lib/learning/workspace.ts`, `tests/unit/learning-workspace.test.mjs`.

**Interfaces:** `workspaceTables`, `workspaceProblems(snapshot)`, `learningContext(snapshot,studentId)` and typed records. Headers contain stable keys. The context includes approved relevant artifacts and supported observations, and excludes other students and demo records unless explicitly requested.

- [x] RED tests for reordered columns, valid linked rows, duplicate/missing IDs, broken references, incompatible assignment audiences and unsupported mastery claims.
- [x] Implement bounded parsing and validation with exact field errors.
- [x] Verify the synthetic example and cross-student isolation; commit.

## Task 2: Personal-account API reader and executable CLI

**Files:** `src/lib/server/learning-workspace.ts`, `scripts/learning-workspace.mjs`, `tests/unit/learning-workspace-client.test.mjs`.

**Interfaces:** `workspaceClient({config,fetch?}).readSnapshot()` and `.status()`; CLI `--config <private-json> status|context --student <id> [--include-demo]`. Reads only, bounded ranges, explicit owner check and dedicated credentials.

- [x] RED tests for missing personal credentials, wrong owner, required API grants, bounded reads, malformed Google responses and no writes.
- [x] Implement using the existing token-exchange utility without reusing its business config reader.
- [x] Document configuration and integration commands; run affected checks and commit.

## Task 3: Native Drive skeleton and verified linked example

**Files:** Ignored bootstrap builder/config/evidence; sanitized setup guide in `docs/quality/google-learning-workspace.md`.

- [x] Create and verify Learning/Templates/Library/Students/Review in the existing project.
- [x] Build the register from the shared schema, import as native Google Sheets, add native tables/dropdowns and inspect all populated tabs.
- [x] Create native profile/lesson templates, a workspace guide and one synthetic student profile; verify links, owner and staff access.
- [x] Read back the actual workbook and validate it with Task 1's contract; inspect Google-rendered or round-tripped output.
- [x] Run build/typecheck/affected tests and an independent bounded review; commit code and sanitized documentation.
- [x] Deliver verified workspace/register links, exact connection readiness and the phased code retirement boundary.
