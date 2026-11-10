# PR-scoped UI verification

Approved scope: the conversation's QA loop, refined to run programmatically for pages affected by each PR. Implement in an isolated worktree; preserve the main checkout's unrelated edits.

## Outcome
A required CI build computes impact from the PR base and tested merge SHA, selects affected user journeys, runs them against a disposable production-mode application, and uploads a readable impact report, browser evidence, and deterministic outcomes. Following the user's clarification, this implementation uses Playwright without an AI service or credential.

## Selection contract
Use the union of base/head static import graphs, including Svelte script imports and aliases. Changes propagate from modules/components to route handlers and pages; layouts affect descendants. Journey contracts declare page/API dependencies because fetch URLs are not static imports. Preserve both paths for renames/deletions. Shared infrastructure, unknown runtime changes, missing diff data, or unmapped affected routes expand to all journeys; documentation-only changes skip UI checks explicitly. Every runtime selection includes a small cross-role smoke test. Never infer that an unrecognised runtime change is harmless.

## Execution and evidence
Add Playwright Test incrementally alongside existing scripts. Seed synthetic families, siblings, learners, homework, and learning material using the existing isolated harness. Exercise real local APIs and SQLite; intercept only controlled failures or third-party services. Start with ten journeys covering guards, teacher create/update, homework publication/submission, parent sibling history, permissions, invitations, payments, and learning. Check persistence after reload and effects across roles. Test phone Chromium and desktop Chromium; use WebKit in CI for selected journeys.

Produce the tested SHAs, changed files, affected routes, selection reasons, pass/fail/skip status, per-journey screenshots, traces, errors, and an HTML report. A skipped or unconfigured AI assessment is never represented as successful AI review. No auto-healing, weakening assertions, approving visual baselines, real customer mutations, scheduled jobs, or additional application UI.

## Integration
PRs run selected journeys in the existing required build job; main/manual releases retain full existing browser suites and run the new journeys in full. Failures block the build and remain evidenced. Upload artifacts even on failure; publish a concise GitHub job summary without creating a new issue for every run.

## Gates
Selection unit tests cover shared imports, API consumers, layouts, deletions/renames, unknown routes, infrastructure, and docs-only changes. Browser tests verify persisted outcomes and user-visible recovery. A controlled defect must fail a selected journey and produce evidence. Production build, warning gate, and independent branch review must pass before delivery.
