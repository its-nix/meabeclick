# Targeted Artifact Repair Implementation Plan

> **For agentic workers:** Use executing-plans for the implementation here and an independent whole-change reviewer before completion. Reporting is a separate parallel domain/worktree.

**Goal:** Mechanically repair only located failed artifacts while retaining the single repair round and rechecking the complete bundle.
**Architecture:** A trusted catalog maps concrete candidate/schema units to setters. A strict replacement response contains only the selected units. The generation loop uses that response on its second attempt, preserves passing data and retains full fallback for unlocatable errors.
**Tech Stack:** Existing TypeScript, JSON Schema, Node tests, Codex CLI and private quality reports; no dependencies.
**Spec:** `docs/superpowers/specs/2026-11-08-targeted-artifact-repair-design.md`

## Global constraints

- Lior's go-on authorizes the recommended targeted repair and topic-level reporting designs; strict formatting remains unchanged.
- One repair round; no extra model retries, automatic publication or model-configuration change.
- Preserve historic/customer material and old source-provenance scopes. Never read prohibited student/pricing KBs.

## Review focus

- Array index2 must never address index20; unknown/ambiguous paths use full fallback.
- Bad or extra replacement keys fail closed; generated strings never become setters.
- Normalization must not rewrite passing artifacts after a targeted replacement.
- Final full-bundle critique may reject a new coherence issue and must not add a retry.
- Prior source manifests and historical readers must remain compatible.

### Task1: Trusted catalog and application

Files: new `src/lib/server/lesson/artifact-repair.ts`; `tests/unit/artifact-repair.test.mjs`.
Interfaces: `artifactRepair(candidate: unknown, issues: QualityIssue[], schema: OutputSchema): ArtifactRepair|null`; result has `paths`, strict `schema`, and `apply(reply: unknown): LessonPlan`.

- [x] RED: nested scene field chooses that scene; applying its replacement preserves all other artifacts and input.
- [x] GREEN: trusted catalog for slides/examples/homework/scenes, bank items and whole games; validate/normalize optional nulls before cloning/applying.
- [x] RED→GREEN: parent subsumption, index boundaries, malformed initial data, foreign/missing replacements and invalid types.
- [x] Verify focused Node tests and commit the module with its tests.

### Task2: Generation integration

Files: `prep.ts`, `quality.ts`, generation quality tests.

- [x] RED: semantic repair returns replacement units, not a new lesson; passing content cannot be changed.
- [x] GREEN: wire strict repair schema/application on attempt2 and private repair-mode/path evidence.
- [x] RED→GREEN: scoped normalization, unknown/global full fallback, new final critique failures, malformed repair/engine faults and duplicate aggregate errors.
- [x] Verify existing retry/privacy tests and commit the integration.

### Task3: Verification and authentic evidence

Files: provenance scripts/tests and sanitized execution/feedback docs.

- [x] Add new source file and retain the previous fingerprint scope for historical audits.
- [x] Run Linux Node22 suite, build/warning gate and independent review; fix findings with regressions.
- [x] Freeze source and run only06/07/08/10 in a new sealed synthetic directory; no source edits during the run.
- [x] Independently review READY outputs. Package only if all required replacements pass; preserve rejected outputs and exact provenance.
- [x] Update PR/Todoist/evidence records; no merge/deployment/customer replacement.

## Ledger

Start: f8bdffc. Existing baseline:1,807 Linux tests, build/check and CI pass.
Ruling: JSON object replacement keys are unique application slots; validation checks the exact parsed key set. No new raw-JSON duplicate-key parser is introduced; full schema/content assessment remains authoritative.
Ruling: Repair normalization applies only to explicitly replaced whole games. Individual question replacements retain their authored valid option/key bindings.

Progress: Task1 8a6b831. Task2 integration:43 focused tests pass; full fallback, scoped normalization, final rejection and engine-fault regressions included. Historical pre-repair batch audit passes against ef5c1d0 without changing original evidence.

Review rulings: retain item locations from both game validators; collect independent bank findings even after game validation fails. Add explicit primitive metadata assessment/repair units (including number-line bounds) so metadata does not force rewriting passing questions. Regressions were RED→GREEN. Fresh reviewer has no outstanding findings; final Linux rerun includes1826 tests.

Completion: source0e8bbd7 (fingerprintdb1c7797d12e899dde85aaa1c6a8e6b648dab886d5198d38031a719ad7e338f0;41 files) passed1,826 Linux Node22 tests, build/check and GitHub CI run42525648000. The sealed gpt-6.1-sol/medium trial completed all four required cases READY; separate content reviewers passed each exact plan. Three cases used targeted replacements and derivatives passed without repair. Explicit three-batch packaging assembled all ten independently accepted candidates outside Git. Browser verification:128 scene viewports,24 games,10 assessment pages, no runtime errors or result/customer writes. Original pilot and rejected candidates preserved. No deployment, customer replacement or human teaching approval.
