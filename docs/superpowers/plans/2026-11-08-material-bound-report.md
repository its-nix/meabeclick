# Material-bound reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** File immutable material-scoped coverage separately from optional understanding and release only assessed practice within the filed scope.

**Architecture:** Migration040 stores append-only report snapshots and assessments. The existing report transaction validates and pins coverage; downstream explicit mode withholds broad practice durably and uses an independent scoped homework assessment. Legacy reporting remains compatible.

**Tech Stack:** SvelteKit, TypeScript, node:sqlite, node:test; existing engine wrapper and prompt sanitization.

**Spec:** docs/superpowers/specs/2026-11-08-material-bound-report-design.md

## Global Constraints

No new runtime dependency. No real customer data, migration deployment, push, merge or rollout. No homework-photo feature. Material topic IDs do not imply universal mastery. Existing brand and RTL conventions. Never add node_modules symlink.

## Review Focus

- A stale window must conflict without writing note/status/coverage.
- Material edits after filing must preserve the pinned source on correction.
- Explicit empty coverage must remain withheld through expiry and engine failure.
- An old async completion cannot publish after a corrected revision.
- Previously released work must survive later explicit corrections.

### Task 1: Immutable filing and validation

**Files:** migration040/list.ts; reports/topics.ts; reports/store.ts; tests/unit/report-topics.test.mjs.
**Interfaces:** eligibleReportMaterials(bookingId), latestTopicReport(bookingId), validateTopicCoverage(bookingId,coverage), persistTopicReport(reportId,coverage); optional expectedRevision/coverage on fileReport.
- [x] Write/run failing tests for explicit zero versus unknown, material/scene/skill membership, immutable snapshot, optimistic correction.
- [x] Implement bounded validation and snapshot append inside report transaction, independent optional understanding.
- [x] Run focused report store and new tests; commit owned files.

### Task 2: Safe downstream practice and generation context

**Files:** reports/after.ts; reports/topic-homework.ts; lessons.ts; learning-store.ts; lesson/prep.ts/queue.ts; learning/model.ts/schema.ts; focused tests.
**Interfaces:** generateTopicHomework(context), assessTopicHomework(context,tasks), scoped after-report path, latest report context on LessonRequest.
- [x] Write/run failing tests for durable withholding, failed assessment, stale async completion and preserving released practice.
- [x] Implement explicit scoped path, no broad game/library fallback, bounded independent assessment with persisted result; pass sanitized latest context and bypass broad library reuse.
- [x] Add optional validated topic manifest with known server-provided skill keys; test invalid/unknown metadata.
- [x] Run focused downstream/generation tests; commit owned files.

### Task 3: Tutor reporting UI and final verification

**Files:** report page loader/form; synthetic browser/characterization tests; sanitized feature docs/ledger.
**Interfaces:** reportMaterials/ topicReport in loader; coverage payload and expectedRevision in report POST.
- [x] Write/run failing UI tests, implement material/manual/legacy selection, complete coverage checklist, comments and independent optional understanding.
- [x] Verify desktop/mobile RTL, comments and downstream scope using synthetic data; run check/build and focused characterization.
- [x] Perform independent whole-change review, resolve important findings with regression tests; commit and return evidence for parent integration.

Execution uses domain ownership: UI and scoped homework helper are independent delegated domains; filing/storage/downstream owned by coordinator. Parent owns targeted artifact repair in another worktree.


## Execution ledger

- 2026-11-08: approved smaller teachable-topic reporting implemented in the dedicated report worktree; no approval loop repeated.
- Task1: material/manual snapshots, all-topic checklist membership, plan membership, private bounded comments and optimistic filing revisions verified RED→GREEN in `report-topics.test.mjs`. Legacy unknown remains distinct from explicit zero. New legacy filings also increment the filing counter.
- Task2: separate generator and bounded independent assessor implemented/committed by the homework domain agent (3614135). Scoped completion, durable withholding through expiry/failure/late insertion, preserved released work, and stale legacy game/homework completion regressions verified RED→GREEN. Known-key topic manifest and fenced future context verified; broad library preparation bypassed in explicit context.
- Task3: reporting UI/helper/browser domain committed by UI agent (6e9a1fa). Material/manual/legacy modes, independent understanding, history, source-version reselection and pinned tutor-only source previews verified. Report form RTL detector clean; dashboard label introduces no new RTL findings (11 unchanged dashboard CSS warnings reviewed); Chrome at1440/390/320 pixels has no overflow or runtime errors. Eight real synthetic filings; expected stale409 only.
- Ruling: explicit coverage cannot be silently downgraded to legacy unknown on correction, because that would re-enable broad expiry/failure release. New manual explicit corrections remain available.
- Ruling: compatible topic provenance is not present in the existing library inventory, so explicit reports/future context conservatively bypass whole-library homework/games/preparation. Cost: additional generation or withheld practice until compatible provenance exists.
- Ruling: legacy materials without a manifest use explicit assignment or an unambiguous booked-time association; ambiguous joins are refused. Cost: tutor uses manual source when historical association is ambiguous.
- Ruling: same-slug current-version reselection sends materialId explicitly; absent/current filed ID preserves the pinned source. Source links render a validated historical plan row rather than the possibly replaced public material.
- Verification:134 focused unit tests pass;31 report/homework characterization tests pass; final production build passes; `check:ci` passes at the existing22-warning baseline,0 errors; `git diff --check` clean.
- Final review: separate author self-review completed for privacy, immutable provenance, revision races, assessment failure, legacy compatibility and preserved released work. Parent owns fresh whole-change review, Linux final integration and any real generation evidence. No remote model calls or real customer data used in this worktree.

- Fresh review P1: reproduced delayed `appendToPortal` publication after explicit zero/partial reports and a correction during its async read. Fixed by carrying the pre-generation filing revision, rechecking current revision/scope after the read, and publishing portal games/evidence synchronously within the final transaction. Existing delivered games remain. All automatic game reuse/publication call sites traced: queue path is now guarded, report-library path already rechecks in its final transaction; deliberate tutor game publishing remains a separate explicit action.
- Fresh review P2: reproduced expired-but-unmaterialized interactive practice stranded by a late explicit report. Filing now assigns already-due held practice before withholding future preparation. Regression verifies identical assigned state with and without a prior family read.
- Review-fix verification: three new regression tests observed RED on the original paths, then GREEN;155 focused tests pass, production build passes, `check:ci` remains at22 existing warnings/0 errors, `git diff --check` clean. No model calls or root-worktree changes.

- Normal merge of frozen root repair commit0e8bbd7 completed as02fd9d3 after the release fixes were committed/clean; root worktree remains untouched.209 focused repair/report tests, build and baseline type check passed after merge.
- Parent visibility review: reproduced RED four-check assessment acceptance without student visibility, false/missing visibility at release, and missing priorCoverage privacy criterion in whole-lesson critique. Added required explicit `studentVisibility` assessment result and fail-closed acceptance, with criteria against private tutor-comment/source disclosures and answer-revealing task text. Honest pass fixtures now include visibility. Added exactly one whole-lesson critique privacy criterion; repair internals and four-call budget unchanged.
- Visibility-fix verification:213 focused repair/report tests pass, production build passes, check:ci0 errors/22 baseline warnings; diff check clean. No real model calls, root changes, push or deployment. Parent owns follow-up independent review and full Linux integration.
