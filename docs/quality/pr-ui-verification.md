# PR UI verification

Every PR runs deterministic UI checks in the existing required `build` job. No AI API key or new service is needed. This is a set of executable product contracts, not an autonomous judgment that every possible UX issue has been discovered.

## How selection works

`scripts/pr-qa/select.mjs` compares the PR base with the merge checkout that CI builds. It traces static imports in **both** snapshots, so shared components, server modules, removed imports and renamed files retain their impact. Svelte route groups, aliases and descendant layouts are supported. `catalog.mjs` declares the page/API-to-journey boundaries that imports cannot express (for example, the portal API feeds both parent and student views).

The affected journeys run on phone Chromium, desktop Chromium and phone WebKit. A cross-role guard/dashboard smoke test always runs for runtime changes. Broad infrastructure changes and unresolved runtime dependencies run all journeys. Documentation-only changes explicitly skip browser checks. An affected route absent from the catalog fails selection until coverage is added: running old tests cannot certify a new page.

The existing Google onboarding, learning/review, tutor workspace and charts scripts run when their corresponding journeys are selected. The legacy responsive/contrast matrix visits the affected pages directly for selected PRs, and visits every seeded page for full selections. A declared matrix page with no seeded visit fails the check. Releases and manual runs select everything. Unit tests, type checks, production build and Docker checks remain required.

## What the checks prove

The initial twelve journeys cover role guards, booking keyboard interaction and failed availability recovery, teacher creation and failed-save recovery, profile persistence, homework publication and submission across roles, sibling navigation/back/forward/reload, family isolation and session loss, WhatsApp invitation preview/single use, payment persistence and family balance, learning correction/progress persistence, and library search recovery.

Each test starts its own production-mode app with disposable SQLite data. Initial facts are synthetic; user actions go through browser controls and real local APIs. Database reads and separate role sessions verify saved outcomes. Controlled failures are intercepted deliberately. External services cannot contact real customers or incur model costs. Google behavior is tested by the existing locally signed fake-provider journeys; provider outages or changes still require separate operational monitoring.

Screenshots and horizontal-overflow checks provide evidence, rather than claiming a comprehensive visual-design assessment. Add specific layout/accessibility assertions when those behaviors are part of a change. Automated traversal alone cannot determine the correct parent, payment or learning result.

## Local replay

Requires Node 22.18+ and the normal project dependencies:

```sh
npm ci
npm run build
npx playwright install chromium webkit
node scripts/pr-qa/select.mjs --base <full-base-commit-sha>
PR_QA_PLAN=.qa-results/impact.json QA_WEBKIT=1 npm run test:qa
QA_SELECTION_OUTCOME=success QA_RUN_OUTCOME=success QA_WEBKIT=1 npm run test:qa:report
```

Use `node scripts/pr-qa/select.mjs --all` for a full selection. Without `PR_QA_PLAN`, `npm run test:qa` runs all twelve journeys; `QA_WEBKIT=1` adds WebKit locally. `--project chromium-phone --grep 'homework-submit:'` narrows a debugging run. A narrowed run does **not** satisfy the complete selected gate.

The browser harness uses a disposable HTTPS proxy to exercise production secure-cookie behavior consistently in Chromium and WebKit.

Selection records the tested SHA and whether the working tree contains local edits. A supplied stale, malformed or uncovered plan fails before tests run. Do not reuse results from a different run. In CI the report consumes the actual selection/browser step outcomes and fails on missing, skipped, flaky or interrupted coverage.

GitHub's job summary includes changed files, affected routes, selected journeys and executed scenarios. Download `pr-ui-verification` for `impact.json`, `summary.json`, the Playwright HTML/JSON reports, screenshots and failure traces. Replay a trace with `npx playwright show-trace <trace.zip>`. Artifact retention is fourteen days; evidence contains synthetic accounts only.

## Adding coverage

For a new flow, add a journey ID and its page/API boundaries to `catalog.mjs`, implement its assertions in `tests/qa`, and add impact-selection examples for shared dependencies. Extend an existing journey when the behavior belongs to that contract. Each confirmed bug should gain a deterministic regression assertion.

Keep retry count at zero. Do not fix a red build by weakening assertions, skipping a broken test or approving a changed screenshot blindly. Reproduce the behavior, determine whether the application or test contract is wrong, fix the cause, then rerun the affected selection.
