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

- [ ] RED: nested scene field chooses that scene; applying its replacement preserves all other artifacts and input.
- [ ] GREEN: trusted catalog for slides/examples/homework/scenes, bank items and whole games; validate/normalize optional nulls before cloning/applying.
- [ ] RED→GREEN: parent subsumption, index boundaries, malformed initial data, foreign/missing replacements and invalid types.
- [ ] Verify focused Node tests and commit the module with its tests.

### Task2: Generation integration

Files: `prep.ts`, `quality.ts`, generation quality tests.

- [ ] RED: semantic repair returns replacement units, not a new lesson; passing content cannot be changed.
- [ ] GREEN: wire strict repair schema/application on attempt2 and private repair-mode/path evidence.
- [ ] RED→GREEN: scoped normalization, unknown/global full fallback, new final critique failures, malformed repair/engine faults and duplicate aggregate errors.
- [ ] Verify existing retry/privacy tests and commit the integration.

### Task3: Verification and authentic evidence

Files: provenance scripts/tests and sanitized execution/feedback docs.

- [ ] Add new source file and retain the old44-file scope for historical audits.
- [ ] Run Linux Node22 suite, build/warning gate and independent review; fix findings with regressions.
- [ ] Freeze source and run only06/07/08/10 in a new sealed synthetic directory; no source edits during the run.
- [ ] Independently review READY outputs. Package only if all required replacements pass; preserve rejected outputs and exact provenance.
- [ ] Update PR/Todoist/evidence records; no merge/deployment/customer replacement.

## Ledger

Start: f8bdffc. Existing baseline:1,807 Linux tests, build/check and CI pass.
Ruling: JSON object replacement keys are unique application slots; validation checks the exact parsed key set. No new raw-JSON duplicate-key parser is introduced; full schema/content assessment remains authoritative.
Ruling: Repair normalization applies only to explicitly replaced whole games. Individual question replacements retain their authored valid option/key bindings.
