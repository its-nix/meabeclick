# Tutor metrics shell — engineering handoff

## Outcome and approved boundary

Implemented Lior's Option C from task `t_e537982b`: a read-only Hebrew RTL definitions/targets shell at `/app/metrics`, linked from the existing tutor dashboard navigation. This is **not** a live metrics dashboard, baseline, health check, or learning-outcome assessment. All 14 actuals and all observation timestamps remain null/UNKNOWN; the UI explicitly renders UNKNOWN / NOT_AVAILABLE, never a missing-as-zero value.

The existing dashboard operational queues, existing statistics, private student tools, authentication infrastructure, lesson-generation reliability gate, database schema, services and dependencies are unchanged. The only dashboard change is one navigation link. Existing dashboard statistics/source discrepancies identified by the audit are **not corrected or re-certified** in this restricted shell implementation.

The dedicated route was chosen to avoid invoking the existing dashboard's roster/learning/ledger sources just to display static definitions. Its server loader calls `requireAuth` and sets `Cache-Control: private, no-store`, then returns an empty object. No source-reading imports, API, aggregate calculations, writes, timers, tracking, export or new persistence were added. Standard app startup hooks still initialize the existing application's SQLite as before; this is not a claim to have removed that global behavior.

## Approved sources consumed

- Repository `CLAUDE.md`, `PRODUCT.md`, `server/README.md`.
- Metric audit `t_eca44346`: `.worktrees/t_eca44346/audit/dashboard-metrics-baseline.md`; SHA-256 `7e126d66229edebe7129f3888bed71d11ba631822006ef0f2feccdfdb35dbf11`.
- Independently reviewed UX spec `t_a68f7278`: `.worktrees/t_a68f7278/docs/superpowers/specs/2026-10-28-tutor-metrics-dashboard-ux.md`; SHA-256 `a502ed1630addfcd7b62e8d77b4afefbe732cdf04518512ce1e0e263a6619a8e`.
- Lead's recorded Option C authorization and correction confirming this canonical isolated worktree.
- Clean branch fast-forwarded to fetched `origin/main` `1f288bfcb0215d2a9e3658dd3ea74c80f77a4edb` before implementation. No claim this revision runs in production.

## Changed surface

- `src/lib/tutor-metrics.ts`: static contracts, targets and null observations, with operations/business/private-learning groups.
- `src/routes/app/metrics/+page.server.ts`: existing shared-admin guard; empty data; no-store.
- `src/routes/app/metrics/+page.svelte`: semantic single-H1 page, native disclosure reasons, explicit actual-vs-target and unavailable freshness, source request, UTC rolling-window/Jerusalem month distinction. The reliability gate is explicitly required **now**, not postponed to the dated business targets.
- `src/routes/app/dashboard/+page.svelte`: one nav link; no operational reshuffle.
- `tests/unit/tutor-metrics.test.mjs`: null/missing contract and no-source/no-calculation/no-tracking/no-record-input constraints.
- `tests/characterization/tutor-metrics.test.mjs`: synthetic SSR, anonymous/account/student/expired tutor denial, no-store, no observation leakage despite populated synthetic student/payment records, missing-vs-zero, target separation, empty server payload, bounded SSR/payload, dashboard entry and logged-out denial.
- `tests/browser/tutor-metrics.mjs`: repeatable synthetic-only engineering browser smoke; external requests blocked. Uses an already-installed Playwright module without adding dependencies.

## Verification

Executed against the production build and synthetic test harness only:

```sh
npm ci
npm run build
node --test tests/unit/tutor-metrics.test.mjs tests/characterization/tutor-metrics.test.mjs
npm test
npm run check:ci
git diff --check
PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs EVIDENCE_DIR="$TMPDIR/metrics-evidence" node tests/browser/tutor-metrics.mjs
```

- Focused tests: **3 passed / 0 failed**. Initial RED demonstrated missing definitions, then absent route (404 instead of required auth redirect); additional RED caught a misleading dated reliability-gate caption, corrected to an immediate required floor.
- Full suite: **1,608 passed / 0 failed / 0 skipped**. First full run caught newly hardcoded tutor-name copy; generic tutor wording restored the repository's roster-data rule. No baseline or warning ceiling changed.
- Build: exit 0. `check:ci`: exit 0, **22 existing warnings at baseline**.
- Performance constraints exercised: authenticated static SSR below 2 seconds, document under 60 KB. These are synthetic regression bounds, not production latency measurements.
- Chrome **148.0.7778.96**, Playwright-core **1.50.1**, local synthetic harness. Viewports 320×800, 390×800, 1440×900: page width equals viewport width. 200% root text reflows without horizontal overflow. Fourteen explicit unavailable actuals; no `/api/` requests from the metrics page; no browser JS errors. Native Enter disclosure opens; visible solid 3px focus ring; summary height 44px. Removing synthetic session and reloading returns to sign-in with no metric cards.
- Inspected synthetic phone/desktop screenshots, metric-card screenshot, expanded reason/focus screenshot, and 200% text screenshot. No real records, saved browser credentials or production data used.
- SSR integration covers no-JS content. Calculations, runtime zero denominators, DST algorithms, loading/error/stale fetching states: **NOT_APPLICABLE to Option C**, because no metric calculations/source readers/fetch state machine are authorized. The static contract explains these distinctions; future actual-value implementation needs its own tests and approval.
- Manual screen reader/axe/full keyboard route review and independent UX verdict: **NOT_RUN here**; downstream `t_119467c6` owns independent UX/browser assessment. Engineering smoke is not conformance or independent approval.
- Hosted exact-head CI: **NOT_RUN**. Completion contract is `local-only`; no publication approval was supplied, so no push, PR, workflow dispatch, merge or deploy. Local exact-head gates and immutable candidate SHA are recorded on the task handoff. Publication, followed by exact-head hosted CI, remains approval-gated.
- Install reported 9 existing dependency advisories (6 low, 3 high); no dependency versions/lockfile changed or audit fix attempted in this focused task.

## Reliability/privacy and next gate

No production database, protected KB, backups, secrets or credentials were read. Only synthetic harness databases were written for testing. Business/operations definitions remain visibly separate from private learning definitions; no individual learning evidence is accepted or serialized by this page. Shared-admin auth is preserved, not expanded into new roles/per-tutor partitions.

Independent UX review is already pre-created as child `t_119467c6`; parent phase completion releases it. Preserve the branch/worktree and use the exact candidate commit from the task metadata when reviewing (do not review a fresh origin/main checkout). Before any actual values ship, Lead/Lior must authorize a privacy-filtered aggregate-only baseline with source/window/denominator/coverage/freshness decisions. Before public PR/push, obtain publication approval; then verify required hosted CI at the exact published head. No merge/deploy authority is implied.
