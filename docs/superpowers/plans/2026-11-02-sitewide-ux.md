# Sitewide UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Resolve all 15 approved usability findings and give tutors an actionable operational overview.

**Architecture:** Refine existing Svelte routes and shared components without replacing the visual system or server workflows. Share safe return navigation where several tools need it; otherwise keep changes local. Use existing domain and ledger state rather than introducing competing client models.

**Tech Stack:** Svelte 5, SvelteKit, TypeScript, Node test runner, existing browser harness.

**Spec:** `docs/superpowers/specs/2026-11-02-sitewide-ux-design.md`, incorporating `anti-slop/audit-001-2026-11-02.md`.

## Global Constraints

- Implement findings 1-15; tutor default is operational overview.
- Keep Hebrew RTL, Heebo, existing blue/neutral tokens and native familiar controls. No brand redesign, new dependency, new asset or dark-mode project.
- Meet the product's 16px form-input floor and 44px action targets in affected workflows.
- Preserve manual payments, save versus publish, scoped access confirmation and existing authorization.
- Do not create production bookings, issue production access, publish, generate lessons, change payments or submit reports to verify this work.
- Do not commit real names, contact details, balances, tokens or credentials.
- Preserve unrelated root changes; get consent before creating a worktree. Commit only reviewed task files.

## Review Focus

1. Overlapping or failed refreshes: no stale response replaces newer confirmed ledger data, and unknown never appears paid. Task 2.
2. External, malformed or nested return URLs: no open redirect, API action or lost library filters. Task 1.
3. Empty plans, hidden skills and changed subject: visible filters retain their existing semantics and recoverable empty state. Task 3.
4. Failed saves and dirty local game switches: attempted text survives; cancel leaves the entire current draft unchanged. Tasks 2 and 4.
5. Multi-child/self-paying families and reduced motion: no cross-child data or student exposure to private notes, and pause never defeats reduced-motion preference. Tasks 5 and 6.

---

### Task 1: Preparation-first library and safe tutor navigation

**Files:** Modify `src/lib/safe-next.ts`, `src/routes/app/library/+page.server.ts`, `src/routes/app/library/+page.svelte`, `src/routes/app/games/+page.svelte`; create `src/lib/tutor-return.ts`, `tests/unit/tutor-return.test.mjs`; modify `tests/unit/library-page.test.mjs` and `tests/unit/safe-next.test.mjs`.

**Interfaces:** Produce `safeTutorReturn(raw: string | null, origin: string, fallback = '/app/dashboard'): string`. It reuses `safeNext`, accepts only dashboard, learner, library, plan, report, game-catalog and lesson-editor page destinations, and preserves pathname/search without fragment. Consumers pass `returnTo` as an encoded query value. Library URL state uses `template`, `topic`, `status`, `search`, `page`; page size is 25, invalid pages normalize to 1, and result changes clamp the page.

- [x] Add tests `safe tutor returns reject external and action destinations`, `library renders preparation before catalog`, `library filters remain outside scroll region`, `library pages preserve filters`, and `poll failure exposes stale status and retry`. Assert no silent fetch catch and no unrelated filter changes to due-skill preparation or full-topic bulk work.
- [x] Run `node --test tests/unit/tutor-return.test.mjs tests/unit/safe-next.test.mjs tests/unit/library-page.test.mjs`; confirm new assertions fail before code.
- [x] Implement the helper, visible preparation queue, independent filters, bounded catalog, URL state and refresh error/retry. Pass encoded library context to editor links and provide a safe game-catalog back path.
- [x] Rerun the same tests; expect zero failures. Verify no-results reset, last-page clamp and preserved full-topic semantics.
- [x] Commit only this task's files: `fix: make preparation work findable and preserve tutor context`.

### Task 2: Operational tutor workspace and trustworthy ledger

**Files:** Modify `src/routes/app/dashboard/+page.svelte`, `src/lib/server/tutor-workspace.ts` only if existing loading facts require it, `tests/unit/tutor-dashboard-polish.test.mjs`, `tests/characterization/dashboard-card.test.mjs`; create `tests/unit/tutor-workspace-ux.test.mjs`.

**Interfaces:** Consume existing workspace data and session-aware requests. One learner ledger destination owns activity/charge refresh and explicit loading/error/success state. Keep existing API request/response shapes and server-confirmed totals. No new public API.

- [x] Add regressions for actionable overview before roster, all five phone-safe destinations, named native homework inputs, a single ledger, unknown-before-load, failed-refresh recovery and retained failed-note draft with adjacent retry/status. Assert cancelled deletion/charge void sends no request. Test overlapping refresh protection where asynchronous state can race.
- [x] Run `node --test tests/unit/tutor-dashboard-polish.test.mjs tests/unit/tutor-workspace-ux.test.mjs`; confirm relevant new assertions fail.
- [x] Replace equal-counter emphasis with attention/upcoming sections and direct learner actions. Use full learner working width; make navigation keyboard-complete and payments phone-safe. Consolidate duplicate payment UI and refresh paths. Preserve note drafts and explicit destructive confirmations. Apply 16px inputs and 44px action targets within affected controls.
- [x] Run the focused tests and `node --test tests/characterization/dashboard-card.test.mjs` against the rebuilt application; expect zero failures.
- [x] Commit only this task's files: `fix: prioritize tutor operations and unify learner payment state`.

### Task 3: Visible learning-plan filtering and report continuity

**Files:** Modify `src/lib/components/LearningPlanTree.svelte`, `src/routes/app/plan/[code]/+page.svelte`, `src/routes/app/report/[booking]/+page.svelte`; create `tests/unit/learning-plan-filters.test.mjs`; modify existing related plan/report tests only when their old UI contract is superseded.

**Interfaces:** Add optional `filter?: FilterKind` defaulting to `all` to `LearningPlanTree`. Skill inputs preserve existing `changed`, `recommended`, `blocked` facts; filtering uses the existing `PlanTree` semantics rather than recomputing recommendations. Consume `safeTutorReturn` and preserve learner/subject context. Report success remains `filter=changed` and carries safe return context.

- [x] Test all five filters on the visible tree, hidden-skill exclusion, empty results, subject changes and report success. Assert matched children retain their topic/branch context and long labels wrap without hiding status actions.
- [x] Run `node --test tests/unit/learning-plan-filters.test.mjs tests/unit/plan-view.test.mjs`; confirm new visible-filter assertions fail.
- [x] Wire visible filter controls and tree facts; remove obsolete hidden filter duplication only where replaced. Repair contextual back links and affected input typography without changing report approval or status API semantics.
- [x] Rerun the focused tests plus existing report/plan suites identified by `rg --files tests`; expect zero failures.
- [x] Commit only this task's files: `fix: restore visible learning filters and report context`.

### Task 4: Manageable editing and protected local drafts

**Files:** Modify `src/routes/app/lessons/[slug]/edit/+page.svelte`, `tests/unit/lesson-editor-page.test.mjs`; add editor interaction coverage to `tests/characterization/lesson-editor-api.test.mjs` where server behavior is involved.

**Interfaces:** Consume `safeTutorReturn`. Retain existing draft save, publish, preview and version APIs. Local `editGame` changes selection only after dirty-draft confirmation; cancellation changes no draft fields or saved baseline.

- [x] Add tests for persistent actions/status, independently collapsible editor sections, safe library/learner return, dirty-switch cancellation and explicit save-versus-publish. Keep preview sandbox, version-load and answer-key privacy assertions.
- [x] Run `node --test tests/unit/lesson-editor-page.test.mjs`; confirm new assertions fail.
- [x] Add a persistent action area, manageable native editing disclosures and the local dirty-game guard. Avoid duplicate competing save handlers and keep keyboard focus visible above/below sticky controls.
- [x] Rerun editor unit/API tests; expect zero failures. Exercise dirty switch cancel/confirm in the disposable browser fixture during Task 7.
- [x] Commit only this task's files: `fix: keep lesson saves reachable and protect game drafts`.

### Task 5: Family information hierarchy and distinct progress

**Files:** Modify `src/routes/app/parent/+page.svelte`, `src/routes/app/student/+page.svelte`, `tests/unit/parent-portal-navigation.test.mjs`, `tests/unit/parent-empty-state.test.mjs`, `tests/unit/family-pages-truth.test.mjs`; create `tests/unit/family-progress-hierarchy.test.mjs`.

**Interfaces:** Existing family loaders, child selection and scoped access behavior remain unchanged. Homework submission progress is shown once; skill-based learning progress is separate and explicitly labelled only when distinct.

- [x] Test parent next lesson/progress before repeated access and finance details, single homework-based summary, distinct skill mastery, empty states, multi-child selection and self-paying rendering. Keep private parent-note and role-boundary coverage.
- [x] Run the task's unit tests; confirm new hierarchy/duplication assertions fail.
- [x] Reorder meaningful parent content and disclose repeat administrative details. Remove only the duplicate homework-derived progress block, retaining distinct learning evidence and confirmed completion/undo behavior.
- [x] Rerun task tests plus `tests/unit/parent-sees-coverage.test.mjs`; expect zero failures. Schedule populated/empty/multi-child checks for Task 7.
- [x] Commit only this task's files: `fix: put family learning context ahead of administration`.

### Task 6: Public navigation, motion and honest recovery

**Files:** Modify `src/lib/components/Header.svelte`, `src/lib/components/AutoCarousel.svelte`, `src/routes/+page.svelte`, `src/routes/booking/+page.svelte`, `src/routes/+error.svelte`, `tests/unit/booking-page-honesty.test.mjs`; create `tests/unit/public-navigation-ux.test.mjs` and `tests/unit/contextual-error.test.mjs`.

**Interfaces:** Header uses native dialog or equivalent complete focus/dismissal semantics. Carousel adds persistent local pause/resume state; autoplay remains disallowed under reduced motion. Existing booking outcomes and error status codes are unchanged.

- [x] Test hidden-menu focus exclusion, Escape/focus restoration contract, persistent pause across hover/focus/grace changes, reduced-motion precedence, explicit demo labelling, accurate booking instructions and contextual game/tutor/family recovery.
- [x] Run the task's unit tests; confirm new assertions fail.
- [x] Implement the bounded interaction changes and truthful Hebrew copy. Keep true game-route help, avoid role elevation in error links and retain functional manual carousel navigation while paused.
- [x] Rerun task tests and booking-honesty tests; expect zero failures. Verify actual keyboard focus and motion controls in Task 7, not solely source assertions.
- [x] Commit only this task's files: `fix: make public navigation motion and recovery usable`.

### Task 7: Integrated regression and visual verification

**Files:** Update this plan's execution evidence and `anti-slop/audit-001-2026-11-02.md` with bounded fix status. Add regression tests to owning task files for review-discovered defects. No production data in artifacts.

**Interfaces:** Use `tests/characterization/harness.mjs` for disposable synthetic app data and the installed native browser capability. No browser/test dependency added.

- [x] Run `npm run build`, `npm run check:ci`, then `npm test`; require zero failed checks/tests, distinguishing existing accepted warnings from new warnings.
- [x] Inspect desktop 1440px and phone 320px/390px for operational dashboard, learner tabs/payments, preparation-first library, editor actions, visible plan filters, family hierarchy and public navigation. Include long Hebrew labels and representative empty/populated/error states.
- [x] Exercise keyboard menu open/Escape/focus return, all tutor destinations, carousel pause, dirty-game cancellation, retained failed-note text, stale-library retry and report-to-changed-plan continuity on disposable data. Check representative 200% zoom and reduced motion; record anything not tested rather than claiming full accessibility certification.
- [x] Apply one batched correction round and confirm affected states. Complete the selected execution workflow's independent review and resolve actionable findings.
- [x] Record findings 1-15 as fixed only with supporting evidence, commit the scoped documentation and present the branch/merge result with residual risks.

## Planning evidence

- Scope self-review: all 15 findings map to Tasks 1-6; operational overview is Task 2. Cross-task return navigation is defined once in Task 1. The five review-focus conditions have owning tasks and regression expectations.
- Independent brainstorming builder check: nothing important left.
- Baseline on 2026-11-02: `npm run build` exited 0; `npm run check:ci` exited 0 with 22 warnings at the accepted baseline. No application code was changed for these checks. Full test suite has not been rerun in this planning turn.
- User approved this plan, native execution and the isolated worktree on 2026-11-02. Implementation and independent review fixes are complete.
- Final application verification: build and check:ci passed; 1,688 tests passed. Detailed traceability, browser evidence and explicit untested states are in `docs/superpowers/specs/2026-11-02-sitewide-ux-verification.md`.
- Task 7 is a bounded representative check, not an exhaustive browser matrix or accessibility certification. Integration follows the user's standing permission to merge scoped changes.
