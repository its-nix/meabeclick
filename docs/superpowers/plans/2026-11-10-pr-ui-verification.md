# PR UI Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Run evidence-backed UI verification for the pages and user journeys affected by every PR.

**Architecture:** A conservative base/head import graph and route-to-journey registry produce a JSON impact plan. Playwright Test uses the existing disposable app harness and real local data. The existing required CI build executes selected journeys for PRs and full coverage for releases, with artifacts and a job summary.

**Tech Stack:** Node 22.18+, existing TypeScript parser, Playwright Test matching installed Playwright 1.64.1, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-10-pr-ui-verification-design.md`

## Global Constraints
- Preserve unrelated source-checkout changes; work in the isolated workspace.
- Synthetic-only browser writes; no production/model credentials in app tests.
- Unknown runtime impact expands coverage; missing/malformed plans fail closed.
- UI failure remains failure; no skipped broken tests or automatically weakened expectations.
- PR execution is event driven; no scheduler or Todoist integration.

## Review Focus
- Removed imports and renamed pages must retain base-side impact.
- Client fetch dependencies and shared layouts must reach dependent roles.
- A runtime route without a journey must not yield a green empty test selection.
- Failed/aborted browser runs must retain evidence and release temporary processes.
- A doc-only change must visibly skip UI work without claiming UI validation.

### Task 1: Impact selection
**Files:** `scripts/pr-qa/{catalog,impact,select}.mjs`, `tests/unit/pr-qa-impact.test.mjs`.
**Interfaces:** `selectImpact({changedFiles, baseFiles, headFiles})` returns versioned changed files/routes/journey IDs/reasons; CLI consumes git SHAs and writes an impact JSON/Markdown summary.
- [x] Write failing tests for route/component/API/layout impact, deleted/renamed modules, unknown runtime fallback, infrastructure, and docs-only changes.
- [x] Run `node --test tests/unit/pr-qa-impact.test.mjs`; expect missing module/behavior failures.
- [x] Implement graph traversal, conservative fallback, registry, and git-backed CLI.
- [x] Re-run tests; verify actual git diff selection for this branch; commit task.

### Task 2: Executable user journeys
**Files:** `playwright.qa.config.mjs`, `tests/qa/{fixtures,journeys.spec}.mjs`, package files.
**Interfaces:** Playwright filters journey IDs from the impact plan; fixture exposes disposable server, seeded identities, and browser contexts. Tests attach named screenshots and assert persisted, cross-role outcomes.
- [x] Add scenario assertions; run the fixture/config and exercise each scenario against the existing application (initial runs exposed selection, locator and transport failures).
- [x] Add the minimum fixture/config support using the existing harness and real APIs.
- [x] Run selected phone/desktop journeys, then the full journey suite; fix only evidence-backed failures.
- [x] Inject one controlled broken response; prove the selected test fails and retains trace/evidence; revert injection; commit task.

### Task 3: Required CI and evidence
**Files:** `.github/workflows/deploy.yml`, `scripts/pr-qa/report.mjs`, `tests/unit/pr-qa-workflow.test.mjs`, `docs/quality/pr-ui-verification.md`.
**Interfaces:** Existing required `build` job consumes selection, runs selected/full tests, uploads evidence, and writes a job summary even on failure.
- [x] Write failing workflow/report checks for merge-SHA selection, required gate, failed-run artifacts, and safe summary output.
- [x] Wire PR selection and conditional legacy suites; main/manual runs retain complete coverage. Document local replay and the deterministic, credential-free scope.
- [x] Run selection/report tests, production build, warning gate, and browser journeys.
- [ ] Request one independent whole-branch review; fix consequential findings with failing regressions; finish the branch through normal checks.
