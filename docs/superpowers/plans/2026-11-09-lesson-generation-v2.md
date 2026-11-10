# Lesson Generation V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Produce coherent, personalised, full-duration math lesson bundles, with richer mathematical visuals, traceable official practice and truthful homework feedback, preserving existing customers.

**Architecture:** Add an optional v2 teaching contract around the current learning experience and existing game/homework publishing lifecycle. A shared versioned teaching-rule module informs production prompts and project skills; a verified source catalogue supplies trusted question IDs. Ship v2 as an explicit candidate version until owner review of ten examples; v1 remains usable and rollback stays trivial.

**Tech Stack:** Existing TypeScript, SvelteKit, Node >=22.18, SQLite, KaTeX, SVG and browser runtime; existing Codex engine and HyperFrames export; no new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-11-09-lesson-generation-v2-design.md` (approved 2026-11-09).

## Global Constraints

- Website logo, palette and Heebo typography remain canonical.
- Mathematics across supported grades/unit tracks; no other-subject expansion.
- Core agenda totals booked45/90/135 minutes; homework default10–15 minutes.
- No customer-material rewrite, progress reset, private-data Git fixtures or per-lesson approval step.
- Only reliable checker classes auto-grade; hints/reveals are supported practice.
- Official originals, adaptations and authored practice remain distinct; unresolved mandatory requests cannot be silently substituted.
- Video rendering never blocks lesson readiness; no generated executable HTML.
- Existing bounded retry, auth/quota handling, report release and version locks remain.
- Generator-v2 promotion follows ten synthetic candidate reviews; synthetic runs do not count as production streaks.

## Review Focus

- A ready legacy master must not swallow a specific new request or lose unit-track context (Task3).
- New private plan/history/solutions must never leak through public lesson JSON (Tasks2/6).
- An unreachable optional source falls back; an unreadable explicitly requested source stays unresolved (Task4).
- Frame values, displayed labels and checks must remain consistent during scrubbing and manipulation (Task5).
- Notes-only edits, report replacements and pre-v2 publications must retain existing progress/release semantics (Tasks6/7).

### Task 1: Shared teaching rules and focused project guides

**Files:** Create `src/lib/learning/teaching-rules.ts`; modify `src/lib/server/lesson/prep.ts`, `skills/meabeclick-learning-iteration/SKILL.md`; create its references `presentation.md`, `games.md`, `homework.md`, `mathematics.md`; test `tests/unit/teaching-rules.test.mjs`.

**Interfaces:** Produce `TEACHING_RULE_VERSION: string`, `TeachingProfile = {grade?: string; track?: string; notation?: "standard" | "school-normal-s"}`, `teachingRules(profile?: TeachingProfile): string[]`, `generationVersion(): 1|2`. Version2 is selected explicitly by `LESSON_GENERATION_VERSION=2`; default1 preserves the current production path. Rules cover continuity, cognitive progression, private notes, level-specific conventions, purposeful games and graduated support.

- [x] Write a failing generation-stub test asserting v2 prompts identify the shared rule version, preserve the supplied level and state reliable grading; v1 remains usable. Structured grade/track context is tested in Task2.
- [x] Run `node --test tests/unit/teaching-rules.test.mjs` and observe failure.
- [x] Add rules and repository-specific guides; connect the production prompt to the versioned rules, keeping source strings inside prompt fences.
- [x] Run that test and existing engine tests; expect pass. Commit the rules/guides.

### Task 2: Coherent teaching plan, cross-asset validation and strict generation

**Files:** Create `src/lib/learning/teaching.ts`, `src/lib/learning/teaching-schema.ts`; modify learning model/schema, generator prep and presenter notes; test `tests/unit/teaching-plan.test.mjs`.

**Interfaces:** `TeachingContext extends TeachingProfile` with `request`, `skill`, `curriculum`, `questionnaire`, `durationMin: 45|90|135`, and `history: Array<{kind: "taught"|"practice"; topic: string; summary: string; independent: boolean; at: string}>`; unknown profile values are empty/absent, never guessed. `TeachingPlan` has `version: 2`, `ruleVersion`, `durationMin`, `homeworkMinutes`, a server-attached `context`, `objectives: {id,title,evidence}[]`, `agenda: {id,title,minutes,objectiveId,kind,ref}[]`, `practice: {asset,ref,objectiveId,problemId,misconception,support,grading}[]`, optional replacement branches, and `sources: {questionId,kind}[]`. Agenda kind is `scene|game|homework|discussion`, practice asset is `scene|game|homework`, support is `guided|independent`, grading is `checked|tutor-review`, and source kind is `official|adapted`. Scene refs are actual scene IDs; game refs are schema game keys; homework refs are stable one-based `homework-<n>` IDs. Context/rule provenance is attached from the request by the server rather than accepted as a model claim. `teachingProblems(teaching: unknown, plan: LessonPlan, context?: TeachingContext): string[]` validates references, duration, objective coverage, sources and checker status. `publicTeaching(teaching: TeachingPlan): {durationMin: number; objectives: Array<{id: string; title: string}>; agenda: Array<{id: string; title: string; minutes: number; kind: string; ref: string}>}` explicitly whitelists the learner-visible agenda. `LessonPlan.teaching?` and `LessonRequest.teachingContext?` are optional for historical compatibility.

- [x] Fail tests for90-minute agenda totalling89, broken scene/game/homework references, unsupported automatic grading, and private data in public projection; include a valid45/90/135 plan.
- [x] Run `node --test tests/unit/teaching-plan.test.mjs`; expect failures.
- [x] Implement v2 schema/validators; require richer notes only for new v2 output; choose strict output schema by explicit generation version; validate within the existing bounded retry.
- [x] Run teaching/engine/notes tests; expect pass. Commit.

### Task 3: Context-aware booking and library eligibility

**Files:** Create `src/lib/server/lesson/teaching-context.ts`; modify `lesson/queue.ts`, `library/use.ts`, `library/prepare.ts`; test `tests/unit/teaching-context.test.mjs`, `tests/characterization/teaching-reuse.test.mjs`.

**Interfaces:** `teachingContextFor(booking: Booking, studentCode: string | null, target: TargetSkill | null): TeachingContext` creates a bounded private context from existing plan/report/practice evidence, with explicit unknowns. `canReuseTeachingPlan(plan: LessonPlan, request: LessonRequest): boolean` accepts only exact eligible v2 contexts when v2 is requested; v1 routing remains unchanged by default. Library preparation retains grade and unit track separately.

- [x] Fail tests showing a specific request cannot be replaced by an unrelated ready master, tracks4/5 remain distinct despite shared grade, and missing history is not invented.
- [x] Run the two named test files; observe failure.
- [x] Integrate context before generation/reuse; reuse exact-fit material without a model call; preserve old assigned plans and report lifecycle.
- [x] Run context/reuse and existing library/booking tests; expect pass. Commit.

### Task 4: Verified official-question catalogue and trusted source assets

**Files:** Create `src/lib/server/lesson/official-questions.ts`, `scripts/cache-official-question.mjs`, `src/routes/app/lessons/[slug]/source/[questionId]/+server.ts` and public-safe source fixtures; test `tests/unit/official-questions.test.mjs` and source-route characterization.

**Interfaces:** `OfficialQuestion` contains authority/source identity, document and crop hashes, question/page/subparts, transcript/accessibility text, profile fit, verification evidence and permitted-use state. `resolveOfficialQuestions(context: TeachingContext, options?: {requiredQuestionId?: string; usedQuestionIds?: string[]}): {questions: OfficialQuestion[]; status: "verified" | "authored-fallback" | "unresolved"; reason?: string}` returns trusted records or labelled fallback/unresolved status. Only catalogue IDs may appear in generated plans. Cache import verifies bytes/hashes and never treats a model claim or URL alone as verification.

- [x] Fail tests for forged verification, changed bytes, crop outside page, mismatched programme/level, traversal/external URLs, optional fallback and unresolved mandatory question.
- [x] Run source tests; observe failures.
- [x] Implement bounded retrieval/import and catalogue resolution; pass verified text/assets to generation; preserve original versus adapted labelling and question-use history via published plans.
- [x] Run source tests and auth/notes regressions; expect pass. Commit.

### Task 5: Controlled fraction, geometry and distribution visuals

**Files:** Extend `src/lib/learning/model.ts`, `schema.ts`, `visual.ts`, `runtime.ts`, `styles.ts` and renderer controls; keep new visual helpers focused and embeddable in standalone/video runtime. Test `tests/unit/teaching-visuals.test.mjs` and browser fixtures.

**Interfaces:** Extend `VisualKind` with `fraction`, `geometry`, `data-bars`, `normal` and `normal-school` (the latter two are distinct exact/approximate profiles); document bounded parameter layouts alongside their validators; extend validation, `formulaForVisual`, drawing and controls together. Preserve existing pure/seekable drawing contract. Every label/formula uses the same values as the diagram; normal-distribution profiles remain distinct.

- [x] Fail tests for fraction equivalence/repartitioning, invalid geometric dimensions/height interpretation, distribution parameters/profile percentages and existing graph compatibility.
- [x] Run visual tests; observe failures.
- [x] Implement SVG models and truthful controls/captions, static print support, single-frame independent stimuli and reduced-motion behaviour.
- [x] Run visual/math tests plus browser manipulation/scrubbing checks; expect pass. Commit.

### Task 6: Full-lesson navigation, source questions and graduated practice

**Files:** Extend `learning-render.ts`, learning runtime/styles, presenter guide, `src/lib/server/learning-store.ts` and `src/routes/api/learning/[slug]/+server.ts`; add focused teaching rendering helpers. Test `tests/unit/teaching-render.test.mjs`, `tests/characterization/teaching-lifecycle.test.mjs`, `tests/browser/teaching-v2.mjs`.

**Interfaces:** Renderer options accept safe `publicTeaching` projection and trusted source assets; public JSON never serialises teaching context, notes, answers or solution evidence. Agenda links resolve to scenes and available game/homework views. Practice support adds explicit requested worked solutions only after attempt, recording supported success; independent evidence requires a fresh check. Add idempotent `solution` events to the existing grading endpoint: the server requires an earlier attempt before returning the authorised worked solution; derive `revealed` support state from recorded events, exclude it from independent success, and keep the base public payload free of answers. Persisted pre-v2 evidence remains readable.

- [x] Fail tests for private-plan leakage, missing agenda activities, solution revealed before allowed attempt, false independent success after help, and notes-only progress reset.
- [x] Run named tests; observe failures.
- [x] Implement presentation/notes navigation, readable source question display and staged solutions, reliable homework/structured reasoning flow and print equivalents using existing grading and publication boundaries.
- [x] Run unit/characterization tests and browser checks at320/390/768/1440; expect pass. Commit.

### Task 7: Report-driven homework and versioned review workflow

**Files:** Update `src/lib/server/lesson/homework.ts` and `src/lib/server/reports/after.ts` to use shared teaching context/rules; extend existing review runner, packaging, source fingerprints and candidate review routes; keep baseline corpus intact. Test lifecycle and review/batch regressions.

**Interfaces:** Covered objective IDs determine eligible homework/activities. Existing no-report release policy is unchanged. Candidate version selection is explicit and does not alter production eligibility. Provenance includes rule/schema version and source verification alongside existing model/CLI hashes.

- [x] Fail tests for homework from an untaught objective, changed target/version lock and candidate corpus writes into customer/master tables.
- [x] Run lifecycle/batch tests; observe failures.
- [x] Integrate new contract into existing report/review seams; retain v1 and candidate examples side by side without expanding into a new administration product.
- [x] Run focused learning lifecycle, notes, source, booking/library and review suites; expect pass. Commit.

### Task 8: Candidate evidence, whole-branch review and handoff

**Files:** Candidate fixtures/corpus, browser evidence, feedback history and quality documentation only, plus fixes identified by verification.

**Interfaces:** Existing synthetic review runner produces10 complete v2 examples with fixed model/source version and validates all new contracts. Retain baseline and publish candidate review access separately. Promotion remains off pending owner teaching review.

- [x] Build/typecheck, run supported-Node full tests, browser learning/review/v2 checks, and inspect representative desktop/mobile/print output from all visual families.
- [x] Freeze generator inputs, generate10 real synthetic bundles, verify official-source and unavailable-source cases, review maths/voice/level fit, and retain source/model/version/checksums.
- [x] Obtain one fresh-context whole-branch review against the approved spec; fix material findings with reproducing tests and rerun affected/full checks.
- [x] Report actual results and candidate access. Keep production-v2 activation and replacement of old materials out of this handoff until owner reviews the generated examples.

## Self-review

Execution is complete. The final code snapshot passed all1,792 tests under Linux/Node22, build/typecheck with the existing22-warning ceiling, the baseline learning checks and the full v2 browser review (136 scene viewports,29 games). One independent whole-branch critic and bounded follow-ups cleared the selected candidates. Ten source-sealed synthetic bundles are available through the authenticated v2 gallery; the production-v2 switch remains off pending owner teaching review. Printed output and the optional10-second HyperFrames export were visually inspected. These checks do not establish the production booking reliability streak or student learning outcomes.

The tasks cover every approved design section. Cross-task interfaces are the shared context/plan (Tasks2–3), trusted source records (Task4), embeddable visual functions (Task5) and safe rendering/evidence projection (Tasks6–7). The review-focus cases are explicitly tested by the owning tasks. No dependency installation or refactor unrelated to this feature is required beyond the existing project setup.
