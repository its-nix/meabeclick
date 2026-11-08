# Shared Generation Machinery Implementation Plan

> **For agentic workers:** Use the dispatching-parallel-agents workflow for the independent ownership areas below; integrate and review the combined result before release.

**Goal:** Improve future generated teaching bundles across topics, rather than patching individual review presentations.

**Architecture:** Extend the numeric scene vocabulary, add fresh-generation quality reports and feedback-directed repair, and share adaptive question-bank behavior across question templates. Legacy readers remain permissive; generation-time requirements are stricter.

**Tech Stack:** Existing SvelteKit/TypeScript, numeric SVG renderers, SQLite, Codex CLI, Node tests and Playwright browser fixtures; no new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-11-08-generation-machinery-design.md`

## Global constraints

- Keep the existing shared brand; teal/parchment requirements are stale.
- Never read local student/pricing KB directories or use real customer fixtures.
- Preserve historical customer content and private-note boundaries.
- No deployment, library import or replacement of existing review artifacts.
- New migrations: adaptive results 038; generation quality 039 if a dedicated table is necessary. Parent registers both to avoid concurrent registry edits.

## Review focus

- New visuals must not expose answers in independent questions or print.
- Equivalent fractions and triangle scales must remain mathematically truthful during animation.
- A malformed critique, engine outage or exhausted repair cannot publish material as ready.
- Historical games without difficulty metadata retain their behavior and score semantics.
- Result evidence must remain bounded and scoped by existing signed authorization.

### Task 1: Shared visual capabilities

Own `src/lib/learning/{model,schema,visual,runtime,styles}.ts`, `src/lib/server/learning-render.ts`, the experience editor, video renderer integration and visual tests. Add reusable fraction/part-whole bars, right-triangle and function/tangent capabilities with bounded numeric contracts. Use generated scene formulas for pedagogical representations where the renderer is not the source of that formula; avoid showing a computed answer where the question asks the student to derive it.

- [x] Add failing model/render/browser regressions for new types and invalid parameters.
- [x] Implement validation, generation guidance and shared SVG rendering.
- [x] Update web, print, editor and video callers; preserve legacy scenes.
- [x] Verify focused unit tests and synthetic mobile/desktop rendering.

### Task 2: Generation quality and repair

Own `src/lib/server/lesson/prep.ts`, new quality/structured-generation helpers, quality persistence/route and associated tests. Consume Task 1's scene contract and Task 3's new game-generation helpers through stable exports. Keep raw private prompts/model diagnostics out of student output and fixed public failure copy.

- [x] Reproduce fresh output passing shape but failing a concrete quality requirement.
- [x] Add precise artifact/scene reports and a bounded structured model critique.
- [x] Pass exact failures and the rejected candidate to the single repair attempt.
- [x] Preserve reports on pass/exhaustion; wire fresh booking/library generation paths.
- [x] Test rejection, targeted repair, second failure and non-retried engine faults.

### Task 3: Adaptive question banks

Own game components/engine, registry, lesson-game editing/validation, results persistence/API and migration 038. Do not edit `prep.ts`; supply an exported schema/prompt/validation helper and integration instructions to Task 2. Do not edit learning scene files.

- [x] Add failing selector tests for difficulty changes, hints, unique questions and exhaustion.
- [x] Implement three levels, current-session adaptation and ten-question finite sessions; retain timed speed drill.
- [x] Preserve optional metadata through editing; require it only for newly generated banks.
- [x] Persist bounded per-question evidence with existing signed result authorization.
- [x] Verify historical compatibility and synthetic browser gameplay.

### Task 4: Integration and representative evidence

- [x] Register migrations and all new generation-source fingerprint files.
- [x] Independently review combined correctness, privacy and backward compatibility.
- [x] Build, warning gate, Linux/Node 22 full suite and learning/review browser checks.
- [x] Verify available local models; run bounded synthetic batches outside Git.
- [x] Compare topics and report accepted/rejected cases without treating automation as teaching approval.
- [x] Update sanitized feedback history and existing Todoist tasks with exact execution status.
- [ ] Obtain a complete ten-case candidate that passes validation and independent content review; the final targeted run rejected all four remaining cases.
- [ ] Obtain human teaching approval and a separately authorized rollout.

## Execution record

The existing tutor-workflow batch remains isolated in its own worktree. This
worktree starts from main. Lior's `continue then` authorizes implementation
of the reviewed themes; routine choices use the existing stack and contracts.
